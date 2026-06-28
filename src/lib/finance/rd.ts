/**
 * Recurring Deposit math helpers.
 *
 * All money in paisa (integer). Rates as annual percent (e.g. 7.1 = 7.1%).
 * Indian RDs compound quarterly by convention. Unlike an FD's single
 * principal, an RD is a fixed monthly installment: each installment compounds
 * for the months remaining until maturity, so maturity is the sum of all
 * installments grown to the maturity date.
 */

import type { RDCompoundingFreq } from '@/db/schema';

const N_PER_YEAR: Record<RDCompoundingFreq, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  YEARLY: 1,
};

/**
 * Maturity value of a recurring deposit:
 *   M = Σ_{k=1..N} install × (1 + r/n)^(n × (N − k + 1) / 12)
 *
 *   install = monthly installment (paisa)
 *   r       = annual rate (decimal)
 *   n       = compounding periods per year
 *   N       = tenure in months (number of installments)
 *
 * The k-th installment (deposited at the start of month k) compounds for the
 * (N − k + 1) months remaining until maturity. Computed per-installment for
 * exactness rather than via the closed-form approximation.
 */
export function calculateRdMaturityPaisa(
  monthlyInstallmentPaisa: number,
  annualRatePct: number,
  tenureMonths: number,
  compoundingFreq: RDCompoundingFreq = 'QUARTERLY',
): number {
  if (monthlyInstallmentPaisa <= 0 || tenureMonths <= 0) {
    return Math.max(0, monthlyInstallmentPaisa) * Math.max(0, tenureMonths);
  }
  const r = annualRatePct / 100;
  const n = N_PER_YEAR[compoundingFreq];
  let total = 0;
  for (let k = 1; k <= tenureMonths; k++) {
    const monthsRemaining = tenureMonths - k + 1;
    total += monthlyInstallmentPaisa * Math.pow(1 + r / n, (n * monthsRemaining) / 12);
  }
  return Math.round(total);
}

/** Total deposited over the RD's life (paisa). */
export function rdTotalDepositPaisa(
  monthlyInstallmentPaisa: number,
  tenureMonths: number,
): number {
  return Math.max(0, monthlyInstallmentPaisa) * Math.max(0, tenureMonths);
}

/**
 * Interest earned over the full term = maturity − total deposited.
 */
export function rdTotalInterestPaisa(
  monthlyInstallmentPaisa: number,
  annualRatePct: number,
  tenureMonths: number,
  compoundingFreq: RDCompoundingFreq = 'QUARTERLY',
): number {
  const maturity = calculateRdMaturityPaisa(
    monthlyInstallmentPaisa,
    annualRatePct,
    tenureMonths,
    compoundingFreq,
  );
  return Math.max(0, maturity - rdTotalDepositPaisa(monthlyInstallmentPaisa, tenureMonths));
}

/**
 * Add a whole number of months to an ISO date (YYYY-MM-DD), returning ISO.
 * Clamps end-of-month overflow (e.g. Jan 31 + 1mo → Feb 28/29).
 */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0); // overflowed into next month → clamp back
  return d.toISOString().slice(0, 10);
}
