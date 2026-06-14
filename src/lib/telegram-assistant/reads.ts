/**
 * Assistant read capabilities — DATA PROVIDERS ONLY.
 *
 * Each function fetches its domain's real data (wrapping existing tables/libs,
 * scoped by userId) and returns a plain object with **rupee-valued numbers**
 * (paisa ÷ 100 — the one deterministic, money-safe step), ISO dates, and
 * labelled fields. NO presentation: the LLM compose pass formats per request,
 * and a generic fallback renders the object when no key. So the only thing
 * specialised here is the fetch (genuinely different per domain); formatting is
 * generic and lives elsewhere.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  goldHoldings,
  mutualFunds,
  holdings,
  sips,
  insurancePolicies,
  chitFunds,
  liabilities,
  npsAccounts,
  epfAccounts,
  realEstate,
  forexDeposits,
  budgetEntries,
  budgetCategories,
  financialGoals,
  cashflowEvents,
  priceSnapshots,
  alertRules,
  alertHistory,
  invoices,
  purchaseInvoices,
  businessProfile,
} from '@/db';
import { assetClassCurrentValuePaisa, computeNetWorth } from '@/lib/assets/registry';
import { getFxRatesToInr } from '@/lib/services/yahoo-finance';
import { fetchCapitalGains } from '@/lib/reports/data/fetchCapitalGains';
import { fetchRetirementProjection } from '@/lib/reports/data/fetchRetirementProjection';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { dateToPeriod } from '@/lib/finance/budget-sync';
import { loadCorpusContext, corpusForGoal, yearlyContributionForGoal, weightedReturnForGoal } from '@/lib/finance/goal-corpus';
import { projectGoal } from '@/lib/finance/goal-projection';
import { computeFyTaxComparison, isComputeError } from '@/lib/finance/tax-compute';
import { getDuePayments } from '@/lib/finance/due-payments';
import { deriveDeductions } from '@/lib/finance/deduction-engine';

/** paisa → whole rupees (the single deterministic money step). */
const r = (paisa: number | bigint | null | undefined) => Math.round(Number(paisa ?? 0) / 100);
const isoTax = () => getCurrentFinancialYear();

// ── Core ──────────────────────────────────────────────────────────────
export async function readNetWorth(userId: string) {
  const nw = await computeNetWorth(userId);
  return {
    title: 'Net worth',
    netWorthRupees: r(nw.netWorthPaisa),
    totalAssetsRupees: r(nw.totalAssetsPaisa),
    liabilitiesRupees: r(nw.liabilitiesPaisa),
    breakdown: nw.breakdown
      .filter((b) => b.valuePaisa > 0)
      .map((b) => ({ label: b.label, valueRupees: r(b.valuePaisa), isLiability: b.isLiability })),
  };
}

export async function readDuePayments(userId: string) {
  const items = await getDuePayments(userId);
  return {
    title: 'Due / overdue payments',
    due: items.map((i) => ({ category: i.category, label: i.label, amountRupees: r(i.amountPaisa), dueDate: i.dueDate, isOverdue: i.isOverdue })),
  };
}

export async function readTaxDeductions(userId: string) {
  const fy = isoTax();
  const d = await deriveDeductions(userId, fy);
  return {
    title: `Chapter VI-A tax deductions, FY ${fy}`,
    fy,
    oldRegimeTotalRupees: r(d.oldRegimeTotalPaisa),
    newRegimeEligibleRupees: r(d.newRegimeTotalPaisa),
    sections: d.breakdown.filter((b) => b.amountPaisa > 0).map((b) => ({ section: b.label, amountRupees: r(b.amountPaisa) })),
  };
}

// ── Assets ────────────────────────────────────────────────────────────
export async function readGold(userId: string) {
  const rows = await db.select().from(goldHoldings).where(eq(goldHoldings.userId, userId));
  return {
    title: 'Gold',
    totalRupees: r(await assetClassCurrentValuePaisa('gold', userId)),
    holdings: rows.map((g) => ({ type: g.type, grams: g.grams, purity: g.purity, valueRupees: r(g.currentValue) })),
  };
}

export async function readMutualFunds(userId: string) {
  const rows = await db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)).orderBy(desc(mutualFunds.currentValue));
  return {
    title: 'Mutual funds',
    totalRupees: r(await assetClassCurrentValuePaisa('mutualFunds', userId)),
    funds: rows.map((m) => ({ scheme: m.schemeName, valueRupees: r(m.currentValue), gainPct: m.gainLossPercent, category: m.category })),
  };
}

