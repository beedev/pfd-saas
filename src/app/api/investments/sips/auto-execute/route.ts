import { NextRequest, NextResponse } from 'next/server';
import { eq, and, lt, asc } from 'drizzle-orm';
import {
  db,
  sips,
  mutualFunds,
  investmentTransactions,
  type SIPFrequency,
} from '@/db';
import { calculateXirr, type CashFlow } from '@/lib/finance/xirr';
import { recomputeSipBudgetForPeriod, dateToPeriod } from '@/lib/finance/budget-sync';
import {
  getHistoricalNav,
  getSchemeCodeByIsin,
  getBySchemeCode,
} from '@/lib/services/amfi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

interface ExecutionResult {
  sipId: number;
  schemeName: string;
  executionDate: string;
  amount: number; // rupees
  nav: number; // rupees
  units: number;
}

interface SkipResult {
  sipId: number;
  schemeName: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// POST /api/investments/sips/auto-execute
// Body (optional): { dryRun?: boolean }
//
// Finds all ACTIVE SIPs with nextExecutionDate <= today and executes each
// overdue installment using the historical NAV on the SIP's due date.
// A SIP that is multiple months behind is executed once per missed period.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    let dryRun = false;
    try {
      const body = await request.json();
      dryRun = !!body?.dryRun;
    } catch {
      // empty body is fine
    }

    const today = todayIso();

    // 1. Find all ACTIVE SIPs with nextExecutionDate < today (T+1 execution).
    // SIP due on April 10 → executed on April 11 using April 10's closing NAV.
    // This ensures the correct NAV is available from AMFI (published T+1).
    const overdueSips = await db
      .select({ sip: sips, mf: mutualFunds })
      .from(sips)
      .leftJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
      .where(and(eq(sips.status, 'ACTIVE'), lt(sips.nextExecutionDate, today)));

    if (!overdueSips.length) {
      return NextResponse.json({
        executed: [],
        skipped: [],
        errors: [],
        message: 'No overdue SIPs found',
      });
    }

    const executed: ExecutionResult[] = [];
    const skipped: SkipResult[] = [];
    const errors: { sipId: number; schemeName: string; error: string }[] = [];

    // Cache scheme codes per ISIN to avoid repeated lookups
    const schemeCodeCache = new Map<string, string | null>();

    for (const row of overdueSips) {
      const sip = row.sip;
      const mf = row.mf;
      const schemeName = mf?.schemeName ?? `SIP #${sip.id}`;

      if (!mf) {
        skipped.push({ sipId: sip.id, schemeName, reason: 'Linked mutual fund not found' });
        continue;
      }

      // Resolve scheme code from ISIN
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

      // Execute each overdue installment (may be multiple months behind)
      let nextDue = sip.nextExecutionDate!;
      let currentSipTotalInvested = sip.totalInvestedSoFar;
      let currentMfUnits = mf.units;
      let currentMfTotalInvestment = mf.totalInvestment;
      let lastNav = mf.nav; // paisa — fallback
      let lastNavDate = mf.lastNavDate;
      let lastXirr = sip.expectedXirr;

      while (nextDue < today) {
        // T+1 execution: SIP due on date X is executed on X+1.
        // By then, date X's closing NAV is published on AMFI.
        const historicalNav = await getHistoricalNav(schemeCode, nextDue);

        // When historical NAV is unavailable (Sunday/holiday/not yet published),
        // fall back to the LATEST AMFI NAV — not the stored DB value which can
        // be a month stale from the previous SIP execution.
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
          console.warn(
            `Historical NAV unavailable for ${schemeCode} on ${nextDue}, using AMFI latest NAV ${currentFund.nav}`,
          );
        }

        // Order of preference: historical NAV for due date → latest AMFI NAV → stored stale NAV
        const navRupees = historicalNav ?? fallbackNavRupees ?? (lastNav / 100);
        const navPaisa = Math.round(navRupees * 100);
        const amountPaisa = sip.monthlyAmount; // already in paisa
        const amountRupees = amountPaisa / 100;
        const unitsBought = amountRupees / navRupees;

        if (dryRun) {
          executed.push({
            sipId: sip.id,
            schemeName,
            executionDate: nextDue,
            amount: amountRupees,
            nav: navRupees,
            units: unitsBought,
          });
          nextDue = advanceDate(nextDue, sip.frequency as SIPFrequency);
          continue;
        }

        // -- Actual execution (mirrors single-SIP execute endpoint) --

        // a. Insert investment transaction
        await db.insert(investmentTransactions).values({
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

        // b. Update mutual fund running totals
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
          .where(eq(mutualFunds.id, sip.mutualFundId));

        lastNav = navPaisa;
        lastNavDate = nextDue;

        // c. Recompute XIRR
        const allTxns = await db
          .select()
          .from(investmentTransactions)
          .where(
            and(
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

        // d. Update SIP running totals
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
          .where(eq(sips.id, sip.id));

        // Sync SIP spend to budget
        await recomputeSipBudgetForPeriod(dateToPeriod(nextDue));

        executed.push({
          sipId: sip.id,
          schemeName,
          executionDate: nextDue,
          amount: amountRupees,
          nav: navRupees,
          units: unitsBought,
        });

        nextDue = nextExec;
      }
    }

    return NextResponse.json({
      executed,
      skipped,
      errors,
      message: dryRun
        ? `Dry run: ${executed.length} installment(s) would be executed`
        : `${executed.length} installment(s) executed`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Auto-execute failed';
    console.error('Auto-execute SIPs error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
