/**
 * EMI helpers — all amounts in the same unit (paisa or rupees).
 * Functions are unit-agnostic; the caller is responsible for unit consistency.
 */

/** Equated Monthly Installment: P × r × (1+r)^n / ((1+r)^n − 1) */
export function calculateEmi(
  principal: number,
  annualRate: number,
  tenureMonths: number
): number {
  if (principal <= 0 || tenureMonths <= 0) return 0;
  const monthlyRate = annualRate / 12 / 100;
  if (monthlyRate === 0) return Math.round(principal / tenureMonths);
  const emi =
    (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
    (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  return Math.round(emi);
}

export interface AmortizationRow {
  month: number;
  opening: number;
  interest: number;
  principal: number;
  closing: number;
  emi: number;
}

/** Generate an amortization schedule for N months starting from current outstanding. */
export function amortizationSchedule(
  outstanding: number,
  annualRate: number,
  monthsRemaining: number,
  emi: number
): AmortizationRow[] {
  const schedule: AmortizationRow[] = [];
  const monthlyRate = annualRate / 12 / 100;
  let balance = outstanding;
  for (let i = 1; i <= Math.min(monthsRemaining, 360); i++) {
    const interest = Math.round(balance * monthlyRate);
    const principal = Math.min(emi - interest, balance);
    const closing = balance - principal;
    schedule.push({ month: i, opening: balance, interest, principal, closing, emi });
    balance = closing;
    if (balance <= 0) break;
  }
  return schedule;
}
