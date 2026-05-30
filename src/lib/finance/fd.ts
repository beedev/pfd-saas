/**
 * Fixed Deposit math helpers.
 *
 * All money in paisa (integer). Rates as annual percent (e.g. 7.1 = 7.1%).
 * Compounding frequencies follow Indian banking conventions — quarterly is
 * the default (most banks for cumulative FDs).
 */

import type { FDCompoundingFreq } from '@/db/schema';

const N_PER_YEAR: Record<FDCompoundingFreq, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  YEARLY: 1,
};

/**
 * Maturity value of a cumulative FD:
 *   A = P × (1 + r/n)^(n × t)
 *
 *   P = principal (paisa)
 *   r = annual rate (decimal, e.g. 0.071 for 7.1%)
 *   n = compounding periods per year
 *   t = tenure in years
 *
 * For non-cumulative FDs (periodic payout), maturity = principal — the
 * interest has already been paid out periodically and isn't reinvested.
 */
export function calculateFdMaturityPaisa(
  principalPaisa: number,
  annualRatePct: number,
  tenureMonths: number,
  compoundingFreq: FDCompoundingFreq = 'QUARTERLY',
  interestType: 'CUMULATIVE' | 'NON_CUMULATIVE' = 'CUMULATIVE',
): number {
  if (principalPaisa <= 0 || tenureMonths <= 0) return principalPaisa;
  if (interestType === 'NON_CUMULATIVE') return principalPaisa;

  const r = annualRatePct / 100;
  const n = N_PER_YEAR[compoundingFreq];
  const t = tenureMonths / 12;
  const a = principalPaisa * Math.pow(1 + r / n, n * t);
  return Math.round(a);
}

/**
 * Months between two ISO dates. Negative if `to` precedes `from`.
 * Uses calendar-month accuracy (not 30-day approximation) since FDs are
 * documented in months, not days.
 */
export function monthsBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return m;
}

/**
 * Current accrued value at a given date for a cumulative FD. Used for the
 * net-worth tile if/when we want a live mark instead of plain principal.
 * Keep `asOf` clamped to [startDate, maturityDate].
 */
export function fdAccruedPaisa(
  principalPaisa: number,
  annualRatePct: number,
  startDate: string,
  asOf: string,
  compoundingFreq: FDCompoundingFreq = 'QUARTERLY',
  interestType: 'CUMULATIVE' | 'NON_CUMULATIVE' = 'CUMULATIVE',
): number {
  if (interestType === 'NON_CUMULATIVE') return principalPaisa;
  const monthsHeld = Math.max(0, monthsBetween(startDate, asOf));
  if (monthsHeld <= 0) return principalPaisa;
  const r = annualRatePct / 100;
  const n = N_PER_YEAR[compoundingFreq];
  const t = monthsHeld / 12;
  return Math.round(principalPaisa * Math.pow(1 + r / n, n * t));
}
