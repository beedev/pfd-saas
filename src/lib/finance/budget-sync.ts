/**
 * Budget Auto-Sync Utility
 *
 * Recomputes actualAmount in budget_entries from source-of-truth tables:
 * - SIP executions → "SIP" budget category
 * - Chit installments → "Chit" budget category
 * - Credit card expenses → card name budget category (e.g., "ICICI")
 */

import { db } from '@/db';
import {
  budgetCategories,
  budgetEntries,
  investmentTransactions,
  chitFundInstallments,
  creditCardExpenses,
  liabilities,
} from '@/db/schema';
import { eq, and, gte, lt, sql } from 'drizzle-orm';

/**
 * Convert ISO date string to MMYYYY budget period.
 * "2026-04-10" → "042026"
 */
export function dateToPeriod(isoDate: string): string {
  const month = isoDate.substring(5, 7); // "04"
  const year = isoDate.substring(0, 4);   // "2026"
  return `${month}${year}`;
}

/**
 * Compute first-of-month and first-of-next-month for date range filtering.
 * Period "042026" → ["2026-04-01", "2026-05-01"]
 */
function periodToDateRange(period: string): [string, string] {
  const month = parseInt(period.substring(0, 2), 10);
  const year = parseInt(period.substring(2, 6), 10);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return [from, to];
}

/**
 * Find-or-create an EXPENSE budget category, then upsert actualAmount for the period.
 */
export async function syncBudgetActual(
  categoryName: string,
  period: string,
  actualAmountPaisa: number,
): Promise<void> {
  // Find category
  let categories = await db
    .select()
    .from(budgetCategories)
    .where(
      and(
        eq(budgetCategories.name, categoryName),
        eq(budgetCategories.type, 'EXPENSE'),
      ),
    );

  // Auto-create if missing
  if (categories.length === 0) {
    categories = await db
      .insert(budgetCategories)
      .values({
        name: categoryName,
        type: 'EXPENSE',
        sortOrder: 99,
        isActive: true,
      })
      .returning();
  }

  const categoryId = categories[0].id;

  // Upsert budget entry
  const existing = await db
    .select()
    .from(budgetEntries)
    .where(
      and(
        eq(budgetEntries.categoryId, categoryId),
        eq(budgetEntries.period, period),
      ),
    );

  if (existing.length > 0) {
    await db
      .update(budgetEntries)
      .set({
        plannedAmount: actualAmountPaisa,
        actualAmount: actualAmountPaisa,
        updatedAt: new Date(),
      })
      .where(eq(budgetEntries.id, existing[0].id));
  } else {
    await db.insert(budgetEntries).values({
      categoryId,
      period,
      plannedAmount: actualAmountPaisa,
      actualAmount: actualAmountPaisa,
    });
  }
}

/**
 * Recompute total SIP spend for a period and sync to budget.
 */
export async function recomputeSipBudgetForPeriod(period: string): Promise<void> {
  const [from, to] = periodToDateRange(period);

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${investmentTransactions.amount}), 0)` })
    .from(investmentTransactions)
    .where(
      and(
        eq(investmentTransactions.type, 'SIP_EXECUTION'),
        gte(investmentTransactions.transactionDate, from),
        lt(investmentTransactions.transactionDate, to),
      ),
    );

  await syncBudgetActual('SIP', period, result[0].total);
}

/**
 * Recompute total chit outflow for a period and sync to budget.
 * Uses installmentPaid (the net amount that left the bank).
 */
export async function recomputeChitBudgetForPeriod(period: string): Promise<void> {
  const [from, to] = periodToDateRange(period);

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${chitFundInstallments.installmentPaid}), 0)` })
    .from(chitFundInstallments)
    .where(
      and(
        gte(chitFundInstallments.paidOn, from),
        lt(chitFundInstallments.paidOn, to),
      ),
    );

  await syncBudgetActual('Chit', period, result[0].total);
}

/**
 * Recompute credit card spend for a liability+period and sync to budget.
 * Uses the liability's name as the budget category name.
 *
 * Spend = COALESCE(paid_amount, amount) — when statement is unpaid, the
 * statement total is forecasted; once paid, the actual paid amount replaces it.
 */
export async function recomputeCreditCardBudgetForPeriod(
  liabilityId: number,
  period: string,
): Promise<void> {
  // Look up the liability name
  const liability = await db
    .select({ name: liabilities.name })
    .from(liabilities)
    .where(eq(liabilities.id, liabilityId));

  if (liability.length === 0) return;

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(COALESCE(${creditCardExpenses.paidAmount}, ${creditCardExpenses.amount})), 0)`,
    })
    .from(creditCardExpenses)
    .where(
      and(
        eq(creditCardExpenses.liabilityId, liabilityId),
        eq(creditCardExpenses.period, period),
      ),
    );

  await syncBudgetActual(liability[0].name, period, result[0].total);
}
