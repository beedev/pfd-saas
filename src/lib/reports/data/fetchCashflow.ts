/**
 * Sprint 6.2b — Annual Cashflow Statement report data fetcher.
 *
 * Builds a 12-month FY grid of income vs categorised expenses.
 *
 * INCOME monthly construction:
 *   • SALARY — gross_salary_paisa ÷ 12 across all 12 months
 *     (FY salary is annual; spreading evenly is the common
 *      practitioner choice unless month-by-month payslips exist)
 *   • OTHER SOURCES — interest / dividend / rental / other from
 *     other_sources_income rows for the FY, spread evenly
 *   • CAPITAL GAINS — booked into the month of sale_date
 *
 * EXPENSE monthly construction:
 *   • BUDGET ENTRIES — actual_amount per category per period
 *     (period format MMYYYY, decoded into year/month)
 *   • RECURRING EXPENSES — projected when no budget_entry covers
 *     the period AND the recurring template is active
 *
 * Empty data → empty arrays returned — PDF/Excel/CSV render the FY
 * header + a "no data" row gracefully.
 */

import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  otherSourcesIncome,
  capitalGains,
  budgetEntries,
  budgetCategories,
  recurringExpenses,
} from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { fyMonths } from '@/lib/reports/format-utils';
import type { ReportParams } from '@/types/reports';

export interface CashflowRow {
  label: string;
  monthly: number[]; // 12 entries, paise
  totalPaisa: number;
}

export interface CashflowReportData {
  fy: string;
  months: { label: string; year: number; month: number }[];
  income: CashflowRow[];
  expenses: CashflowRow[];
  totals: {
    incomeMonthly: number[];
    expenseMonthly: number[];
    netMonthly: number[];
    incomeTotalPaisa: number;
    expenseTotalPaisa: number;
    netTotalPaisa: number;
  };
}

/** Convert MMYYYY → { year, month0Indexed }. Returns null for invalid. */
function decodePeriod(period: string): { year: number; month: number } | null {
  if (!period || period.length !== 6) return null;
  const m = Number(period.slice(0, 2));
  const y = Number(period.slice(2, 6));
  if (!Number.isFinite(m) || !Number.isFinite(y)) return null;
  if (m < 1 || m > 12) return null;
  return { year: y, month: m - 1 };
}

/** Find index in months grid where {year, month} matches, else -1. */
function monthIndex(
  months: { year: number; month: number }[],
  year: number,
  month: number,
): number {
  return months.findIndex((m) => m.year === year && m.month === month);
}

