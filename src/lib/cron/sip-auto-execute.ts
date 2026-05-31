/**
 * SIP auto-execute job — Sprint 2 Phase 5.
 *
 * Tenant-aware port of personal v1's /api/investments/sips/auto-execute.
 * For the given userId:
 *   - Find ACTIVE SIPs whose nextExecutionDate < today (T+1 execution
 *     because AMFI publishes the day's NAV the next day).
 *   - For each, fetch the historical NAV on the due date, fall back to
 *     the latest AMFI NAV if unavailable.
 *   - Insert an investmentTransactions row, update the linked mutualFunds
 *     totals, recompute XIRR over the fund's full transaction history,
 *     update the SIP's running totals + next due date.
 *   - Sync SIP spend to the user's budget via budget-sync.
 *
 * Everything is user-scoped. AMFI is a public free API (no auth, no
 * tenant data) so the scheme-code/historical-nav lookups are global.
 */

import { and, asc, eq, lt } from 'drizzle-orm';
import {
  db,
  investmentTransactions,
  mutualFunds,
  sips,
  type SIPFrequency,
} from '@/db';
import { calculateXirr, type CashFlow } from '@/lib/finance/xirr';
import {
  dateToPeriod,
  recomputeSipBudgetForPeriod,
} from '@/lib/finance/budget-sync';
import {
  getBySchemeCode,
  getHistoricalNav,
  getSchemeCodeByIsin,
} from '@/lib/services/amfi';

export interface SipExecuted {
  sipId: number;
  schemeName: string;
  executionDate: string;
  amountRupees: number;
  navRupees: number;
  units: number;
}

export interface SipSkipped {
  sipId: number;
  schemeName: string;
  reason: string;
}

export interface SipExecuteResult {
  executed: SipExecuted[];
  skipped: SipSkipped[];
  errors: { sipId: number; schemeName: string; error: string }[];
  message: string;
}

