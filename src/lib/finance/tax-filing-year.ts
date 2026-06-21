/**
 * Tax filing year — the financial year you are currently filing for.
 *
 * This is DISTINCT from the GST / operating year (which is always the live
 * calendar FY). Tax lags: you file a year only after it ends, and you stay on
 * it until you CLOSE it (via the FY-close checklist). Closing records a
 * `tax_year_closed` marker in fy_close_status and advances the tax filing year.
 *
 *   • Nothing closed yet → most recent completed FY (e.g. 2025-26 in mid-2026).
 *   • 2025-26 closed     → 2026-27 (even while 2026-27 is still in progress).
 *
 * Tax surfaces (Gap Check, ITR, income-for-tax, FD interest, capital gains)
 * follow this. GST / current-operations surfaces follow the calendar instead.
 */

import { and, eq } from 'drizzle-orm';
import { db, fyCloseStatus } from '@/db';
import { getMostRecentCompletedFinancialYear } from './tax-constants';

/** Pseudo-category in fy_close_status that marks a FY as closed for tax. */
export const TAX_CLOSED_CATEGORY = 'tax_year_closed';

/** "2025-26" → "2026-27". */
export function nextFinancialYear(fy: string): string {
  const y = Number(fy.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * The FY currently being filed for this user. Advances only when a year is
 * closed; never runs ahead of the most recent completed FY when nothing is
 * closed yet.
 */
export async function getTaxFilingYear(userId: string): Promise<string> {
  const mostRecentCompleted = getMostRecentCompletedFinancialYear();

  const closed = await db
    .select({ fy: fyCloseStatus.financialYear })
    .from(fyCloseStatus)
    .where(
      and(
        eq(fyCloseStatus.userId, userId),
        eq(fyCloseStatus.category, TAX_CLOSED_CATEGORY),
        eq(fyCloseStatus.isLocked, true),
      ),
    );
  if (!closed.length) return mostRecentCompleted;

  const highestClosed = closed.map((c) => c.fy).sort().at(-1)!;
  const afterClosed = nextFinancialYear(highestClosed);
  // The year after the last closed one — but never behind the calendar's most
  // recently completed FY (so an old stray close marker can't pin us in the past).
  return afterClosed > mostRecentCompleted ? afterClosed : mostRecentCompleted;
}
