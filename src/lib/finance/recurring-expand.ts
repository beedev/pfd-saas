/**
 * Expand a recurring expense template into discrete budget periods.
 *
 * Given a template with start, optional end, and recurrence type, produce
 * the list of MMYYYY periods it covers. ONE_TIME → single period.
 *
 * Capped to ~24 months ahead from current period when no end is set, so
 * we never write an unbounded series of budget_entries rows.
 */
import { addMonthsToPeriod, getCurrentPeriod } from './amount';

export type Recurrence = 'ONE_TIME' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

const DEFAULT_LOOKAHEAD_MONTHS = 24;

export function expandRecurringPeriods(
  recurrence: Recurrence,
  startPeriod: string,
  endPeriod: string | null,
): string[] {
  if (recurrence === 'ONE_TIME') return [startPeriod];

  const stepMonths =
    recurrence === 'MONTHLY' ? 1 : recurrence === 'QUARTERLY' ? 3 : 12;

  // Default cap: 24 months ahead of NOW, so we don't drift if start is in past
  const cap = addMonthsToPeriod(getCurrentPeriod(), DEFAULT_LOOKAHEAD_MONTHS);
  const effectiveEnd = endPeriod ?? cap;

  const periods: string[] = [];
  let current = startPeriod;
  let safety = 0;

  while (current <= effectiveEnd && safety < 240) {
    periods.push(current);
    current = addMonthsToPeriod(current, stepMonths);
    safety += 1;
  }

  return periods;
}