export async function readStocks(userId: string) {
  const rows = await db.select().from(holdings).where(eq(holdings.userId, userId)).orderBy(desc(holdings.currentValue));
  return {
    title: 'Stocks',
    totalRupees: r(await assetClassCurrentValuePaisa('stocks', userId)),
    holdings: rows.map((h) => ({ symbol: h.symbol, qty: h.quantity, valueRupees: r(h.currentValue), gainPct: h.gainLossPercent })),
  };
}

export async function readSips(userId: string) {
  const rows = await db
    .select({ scheme: mutualFunds.schemeName, amount: sips.monthlyAmount, next: sips.nextExecutionDate })
    .from(sips)
    .innerJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
    .where(and(eq(sips.userId, userId), eq(sips.status, 'ACTIVE')));
  return {
    title: 'Active SIPs',
    totalMonthlyRupees: rows.reduce((s, x) => s + r(x.amount), 0),
    sips: rows.map((x) => ({ scheme: x.scheme, monthlyRupees: r(x.amount), nextDate: x.next })),
  };
}

export async function readInsurance(userId: string) {
  const rows = await db.select().from(insurancePolicies).where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, 'ACTIVE')));
  return {
    title: 'Insurance policies',
    totalCoverRupees: rows.reduce((s, p) => s + r(p.sumAssured), 0),
    policies: rows.map((p) => ({
      insurer: p.insurer,
      policyNumber: p.policyNumber,
      type: p.policyType,
      premiumRupees: r(p.premiumAmount),
      premiumFrequency: p.premiumFrequency,
      nextDueDate: p.nextPremiumDueDate,
      sumAssuredRupees: r(p.sumAssured),
    })),
  };
}

export async function readChitFunds(userId: string) {
  const rows = await db.select().from(chitFunds).where(and(eq(chitFunds.userId, userId), eq(chitFunds.status, 'ACTIVE')));
  return {
    title: 'Chit funds',
    chits: rows.map((c) => ({
      scheme: c.schemeName,
      foreman: c.foremanName,
      monthlyRupees: r(c.monthlyInstallment),
      nextDueDate: c.nextDueDate,
      netContributionRupees: r(c.netContribution),
      xirrPct: c.xirr,
    })),
  };
}

export async function readLiabilities(userId: string) {
  const rows = await db.select().from(liabilities).where(and(eq(liabilities.userId, userId), eq(liabilities.status, 'ACTIVE'))).orderBy(desc(liabilities.currentBalance));
  return {
    title: 'Loans & credit cards',
    totalOutstandingRupees: rows.reduce((s, l) => s + r(l.currentBalance), 0),
    liabilities: rows.map((l) => ({ name: l.name, type: l.type, outstandingRupees: r(l.currentBalance), emiRupees: r(l.monthlyEmi), nextPaymentDate: l.nextPaymentDate })),
  };
}

export async function readNps(userId: string) {
  const rows = await db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId));
  return {
    title: 'NPS',
    totalRupees: r(await assetClassCurrentValuePaisa('nps', userId)),
    accounts: rows.map((n) => ({ tier: n.tier, valueRupees: r(n.totalValue) })),
  };
}

export async function readProvidentFund(userId: string) {
  const rows = await db.select().from(epfAccounts).where(eq(epfAccounts.userId, userId));
  return {
    title: 'Provident fund (EPF/PPF/VPF)',
    totalRupees: r(await assetClassCurrentValuePaisa('pf', userId)),
    accounts: rows.map((e) => ({ type: e.accountType, balanceRupees: r(e.totalBalance) })),
  };
}

export async function readRealEstate(userId: string) {
  const rows = await db.select().from(realEstate).where(eq(realEstate.userId, userId));
  return {
    title: 'Real estate',
    totalRupees: r(await assetClassCurrentValuePaisa('realEstate', userId)),
    properties: rows.map((p) => ({ name: p.propertyName, type: p.type, valuationRupees: r(p.currentValuation), monthlyRentRupees: r(p.monthlyRent) })),
  };
}

export async function readForex(userId: string) {
  const rows = await db.select().from(forexDeposits).where(and(eq(forexDeposits.userId, userId), eq(forexDeposits.status, 'ACTIVE')));
  if (rows.length === 0) return { title: 'Forex deposits', deposits: [] as unknown[] };
  const rates = await getFxRatesToInr([...new Set(rows.map((x) => x.currencyCode))]);
  return {
    title: 'Forex deposits',
    deposits: rows.map((x) => {
      const amt = parseFloat(x.amountInCurrency);
      const rate = rates[x.currencyCode];
      return { bank: x.bankName, currency: x.currencyCode, amount: amt, inrRupees: rate ? Math.round(amt * rate) : null, maturityDate: x.maturityDate };
    }),
  };
}

