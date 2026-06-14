/**
 * Assistant read capabilities (the broad, always-available read surface).
 *
 * Each function wraps existing tables/helpers, scoped by userId, and returns a
 * uniform {@link ReadView} so a single generic formatter renders them all.
 * Reads can't mutate anything, so they're exposed to the LLM without the
 * include/integrity curation that governs writes.
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
} from '@/db';
import { assetClassCurrentValuePaisa } from '@/lib/assets/registry';
import { getFxRatesToInr } from '@/lib/services/yahoo-finance';
import { fetchCapitalGains } from '@/lib/reports/data/fetchCapitalGains';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { dateToPeriod } from '@/lib/finance/budget-sync';
import { loadCorpusContext, corpusForGoal, yearlyContributionForGoal, weightedReturnForGoal } from '@/lib/finance/goal-corpus';
import { projectGoal } from '@/lib/finance/goal-projection';

export interface ReadView {
  /** marks the object as a generic read view for formatResult */
  kind: 'read-view';
  title: string;
  totalPaisa?: number;
  lines: string[];
  empty?: string;
}

const inr = (paisa: number) => '₹' + Math.round(paisa / 100).toLocaleString('en-IN');
const pct = (p: number | null) => (p == null ? '' : ` (${p >= 0 ? '+' : ''}${p.toFixed(1)}%)`);
const view = (title: string, lines: string[], totalPaisa?: number, empty?: string): ReadView => ({
  kind: 'read-view',
  title,
  totalPaisa,
  lines,
  empty,
});

export async function readGold(userId: string): Promise<ReadView> {
  const rows = await db.select().from(goldHoldings).where(eq(goldHoldings.userId, userId));
  const total = await assetClassCurrentValuePaisa('gold', userId);
  return view(
    'Gold',
    rows.map((r) => `• ${r.type} — ${r.grams}g ${r.purity}: ${inr(r.currentValue ?? 0)}`),
    total,
    'No gold holdings.',
  );
}

export async function readMutualFunds(userId: string): Promise<ReadView> {
  const rows = await db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)).orderBy(desc(mutualFunds.currentValue));
  const total = await assetClassCurrentValuePaisa('mutualFunds', userId);
  return view(
    'Mutual Funds',
    rows.slice(0, 40).map((r) => `• ${r.schemeName}: ${inr(r.currentValue ?? 0)}${pct(r.gainLossPercent)}`),
    total,
    'No mutual funds.',
  );
}

export async function readStocks(userId: string): Promise<ReadView> {
  const rows = await db.select().from(holdings).where(eq(holdings.userId, userId)).orderBy(desc(holdings.currentValue));
  const total = await assetClassCurrentValuePaisa('stocks', userId);
  return view(
    'Stocks',
    rows.slice(0, 40).map((r) => `• ${r.symbol} ×${r.quantity}: ${inr(r.currentValue ?? 0)}${pct(r.gainLossPercent)}`),
    total,
    'No stock holdings.',
  );
}

export async function readSips(userId: string): Promise<ReadView> {
  const rows = await db
    .select({ scheme: mutualFunds.schemeName, amount: sips.monthlyAmount, next: sips.nextExecutionDate, status: sips.status })
    .from(sips)
    .innerJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
    .where(and(eq(sips.userId, userId), eq(sips.status, 'ACTIVE')));
  const monthly = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return view(
    'Active SIPs',
    rows.map((r) => `• ${r.scheme}: ${inr(Number(r.amount ?? 0))}/mo — next ${r.next ?? '—'}`),
    monthly,
    'No active SIPs.',
  );
}

export async function readInsurance(userId: string): Promise<ReadView> {
  const rows = await db
    .select()
    .from(insurancePolicies)
    .where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, 'ACTIVE')));
  const cover = rows.reduce((s, r) => s + Number(r.sumAssured ?? 0), 0);
  const title = rows.length ? `Insurance policies (cover ${inr(cover)})` : 'Insurance policies';
  return view(
    title,
    rows.map(
      (r) =>
        `• ${r.insurer} ${r.policyNumber ?? ''} (${r.policyType}) — premium ${inr(Number(r.premiumAmount ?? 0))}` +
        (r.nextPremiumDueDate ? `, next ${r.nextPremiumDueDate}` : ''),
    ),
    undefined,
    'No active policies.',
  );
}

