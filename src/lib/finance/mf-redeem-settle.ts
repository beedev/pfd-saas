/**
 * Settle a PENDING (or fresh) MF redemption at a known NAV.
 *
 * Writes the SELL transaction + a capital_gains row, reduces the holding
 * (average-cost), recomputes XIRR (the redemption is a positive inflow),
 * and marks the redemption SETTLED with links to the downstream rows.
 *
 * Shared by the redeem endpoint (settle-now) and the settlement worker
 * (pending → settled once the applicable NAV publishes).
 */

import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  mutualFunds,
  investmentTransactions,
  capitalGains,
  mfRedemptions,
  type MfRedemption,
} from '@/db';
import { computeRedemption, type BuyLeg } from './mf-redeem';

export async function settleRedemption(
  userId: string,
  redemption: MfRedemption,
  navRupees: number,
  navDateIso: string,
): Promise<MfRedemption> {
  // Everything below is one atomic unit: a crash or a concurrent settle
  // must never leave a SELL/capital_gain written without the redemption
  // marked SETTLED (which the worker would otherwise re-settle), nor let
  // two settlements both reduce the same holding (over-redeem).
  return await db.transaction(async (tx) => {
    // 1. Claim the redemption row under a row lock and re-check status.
    //    A concurrent settle (settle-now racing the worker, or two cron
    //    passes) blocks here until the first commits, then sees SETTLED
    //    and returns without double-booking.
    const [claim] = await tx
      .select()
      .from(mfRedemptions)
      .where(and(eq(mfRedemptions.id, redemption.id), eq(mfRedemptions.userId, userId)))
      .for('update');
    if (!claim) throw new Error('Redemption not found');
    if (claim.status !== 'PENDING') return claim; // already settled by a concurrent run

    // 2. Lock the holding row and read units UNDER the lock so two
    //    redemptions on the same fund serialize and cannot over-redeem.
    const [mf] = await tx
      .select()
      .from(mutualFunds)
      .where(and(eq(mutualFunds.id, claim.mutualFundId), eq(mutualFunds.userId, userId)))
      .for('update');
    if (!mf) throw new Error('Linked mutual fund not found');

    // Buy legs (BUY + SIP) → units-weighted acquisition date.
    const txns = await tx
      .select()
      .from(investmentTransactions)
      .where(
        and(
          eq(investmentTransactions.userId, userId),
          eq(investmentTransactions.assetType, 'MUTUAL_FUND'),
          eq(investmentTransactions.assetId, claim.mutualFundId),
        ),
      )
      .orderBy(asc(investmentTransactions.transactionDate));
    const buys: BuyLeg[] = txns
      .filter((t) => t.type === 'BUY' || t.type === 'SIP_EXECUTION')
      .map((t) => ({ quantity: t.quantity, transactionDate: t.transactionDate }));

    // Units to sell (clamp to the locked holding — can't redeem more than held).
    const requestedUnits =
      claim.mode === 'units' ? claim.requestedValue : claim.requestedValue / navRupees;
    const clamped = requestedUnits > mf.units + 1e-9;
    const unitsSold = clamped ? mf.units : requestedUnits;

    // saleDate = the date the NAV actually belongs to (H2). A weekday
    // holiday rolls to the next published NAV; the FY + LTCG/STCG
    // classification must use that real date, not the requested one.
    const c = computeRedemption({
      mf: { units: mf.units, totalInvestment: mf.totalInvestment, fundType: mf.fundType },
      mode: 'units',
      value: unitsSold,
      navRupees,
      saleDate: navDateIso,
      buys,
    });

    // SELL transaction.
    const [txn] = await tx
      .insert(investmentTransactions)
      .values({
        userId,
        type: 'SELL',
        assetType: 'MUTUAL_FUND',
        assetId: claim.mutualFundId,
        assetName: mf.schemeName,
        quantity: c.unitsSold,
        pricePerUnit: c.navPaisa,
        amount: c.proceedsPaisa,
        brokerageCharges: 0,
        taxesAndCharges: 0,
        totalCost: c.proceedsPaisa,
        transactionDate: navDateIso,
        notes: `MF redemption #${claim.id}`,
        createdAt: new Date(),
      })
      .returning();

    // Capital gain (average-cost). Per-row tax left to the aggregate CG
    // engine on /tax — store the gain + classification only.
    const taxableGain = Math.max(0, c.realizedGainPaisa);
    const [cg] = await tx
      .insert(capitalGains)
      .values({
        userId,
        financialYear: c.financialYear,
        assetType: c.assetType,
        assetName: mf.schemeName,
        purchaseDate: c.acquisitionDate,
        saleDate: navDateIso,
        purchasePrice: c.costBasisPaisa,
        salePrice: c.proceedsPaisa,
        capitalGain: c.realizedGainPaisa,
        holdingPeriod: c.holdingPeriod,
        exemptionApplied: 0,
        taxableGain,
        taxRate: 0,
        taxAmount: 0,
        notes: `MF redemption #${claim.id} (avg-cost)`,
        createdAt: new Date(),
      })
      .returning();

    // Reduce the holding.
    const epsilon = 1e-6;
    const newUnits = Math.max(0, mf.units - c.unitsSold);
    const closed = newUnits < epsilon;
    const newTotalInvestment = closed ? 0 : Math.max(0, mf.totalInvestment - c.costBasisPaisa);
    const newCurrentValue = closed ? 0 : Math.round(newUnits * c.navPaisa);
    const newGainLoss = newCurrentValue - newTotalInvestment;
    const newGainLossPercent = newTotalInvestment > 0 ? (newGainLoss / newTotalInvestment) * 100 : 0;

    await tx
      .update(mutualFunds)
      .set({
        units: closed ? 0 : newUnits,
        nav: c.navPaisa,
        totalInvestment: newTotalInvestment,
        currentValue: newCurrentValue,
        gainLoss: newGainLoss,
        gainLossPercent: newGainLossPercent,
        lastNavDate: navDateIso,
        updatedAt: new Date(),
      })
      .where(and(eq(mutualFunds.id, claim.mutualFundId), eq(mutualFunds.userId, userId)));

    // Mark the redemption settled + link the rows.
    const clampNote = clamped
      ? ' — requested exceeded holding; redeemed all available units.'
      : '';
    const dateNote =
      navDateIso !== claim.applicableNavDate
        ? ` — settled at NAV of ${navDateIso} (no published NAV on the applicable date ${claim.applicableNavDate}).`
        : '';
    const noteSuffix = clampNote + dateNote;
    const [settled] = await tx
      .update(mfRedemptions)
      .set({
        status: 'SETTLED',
        navPaisa: c.navPaisa,
        unitsSold: c.unitsSold,
        proceedsPaisa: c.proceedsPaisa,
        costBasisPaisa: c.costBasisPaisa,
        realizedGainPaisa: c.realizedGainPaisa,
        acquisitionDate: c.acquisitionDate,
        holdingPeriod: c.holdingPeriod,
        financialYear: c.financialYear,
        settledAt: new Date(),
        transactionId: txn.id,
        capitalGainId: cg.id,
        notes: ((claim.notes ?? '') + noteSuffix) || null,
      })
      .where(and(eq(mfRedemptions.id, claim.id), eq(mfRedemptions.userId, userId)))
      .returning();

    return settled;
  });
}