// ── Tax / gains / spending ──────────────────────────────────────────────
export async function readCapitalGains(userId: string) {
  const fy = isoTax();
  const c = await fetchCapitalGains({ userId, fy } as Parameters<typeof fetchCapitalGains>[0]);
  return {
    title: `Capital gains, FY ${fy}`,
    fy,
    ltcgRupees: r(c.totals.ltcgGainPaisa),
    stcgRupees: r(c.totals.stcgGainPaisa),
    exemptionsRupees: r(c.totals.totalExemptionPaisa),
    taxableRupees: r(c.totals.totalTaxablePaisa),
    estTaxRupees: r(c.totals.totalTaxPaisa),
    salesCount: c.ltcg.length + c.stcg.length,
  };
}

export async function readSpending(userId: string) {
  const period = dateToPeriod(new Date().toISOString());
  const rows = await db
    .select({ name: budgetCategories.name, planned: budgetEntries.plannedAmount, actual: budgetEntries.actualAmount, type: budgetCategories.type })
    .from(budgetEntries)
    .innerJoin(budgetCategories, eq(budgetEntries.categoryId, budgetCategories.id))
    .where(and(eq(budgetEntries.userId, userId), eq(budgetEntries.period, period)));
  const expense = rows.filter((x) => x.type === 'EXPENSE');
  return {
    title: 'Spending vs budget this month',
    period,
    spentRupees: expense.reduce((s, x) => s + r(x.actual), 0),
    plannedRupees: expense.reduce((s, x) => s + r(x.planned), 0),
    categories: expense
      .filter((x) => Number(x.actual ?? 0) > 0 || Number(x.planned ?? 0) > 0)
      .sort((a, b) => Number(b.actual ?? 0) - Number(a.actual ?? 0))
      .map((x) => ({ category: x.name, spentRupees: r(x.actual), plannedRupees: r(x.planned) })),
  };
}

export async function readTax(userId: string) {
  const fy = isoTax();
  const c = await computeFyTaxComparison(userId, fy);
  if (isComputeError(c)) return { title: `Income tax, FY ${fy}`, fy, error: c.error };
  return {
    title: `Income tax, FY ${fy}`,
    fy,
    grossIncomeRupees: r(c.income.gross),
    deductionsOldRupees: r(c.deductions.oldRegime),
    deductionsNewRupees: r(c.deductions.newRegime),
    taxOldRegimeRupees: r((c.comparison.old as { totalTaxPaisa?: number }).totalTaxPaisa ?? 0),
    taxNewRegimeRupees: r((c.comparison.new as { totalTaxPaisa?: number }).totalTaxPaisa ?? 0),
    recommendedRegime: c.comparison.recommendation,
    savingsRupees: r(c.comparison.savingsPaisa),
  };
}

// ── Planning ────────────────────────────────────────────────────────────
export async function readGoals(userId: string) {
  const goals = await db.select().from(financialGoals).where(and(eq(financialGoals.userId, userId), eq(financialGoals.isActive, true)));
  if (goals.length === 0) return { title: 'Financial goals', goals: [] as unknown[] };
  const [ctx, allEvents] = await Promise.all([loadCorpusContext(userId), db.select().from(cashflowEvents).where(eq(cashflowEvents.userId, userId))]);
  const contribEvents = allEvents.map((e) => ({ amountPaisa: e.amountPaisa, frequency: e.frequency, goalId: e.goalId ?? null, sourceKind: e.sourceKind ?? null, autoDerived: e.autoDerived ?? false }));
  const today = new Date().toISOString().slice(0, 10);
  return {
    title: 'Financial goals',
    goals: goals.map((goal) => {
      try {
        const initialCorpusPaisa = corpusForGoal(ctx, goal.id);
        const yearlyContributionPaisa = yearlyContributionForGoal(ctx, goal.id, contribEvents);
        const rb = weightedReturnForGoal(ctx, goal.id);
        const projGoal = rb.bands.length > 0 ? { ...goal, expectedReturnPct: rb.weightedReturnPct } : goal;
        const p = projectGoal({
          goal: projGoal,
          initialCorpusPaisa,
          yearlyContributionPaisa,
          earmarkedEvents: allEvents.filter((e) => e.goalId === goal.id && e.frequency === 'ONE_TIME'),
          today,
          marginalRatePct: 0,
        });
        return {
          name: goal.name,
          targetRupees: r(goal.targetAmount),
          targetDate: goal.targetDate,
          savedRupees: r(initialCorpusPaisa),
          yearlyContributionRupees: r(yearlyContributionPaisa),
          onTrack: p.fundedAtTargetDate,
          monthlyNeededRupees: p.monthlyContributionRequiredPaisa != null ? r(p.monthlyContributionRequiredPaisa) : null,
        };
      } catch {
        return { name: goal.name, targetRupees: r(goal.targetAmount), targetDate: goal.targetDate, projectionError: true };
      }
    }),
  };
}