function advanceDate(fromDate: string, frequency: SIPFrequency): string {
  const d = new Date(fromDate);
  switch (frequency) {
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'QUARTERLY':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'SEMI_ANNUAL':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'ANNUAL':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runSipAutoExecute(
  userId: string,
  options: { dryRun?: boolean } = {},
): Promise<SipExecuteResult> {
  const dryRun = !!options.dryRun;
  const today = todayIso();

  const overdueSips = await db
    .select({ sip: sips, mf: mutualFunds })
    .from(sips)
    .leftJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
    .where(
      and(
        eq(sips.userId, userId),
        eq(sips.status, 'ACTIVE'),
        lt(sips.nextExecutionDate, today),
      ),
    );

  if (overdueSips.length === 0) {
    return {
      executed: [],
      skipped: [],
      errors: [],
      message: 'No overdue SIPs',
    };
  }

  const executed: SipExecuted[] = [];
  const skipped: SipSkipped[] = [];
  const errors: { sipId: number; schemeName: string; error: string }[] = [];
  const schemeCodeCache = new Map<string, string | null>();

  for (const row of overdueSips) {
    const sip = row.sip;
    const mf = row.mf;
    const schemeName = mf?.schemeName ?? `SIP #${sip.id}`;

    if (!mf) {
      skipped.push({ sipId: sip.id, schemeName, reason: 'Linked mutual fund missing' });
      continue;
    }

    let schemeCode = schemeCodeCache.get(mf.isin);
    if (schemeCode === undefined) {
      schemeCode = await getSchemeCodeByIsin(mf.isin);
      schemeCodeCache.set(mf.isin, schemeCode);
    }
    if (!schemeCode) {
      skipped.push({
        sipId: sip.id,
        schemeName,
        reason: `Could not resolve scheme code for ISIN ${mf.isin}`,
      });
      continue;
    }

    let nextDue = sip.nextExecutionDate!;
    let currentSipTotalInvested = sip.totalInvestedSoFar;
    let currentMfUnits = mf.units;
    let currentMfTotalInvestment = mf.totalInvestment;
    let lastNav = mf.nav;
    let lastXirr = sip.expectedXirr;

    while (nextDue < today) {
      const historicalNav = await getHistoricalNav(schemeCode, nextDue);
      let fallbackNavRupees: number | null = null;
      if (historicalNav === null) {
        const currentFund = await getBySchemeCode(schemeCode);
        if (!currentFund) {
          errors.push({
            sipId: sip.id,
            schemeName,
            error: `NAV lookup failed for date ${nextDue}`,
          });
          break;
        }
        fallbackNavRupees = currentFund.nav;
      }

      const navRupees = historicalNav ?? fallbackNavRupees ?? lastNav / 100;
      const navPaisa = Math.round(navRupees * 100);
      const amountPaisa = sip.monthlyAmount;
      const amountRupees = amountPaisa / 100;
      const unitsBought = amountRupees / navRupees;

      if (dryRun) {
        executed.push({
          sipId: sip.id,
          schemeName,
          executionDate: nextDue,
          amountRupees,
          navRupees,
          units: unitsBought,
        });
        nextDue = advanceDate(nextDue, sip.frequency as SIPFrequency);
        continue;
      }

      // a. Investment transaction (stamped with userId)
      await db.insert(investmentTransactions).values({
        userId,
        type: 'SIP_EXECUTION',
        assetType: 'MUTUAL_FUND',
        assetId: sip.mutualFundId,
        assetName: mf.schemeName,
        quantity: unitsBought,
        pricePerUnit: navPaisa,
        amount: amountPaisa,
        brokerageCharges: 0,
        taxesAndCharges: 0,
        totalCost: amountPaisa,
        transactionDate: nextDue,
        notes: `Auto-executed SIP installment (SIP #${sip.id})`,
        createdAt: new Date(),
      });

      // b. Mutual fund running totals (scoped by id + userId)
      currentMfUnits += unitsBought;
      currentMfTotalInvestment += amountPaisa;
      const newCurrentValue = Math.round(currentMfUnits * navPaisa);
      const newGainLoss = newCurrentValue - currentMfTotalInvestment;
      const newGainLossPct =
        currentMfTotalInvestment > 0
          ? (newGainLoss / currentMfTotalInvestment) * 100
          : 0;

      await db
        .update(mutualFunds)
        .set({
          units: currentMfUnits,
          nav: navPaisa,
          totalInvestment: currentMfTotalInvestment,
          currentValue: newCurrentValue,
          gainLoss: newGainLoss,
          gainLossPercent: newGainLossPct,
          lastNavDate: nextDue,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mutualFunds.id, sip.mutualFundId),
            eq(mutualFunds.userId, userId),
          ),
        );

      lastNav = navPaisa;

      // c. Recompute XIRR over the user's full txn history for this fund
      const allTxns = await db
        .select()
        .from(investmentTransactions)
        .where(
          and(
            eq(investmentTransactions.userId, userId),
            eq(investmentTransactions.assetType, 'MUTUAL_FUND'),
            eq(investmentTransactions.assetId, sip.mutualFundId),
          ),
        )
        .orderBy(asc(investmentTransactions.transactionDate));

      const flows: CashFlow[] = allTxns.map((t) => ({
        amount: -(t.amount / 100),
        when: new Date(t.transactionDate),
      }));
      flows.push({
        amount: newCurrentValue / 100,
        when: new Date(nextDue),
      });
      lastXirr = calculateXirr(flows);

      // d. SIP running totals
      currentSipTotalInvested += amountPaisa;
      const nextExec = advanceDate(nextDue, sip.frequency as SIPFrequency);

      await db
        .update(sips)
        .set({
          totalInvestedSoFar: currentSipTotalInvested,
          lastExecutionDate: nextDue,
          nextExecutionDate: nextExec,
          expectedXirr: lastXirr,
          updatedAt: new Date(),
        })
        .where(and(eq(sips.id, sip.id), eq(sips.userId, userId)));

      // e. Sync SIP spend to user's budget
      await recomputeSipBudgetForPeriod(userId, dateToPeriod(nextDue));

      executed.push({
        sipId: sip.id,
        schemeName,
        executionDate: nextDue,
        amountRupees,
        navRupees,
        units: unitsBought,
      });

      nextDue = nextExec;
    }
  }

  return {
    executed,
    skipped,
    errors,
    message: dryRun
      ? `Dry run: ${executed.length} installment(s) would be executed`
      : `${executed.length} installment(s) executed`,
  };
}