export async function readChitFunds(userId: string): Promise<ReadView> {
  const rows = await db
    .select()
    .from(chitFunds)
    .where(and(eq(chitFunds.userId, userId), eq(chitFunds.status, 'ACTIVE')));
  return view(
    'Chit funds',
    rows.map(
      (r) =>
        `• ${r.schemeName}${r.foremanName ? ` (${r.foremanName})` : ''}: ${inr(Number(r.monthlyInstallment ?? 0))}/mo` +
        `${r.nextDueDate ? `, next ${r.nextDueDate}` : ''}${r.xirr != null ? ` · XIRR ${r.xirr.toFixed(1)}%` : ''}`,
    ),
    undefined,
    'No active chit funds.',
  );
}

export async function readLiabilities(userId: string): Promise<ReadView> {
  const rows = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.userId, userId), eq(liabilities.status, 'ACTIVE')))
    .orderBy(desc(liabilities.currentBalance));
  const total = rows.reduce((s, r) => s + Number(r.currentBalance ?? 0), 0);
  return view(
    'Loans & cards (outstanding)',
    rows.map(
      (r) =>
        `• ${r.name} (${r.type}): ${inr(Number(r.currentBalance ?? 0))}` +
        (Number(r.monthlyEmi ?? 0) > 0 ? ` — EMI ${inr(Number(r.monthlyEmi))}` : '') +
        (r.nextPaymentDate ? `, due ${r.nextPaymentDate}` : ''),
    ),
    total,
    'No active liabilities.',
  );
}

export async function readNps(userId: string): Promise<ReadView> {
  const rows = await db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId));
  const total = await assetClassCurrentValuePaisa('nps', userId);
  return view(
    'NPS',
    rows.map((r) => `• ${r.tier ?? 'NPS'}: ${inr(Number(r.totalValue ?? 0))}`),
    total,
    'No NPS account.',
  );
}

export async function readProvidentFund(userId: string): Promise<ReadView> {
  const rows = await db.select().from(epfAccounts).where(eq(epfAccounts.userId, userId));
  const total = await assetClassCurrentValuePaisa('pf', userId);
  return view(
    'Provident Fund',
    rows.map((r) => `• ${r.accountType}: ${inr(Number(r.totalBalance ?? 0))}`),
    total,
    'No PF/PPF account.',
  );
}

export async function readRealEstate(userId: string): Promise<ReadView> {
  const rows = await db.select().from(realEstate).where(eq(realEstate.userId, userId));
  const total = await assetClassCurrentValuePaisa('realEstate', userId);
  return view(
    'Real estate',
    rows.map(
      (r) =>
        `• ${r.propertyName} (${r.type}): ${inr(Number(r.currentValuation ?? 0))}` +
        (Number(r.monthlyRent ?? 0) > 0 ? ` — rent ${inr(Number(r.monthlyRent))}/mo` : ''),
    ),
    total,
    'No properties.',
  );
}

export async function readForex(userId: string): Promise<ReadView> {
  const rows = await db.select().from(forexDeposits).where(and(eq(forexDeposits.userId, userId), eq(forexDeposits.status, 'ACTIVE')));
  if (rows.length === 0) return view('Forex deposits', [], 0, 'No forex deposits.');
  const codes = [...new Set(rows.map((r) => r.currencyCode))];
  const rates = await getFxRatesToInr(codes);
  let totalPaisa = 0;
  const lines = rows.map((r) => {
    const amt = parseFloat(r.amountInCurrency);
    const rate = rates[r.currencyCode];
    const inrPaisa = rate ? Math.round(amt * rate * 100) : 0;
    totalPaisa += inrPaisa;
    return `• ${r.bankName ?? r.currencyCode}: ${amt.toLocaleString('en-IN')} ${r.currencyCode}` + (rate ? ` ≈ ${inr(inrPaisa)}` : ' (rate n/a)');
  });
  return view('Forex deposits', lines, totalPaisa);
}

