/**
 * Sprint 6.2b — Retirement Projection report data fetcher.
 *
 * Synthesises a year-by-year projection from the user's saved
 * retirement_assumptions and current net-worth assets. We use the
 * same `projectFutureValue()` math the dashboard uses (single
 * compound rate across the corpus) — sufficient for the print report
 * which surfaces a high-level trajectory, not the full bucket-cascade
 * the /retirement page renders interactively.
 *
 * Per year row:
 *   • corpusStart  — projected corpus at start of year
 *   • contributionsPaisa — annual contribution (monthlyExpense × 12
 *     proxy for SIP rate; if not present, zero)
 *   • returnsPaisa — corpusStart × expectedReturnPct
 *   • withdrawalsPaisa — post-retirement, monthly expense × 12
 *   • corpusEnd    — corpusStart + returns + contributions − withdrawals
 */

import { eq } from 'drizzle-orm';
import {
  db,
  retirementAssumptions,
  holdings,
  mutualFunds,
  npsAccounts,
  epfAccounts,
  smallSavingsAccounts,
  realEstate,
  goldHoldings,
  fixedDeposits,
  insurancePolicies,
} from '@/db';
import type { ReportParams } from '@/types/reports';

const CASH_VALUE_POLICIES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export interface RetirementYearRow {
  year: number;
  age: number;
  corpusStartPaisa: number;
  contributionsPaisa: number;
  returnsPaisa: number;
  withdrawalsPaisa: number;
  corpusEndPaisa: number;
}

export interface RetirementProjectionReportData {
  assumptions: {
    currentAge: number;
    targetAge: number;
    retirementDurationYears: number;
    monthlyExpenseRupees: number;
    inflationPct: number;
    expectedReturnPct: number;
    postRetirementReturnPct: number;
  };
  startingCorpusPaisa: number;
  projection: RetirementYearRow[];
}

export async function fetchRetirementProjection(
  params: ReportParams,
): Promise<RetirementProjectionReportData> {
  const userId = params.userId;
  const currentYear = new Date().getFullYear();

  const [assRows, stocks, mfs, nps, pf, ss, re, gold, fds, ins] = await Promise.all([
    db
      .select()
      .from(retirementAssumptions)
      .where(eq(retirementAssumptions.userId, userId))
      .limit(1),
    db.select().from(holdings).where(eq(holdings.userId, userId)),
    db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)),
    db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
    db.select().from(epfAccounts).where(eq(epfAccounts.userId, userId)),
    db
      .select()
      .from(smallSavingsAccounts)
      .where(eq(smallSavingsAccounts.userId, userId)),
    db.select().from(realEstate).where(eq(realEstate.userId, userId)),
    db.select().from(goldHoldings).where(eq(goldHoldings.userId, userId)),
    db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, userId)),
    db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
  ]);

  const ass = assRows[0] ?? {
    currentAge: 30,
    targetAge: 60,
    monthlyExpenseRupees: 50000,
    inflationPct: 6,
    expectedReturnPct: 10,
    postRetirementReturnPct: 8,
    retirementDurationYears: 25,
  };

  const currentAge = ass.currentAge ?? 30;
  const targetAge = ass.targetAge ?? 60;
  const retirementDuration = ass.retirementDurationYears ?? 25;
  const monthlyExpenseRupees = ass.monthlyExpenseRupees ?? 50000;
  const inflationPct = ass.inflationPct ?? 6;
  const expectedReturnPct = ass.expectedReturnPct ?? 10;
  const postRetirementReturnPct = ass.postRetirementReturnPct ?? 8;

  // Starting corpus = sum of investable assets (matches the /retirement
  // "starting corpus" tile). Real estate and insurance cash value
  // counted; gold counted; fixed deposits counted.
  const startingCorpusPaisa =
    stocks.reduce((s, h) => s + (h.currentValue || 0), 0) +
    mfs.reduce((s, m) => s + (m.currentValue || 0), 0) +
    nps.reduce((s, n) => s + (n.totalValue || 0), 0) +
    pf.reduce((s, p) => s + (p.totalBalance || 0), 0) +
    ss.reduce((s, a) => s + (a.currentBalancePaisa || 0), 0) +
    re.reduce((s, r) => s + (r.currentValuation || 0), 0) +
    gold.reduce((s, g) => s + (g.currentValue || 0), 0) +
    fds
      .filter((f) => f.status === 'ACTIVE')
      .reduce((s, f) => s + (f.principalPaisa || 0), 0) +
    ins
      .filter((p) => CASH_VALUE_POLICIES.includes(p.policyType))
      .reduce((s, p) => s + (p.investmentValue || 0), 0);

  // Annual contribution — taken as monthlyExpense × 0 (we don't know
  // the user's monthly SIP rate in this report; the /retirement page
  // surfaces the required SIP separately). We default to 0 here and
  // let the user read the contribution leg from the dashboard. This
  // keeps the year-by-year column reflective of withdrawals + returns
  // rather than guesswork.
  const annualContributionPaisa = 0;
  const monthlyExpensePaisa = monthlyExpenseRupees * 100;

  const projection: RetirementYearRow[] = [];
  let corpus = startingCorpusPaisa;
  let age = currentAge;
  const yearsToShow = Math.max(0, targetAge - currentAge) + retirementDuration;

  for (let i = 0; i < yearsToShow; i++) {
    const year = currentYear + i;
    age = currentAge + i;
    const preRetire = age < targetAge;
    const ratePct = preRetire ? expectedReturnPct : postRetirementReturnPct;

    const corpusStart = corpus;
    const returnsPaisa = Math.round((corpusStart * ratePct) / 100);
    const contributionsPaisa = preRetire ? annualContributionPaisa : 0;
    // Withdrawals are monthly expense × 12, inflated annually post-
    // retirement. Pre-retirement the user covers expenses from salary,
    // so withdrawals = 0.
    const yearsRetired = preRetire ? 0 : age - targetAge;
    const inflationFactor = Math.pow(1 + inflationPct / 100, yearsRetired);
    const withdrawalsPaisa = preRetire
      ? 0
      : Math.round(monthlyExpensePaisa * 12 * inflationFactor);

    const corpusEnd = corpusStart + returnsPaisa + contributionsPaisa - withdrawalsPaisa;
    projection.push({
      year,
      age,
      corpusStartPaisa: corpusStart,
      contributionsPaisa,
      returnsPaisa,
      withdrawalsPaisa,
      corpusEndPaisa: corpusEnd,
    });
    corpus = corpusEnd;
    if (corpus < 0) {
      // Cap at zero — the projection has run out of money.
      // Continue rendering rows so the user sees the cliff but the
      // numbers don't go increasingly negative.
      corpus = 0;
    }
  }

  return {
    assumptions: {
      currentAge,
      targetAge,
      retirementDurationYears: retirementDuration,
      monthlyExpenseRupees,
      inflationPct,
      expectedReturnPct,
      postRetirementReturnPct,
    },
    startingCorpusPaisa,
    projection,
  };
}