export async function fetchCashflow(params: ReportParams): Promise<CashflowReportData> {
  const userId = params.userId;
  const fy = params.fy || getCurrentFinancialYear();
  const months = fyMonths(fy);

  // Date-range strings for budget_entries.period (MMYYYY) bounds.
  // First grid month → e.g. "042025"; last → "032026".
  const periodFor = (m: { year: number; month: number }) =>
    `${String(m.month + 1).padStart(2, '0')}${m.year}`;
  const fromPeriod = periodFor(months[0]);
  const toPeriod = periodFor(months[months.length - 1]);

  const [salaryRows, otherRows, cgRows, budgetRows, cats, recurRows] = await Promise.all([
    db
      .select()
      .from(salaryIncome)
      .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
    db
      .select()
      .from(otherSourcesIncome)
      .where(
        and(
          eq(otherSourcesIncome.userId, userId),
          eq(otherSourcesIncome.financialYear, fy),
        ),
      ),
    db
      .select()
      .from(capitalGains)
      .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy))),
    db
      .select()
      .from(budgetEntries)
      .where(
        and(
          eq(budgetEntries.userId, userId),
          gte(budgetEntries.period, fromPeriod),
          lte(budgetEntries.period, toPeriod),
        ),
      ),
    db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.userId, userId))
      .orderBy(asc(budgetCategories.name)),
    db.select().from(recurringExpenses).where(eq(recurringExpenses.userId, userId)),
  ]);

  // ─── INCOME ROWS ──────────────────────────────────────────────────
  const income: CashflowRow[] = [];

  // Salary — gross_salary_paisa ÷ 12 across all months.
  const salaryAnnualPaisa = salaryRows.reduce((s, r) => s + (r.grossSalaryPaisa || 0), 0);
  if (salaryAnnualPaisa > 0) {
    const monthly = Array.from({ length: 12 }, () => Math.round(salaryAnnualPaisa / 12));
    income.push({
      label: 'Salary (Gross)',
      monthly,
      totalPaisa: monthly.reduce((s, v) => s + v, 0),
    });
  }

  // Other sources — split into interest / dividend / other buckets
  // and spread each evenly across 12 months.
  const interestAnnual = otherRows
    .filter((r) => ['BANK_INTEREST', 'FD_INTEREST', 'PF_INTEREST'].includes(r.source))
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  if (interestAnnual > 0) {
    const m = Array.from({ length: 12 }, () => Math.round(interestAnnual / 12));
    income.push({
      label: 'Interest Income',
      monthly: m,
      totalPaisa: m.reduce((s, v) => s + v, 0),
    });
  }
  const divAnnual = otherRows
    .filter((r) => r.source === 'DIVIDEND')
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  if (divAnnual > 0) {
    const m = Array.from({ length: 12 }, () => Math.round(divAnnual / 12));
    income.push({
      label: 'Dividends',
      monthly: m,
      totalPaisa: m.reduce((s, v) => s + v, 0),
    });
  }
  const otherAnnual = otherRows
    .filter(
      (r) =>
        !['BANK_INTEREST', 'FD_INTEREST', 'PF_INTEREST', 'DIVIDEND'].includes(r.source),
    )
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  if (otherAnnual > 0) {
    const m = Array.from({ length: 12 }, () => Math.round(otherAnnual / 12));
    income.push({
      label: 'Other Income',
      monthly: m,
      totalPaisa: m.reduce((s, v) => s + v, 0),
    });
  }

  // Capital gains — booked into the month of saleDate.
  if (cgRows.length > 0) {
    const cgMonthly = new Array(12).fill(0);
    for (const cg of cgRows) {
      const d = new Date(cg.saleDate);
      const idx = monthIndex(months, d.getFullYear(), d.getMonth());
      if (idx >= 0) cgMonthly[idx] += cg.capitalGain || 0;
    }
    const total = cgMonthly.reduce((s, v) => s + v, 0);
    if (total !== 0) {
      income.push({
        label: 'Capital Gains',
        monthly: cgMonthly,
        totalPaisa: total,
      });
    }
  }

  // ─── EXPENSE ROWS ─────────────────────────────────────────────────
  // Group budget_entries.actualAmount by category + period.
  const catById = new Map<number, string>();
  for (const c of cats) catById.set(c.id, c.name);

  const expensesByCategory = new Map<string, number[]>(); // categoryName → monthly[12]
  for (const e of budgetRows) {
    const period = decodePeriod(e.period);
    if (!period) continue;
    const idx = monthIndex(months, period.year, period.month);
    if (idx < 0) continue;
    const catName = catById.get(e.categoryId) ?? 'Uncategorised';
    if (!expensesByCategory.has(catName)) {
      expensesByCategory.set(catName, new Array(12).fill(0));
    }
    expensesByCategory.get(catName)![idx] += e.actualAmount || 0;
  }

  // Project recurring expenses where no budget_entry exists for the
  // (category, period) combination — this catches users who haven't
  // logged actuals but have set up a recurring template.
  const budgetCoveredPeriods = new Set(
    budgetRows.map((e) => `${e.categoryId}_${e.period}`),
  );
  for (const r of recurRows) {
    if (!r.isActive) continue;
    const catName = catById.get(r.categoryId) ?? 'Uncategorised';
    if (!expensesByCategory.has(catName)) {
      expensesByCategory.set(catName, new Array(12).fill(0));
    }
    for (let i = 0; i < 12; i++) {
      const m = months[i];
      const period = periodFor(m);
      const covered = budgetCoveredPeriods.has(`${r.categoryId}_${period}`);
      if (covered) continue;
      // Apply by recurrence type:
      //   MONTHLY → contribute every month
      //   QUARTERLY → first month of each quarter (Apr/Jul/Oct/Jan)
      //   ANNUALLY → April only (start of FY)
      //   ONE_TIME → only if startPeriod matches
      let contribute = 0;
      switch (r.recurrence) {
        case 'MONTHLY':
          contribute = r.amount || 0;
          break;
        case 'QUARTERLY':
          if ([3, 6, 9, 0].includes(m.month)) contribute = r.amount || 0;
          break;
        case 'ANNUALLY':
          if (m.month === 3) contribute = r.amount || 0;
          break;
        case 'ONE_TIME':
          if (r.startPeriod === period) contribute = r.amount || 0;
          break;
      }
      expensesByCategory.get(catName)![i] += contribute;
    }
  }

  const expenses: CashflowRow[] = [...expensesByCategory.entries()]
    .map(([category, monthly]) => ({
      label: category,
      monthly,
      totalPaisa: monthly.reduce((s, v) => s + v, 0),
    }))
    .filter((r) => r.totalPaisa !== 0)
    .sort((a, b) => a.label.localeCompare(b.label));

  // ─── TOTALS ───────────────────────────────────────────────────────
  const incomeMonthly = new Array(12).fill(0);
  for (const r of income) for (let i = 0; i < 12; i++) incomeMonthly[i] += r.monthly[i];
  const expenseMonthly = new Array(12).fill(0);
  for (const r of expenses) for (let i = 0; i < 12; i++) expenseMonthly[i] += r.monthly[i];
  const netMonthly = incomeMonthly.map((v, i) => v - expenseMonthly[i]);
  const incomeTotalPaisa = incomeMonthly.reduce((s, v) => s + v, 0);
  const expenseTotalPaisa = expenseMonthly.reduce((s, v) => s + v, 0);
  const netTotalPaisa = incomeTotalPaisa - expenseTotalPaisa;

  return {
    fy,
    months,
    income,
    expenses,
    totals: {
      incomeMonthly,
      expenseMonthly,
      netMonthly,
      incomeTotalPaisa,
      expenseTotalPaisa,
      netTotalPaisa,
    },
  };
}