export async function readCapitalGains(userId: string): Promise<ReadView> {
  const fy = getCurrentFinancialYear();
  const r = await fetchCapitalGains({ userId, fy } as Parameters<typeof fetchCapitalGains>[0]);
  const lines = [
    `• LTCG: ${inr(r.totals.ltcgGainPaisa)}`,
    `• STCG: ${inr(r.totals.stcgGainPaisa)}`,
    `• Exemptions: ${inr(r.totals.totalExemptionPaisa)}`,
    `• Taxable: ${inr(r.totals.totalTaxablePaisa)}`,
    `• Est. tax: ${inr(r.totals.totalTaxPaisa)}`,
  ];
  const n = r.ltcg.length + r.stcg.length;
  return view(`Capital gains — FY ${fy} (${n} sales)`, lines, undefined, `No capital gains recorded for FY ${fy}.`);
}

export async function readSpending(userId: string): Promise<ReadView> {
  const period = dateToPeriod(new Date().toISOString());
  const rows = await db
    .select({ name: budgetCategories.name, planned: budgetEntries.plannedAmount, actual: budgetEntries.actualAmount, type: budgetCategories.type })
    .from(budgetEntries)
    .innerJoin(budgetCategories, eq(budgetEntries.categoryId, budgetCategories.id))
    .where(and(eq(budgetEntries.userId, userId), eq(budgetEntries.period, period)));
  const expense = rows.filter((r) => r.type === 'EXPENSE');
  const spent = expense.reduce((s, r) => s + Number(r.actual ?? 0), 0);
  const planned = expense.reduce((s, r) => s + Number(r.planned ?? 0), 0);
  const lines = expense
    .filter((r) => Number(r.actual ?? 0) > 0 || Number(r.planned ?? 0) > 0)
    .sort((a, b) => Number(b.actual ?? 0) - Number(a.actual ?? 0))
    .slice(0, 40)
    .map((r) => `• ${r.name}: ${inr(Number(r.actual ?? 0))} / ${inr(Number(r.planned ?? 0))}`);
  return view(
    `Spending this month (${inr(spent)} of ${inr(planned)} planned)`,
    lines,
    undefined,
    'No budget entries for this month.',
  );
}

export async function readGoals(userId: string): Promise<ReadView> {
  const goals = await db
    .select()
    .from(financialGoals)
    .where(and(eq(financialGoals.userId, userId), eq(financialGoals.isActive, true)));
  if (goals.length === 0) return view('Financial goals', [], undefined, 'No active goals.');

  const [ctx, allEvents] = await Promise.all([
    loadCorpusContext(userId),
    db.select().from(cashflowEvents).where(eq(cashflowEvents.userId, userId)),
  ]);
  const contribEvents = allEvents.map((e) => ({
    amountPaisa: e.amountPaisa,
    frequency: e.frequency,
    goalId: e.goalId ?? null,
    sourceKind: e.sourceKind ?? null,
    autoDerived: e.autoDerived ?? false,
  }));
  const today = new Date().toISOString().slice(0, 10);

  const lines = goals.map((goal) => {
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
      const status = p.fundedAtTargetDate
        ? 'on track ✅'
        : p.monthlyContributionRequiredPaisa != null
          ? `shortfall — needs ${inr(p.monthlyContributionRequiredPaisa)}/mo from today`
          : 'behind';
      return (
        `• ${goal.name}: target ${inr(Number(goal.targetAmount ?? 0))}${goal.targetDate ? ` by ${goal.targetDate}` : ''}` +
        ` · saved ${inr(initialCorpusPaisa)} · contributing ${inr(yearlyContributionPaisa)}/yr · ${status}`
      );
    } catch {
      return `• ${goal.name}: target ${inr(Number(goal.targetAmount ?? 0))}${goal.targetDate ? ` by ${goal.targetDate}` : ''} (projection unavailable)`;
    }
  });
  return view('Financial goals', lines);
}