export async function readRetirement(userId: string) {
  const ret = await fetchRetirementProjection({ userId } as Parameters<typeof fetchRetirementProjection>[0]);
  if (!ret.projection.length) return { title: 'Retirement', plan: null };
  const a = ret.assumptions;
  return {
    title: 'Retirement plan & year-by-year projection',
    assumptions: {
      currentAge: a.currentAge,
      retireAge: a.targetAge,
      retirementYears: a.retirementDurationYears,
      monthlyExpenseRupees: a.monthlyExpenseRupees, // already rupees
      preRetirementReturnPct: a.expectedReturnPct,
      postRetirementReturnPct: a.postRetirementReturnPct,
      inflationPct: a.inflationPct,
    },
    startingCorpusRupees: r(ret.startingCorpusPaisa),
    yearByYear: ret.projection.map((y) => ({
      year: y.year,
      age: y.age,
      corpusStartRupees: r(y.corpusStartPaisa),
      contributionsRupees: r(y.contributionsPaisa),
      returnsRupees: r(y.returnsPaisa),
      withdrawalsRupees: r(y.withdrawalsPaisa),
      corpusEndRupees: r(y.corpusEndPaisa),
    })),
  };
}

// ── History / alerts / GST ──────────────────────────────────────────────
export async function readNetWorthHistory(userId: string) {
  const rows = await db
    .select({ date: priceSnapshots.priceDate, price: priceSnapshots.price })
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.userId, userId), eq(priceSnapshots.source, 'NETWORTH_SNAPSHOT'), eq(priceSnapshots.assetSymbol, 'NET_WORTH')))
    .orderBy(priceSnapshots.priceDate);
  const nonZero = rows.filter((x) => Number(x.price) > 0); // drop empty leading snapshots
  const series = nonZero.length ? nonZero : rows;
  return { title: 'Net worth history', snapshots: series.map((x) => ({ date: x.date, netWorthRupees: r(x.price) })) };
}

export async function readAlerts(userId: string) {
  const [rules, history] = await Promise.all([
    db.select().from(alertRules).where(eq(alertRules.userId, userId)).orderBy(desc(alertRules.createdAt)),
    db
      .select({ ruleName: alertRules.name, message: alertHistory.message, sentAt: alertHistory.sentAt })
      .from(alertHistory)
      .leftJoin(alertRules, eq(alertHistory.ruleId, alertRules.id))
      .where(eq(alertHistory.userId, userId))
      .orderBy(desc(alertHistory.sentAt))
      .limit(10),
  ]);
  return {
    title: 'Alerts',
    rules: rules.map((x) => ({ name: x.name, category: x.category, enabled: x.isEnabled })),
    recentlyTriggered: history.map((h) => ({ date: h.sentAt ? new Date(h.sentAt).toISOString().slice(0, 10) : null, message: h.message })),
  };
}

export async function readGst(userId: string) {
  const period = dateToPeriod(new Date().toISOString());
  const [profile, sales, purch] = await Promise.all([
    db.select().from(businessProfile).where(eq(businessProfile.userId, userId)).limit(1),
    db.select().from(invoices).where(and(eq(invoices.userId, userId), eq(invoices.returnPeriod, period), eq(invoices.status, 'FINAL'))),
    db.select().from(purchaseInvoices).where(and(eq(purchaseInvoices.userId, userId), eq(purchaseInvoices.returnPeriod, period), eq(purchaseInvoices.itcEligible, true))),
  ]);
  if (profile.length === 0) return { title: 'GST', configured: false };
  const taxP = (i: { cgstAmount: number | null; sgstAmount: number | null; igstAmount: number | null; cessAmount: number | null }) =>
    Number(i.cgstAmount ?? 0) + Number(i.sgstAmount ?? 0) + Number(i.igstAmount ?? 0) + Number(i.cessAmount ?? 0);
  const outTax = sales.reduce((s, i) => s + taxP(i), 0);
  const itc = purch.reduce((s, p) => s + taxP(p), 0);
  return {
    title: `GST, return period ${period}`,
    period,
    salesCount: sales.length,
    purchaseCount: purch.length,
    taxableSalesRupees: r(sales.reduce((s, i) => s + Number(i.taxableAmount ?? 0), 0)),
    outputGstRupees: r(outTax),
    itcRupees: r(itc),
    netPayableRupees: r(Math.max(0, outTax - itc)),
  };
}
