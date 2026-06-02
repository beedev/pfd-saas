/**
 * Loan tax deduction aggregator — Sprint 5.9b.
 *
 * Pure compute that walks ACTIVE liabilities + their amortization
 * schedule (derived on-the-fly via amortizationSchedule from emi.ts)
 * and produces FY-aggregated principal + interest sums per loan,
 * honouring the principal_qualifies_80c / interest_qualifies_24b
 * flags.
 *
 * Why this lives in /lib (and not just inline in the route):
 *   - /api/tax/regime-compare, /api/tax/itr*\/summary, AND the new
 *     /api/finance/loan-tax-deductions all need the same per-FY
 *     splits. Single source of truth keeps the three surfaces from
 *     drifting.
 *   - No DB access here — the caller fetches the loans and passes
 *     them in. Keeps this lib trivially testable.
 *
 * Output convention: all paisa-denominated. Per-liability rows always
 * include the qualifying flags so the caller can audit "was this loan
 * actually counted?" without re-querying.
 */

import { amortizationSchedule } from './emi';

/**
 * Shape of a liabilities row the aggregator needs. The fuller type
 * from the db module is a superset — pass the row in directly.
 */
export interface LoanTaxInputRow {
  id: number;
  name: string;
  type: string;
  status: string | null;
  currentBalance: number;   // paisa
  originalAmount: number;   // paisa
  interestRate: number;     // annual %
  monthlyEmi: number;       // paisa
  startDate: string;        // ISO date
  maturityDate: string | null;
  remainingTenor: number | null;  // months remaining at "today"
  principalQualifies80c: boolean;
  interestQualifies24b: boolean;
}

export interface LoanTaxPerLiability {
  id: number;
  name: string;
  type: string;
  principalQualifies80c: boolean;
  interestQualifies24b: boolean;
  /** Months of the FY that the loan was actually paid for (intersection
   *  of FY window with loan start..maturity window). 0 if the loan
   *  wasn't active during the FY at all. */
  fyMonthsActive: number;
  /** Sum of principal paid during the FY window (paisa). */
  fyPrincipalPaisa: number;
  /** Sum of interest paid during the FY window (paisa). */
  fyInterestPaisa: number;
}

export interface LoanTaxDeductionResult {
  /** Sum of fyInterestPaisa across loans where interest_qualifies_24b=true. */
  totalInterestPaisa: number;
  /** Sum of fyPrincipalPaisa across loans where principal_qualifies_80c=true. */
  totalPrincipalPaisa: number;
  perLiability: LoanTaxPerLiability[];
}

/** Convert an FY string "2025-26" → start + end ISO dates. */
export function fyDateRange(fy: string): { start: string; end: string } | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

/**
 * Walk the amortization schedule for a single loan and pick out the
 * rows whose monthly due date falls inside the FY window. Returns the
 * principal + interest sums across those rows.
 *
 * Schedule derivation: we re-amortize from the CURRENT outstanding
 * balance over the remaining tenor at the row's interest rate +
 * monthlyEmi. This is the same approach the loan detail page already
 * uses (amortizationSchedule(currentBalance, ...)).
 *
 * Month dates: future months come from the schedule anchored at
 * today + N months. Past months in the FY are reconstructed by
 * reverse-walking the same EMI breakdown back from today's balance.
 *
 * NOTE: when remainingTenor is missing/0, the schedule is empty and we
 * return zeros. Caller should never reach here for closed loans
 * (filter status=ACTIVE upstream).
 */
function fyAggregateForLoan(
  loan: LoanTaxInputRow,
  fyStart: string,
  fyEnd: string,
): { months: number; principal: number; interest: number } {
  if (loan.currentBalance <= 0) return { months: 0, principal: 0, interest: 0 };

  let monthsRemaining = loan.remainingTenor ?? 0;
  if (!monthsRemaining && loan.maturityDate) {
    const m = monthsBetween(new Date(), new Date(loan.maturityDate));
    monthsRemaining = Math.max(0, m);
  }

  const today = new Date();
  let months = 0;
  let principalSum = 0;
  let interestSum = 0;

  if (monthsRemaining > 0) {
    const schedule = amortizationSchedule(
      loan.currentBalance,
      loan.interestRate,
      monthsRemaining,
      loan.monthlyEmi,
    );
    for (const row of schedule) {
      const due = addMonths(today, row.month);
      const iso = due.toISOString().slice(0, 10);
      if (iso >= fyStart && iso <= fyEnd) {
        months += 1;
        principalSum += row.principal;
        interestSum += row.interest;
      }
    }
  }

  // Back-fill the FY months that have already passed. For BXDEva's
  // home loan starting 2018 with maturity 2038, FY 2025-26 (Apr-2025
  // .. Mar-2026) is almost entirely in the past relative to today
  // (2026-06). The forward schedule above only covers Apr-2026
  // onward.
  const historicalBack = backfillHistoricalFyMonths(loan, fyStart, fyEnd, today);
  months += historicalBack.months;
  principalSum += historicalBack.principal;
  interestSum += historicalBack.interest;

  return { months, principal: principalSum, interest: interestSum };
}

/** Walk BACKWARDS from today's outstanding balance to reconstruct the
 *  principal/interest splits for past months that fell inside the FY.
 *  Uses the same EMI math, just inverted:
 *    closing = opening * (1+r) − emi
 *    ⇒ opening = (closing + emi) / (1+r)
 *  Then principal_n = emi − opening * r and interest_n = opening * r.
 */
function backfillHistoricalFyMonths(
  loan: LoanTaxInputRow,
  fyStart: string,
  fyEnd: string,
  today: Date,
): { months: number; principal: number; interest: number } {
  const loanStart = new Date(loan.startDate);
  const fyStartDate = new Date(fyStart);
  const fyEndDate = new Date(fyEnd);
  const earliest = loanStart > fyStartDate ? loanStart : fyStartDate;
  if (earliest > fyEndDate) return { months: 0, principal: 0, interest: 0 };

  // We anchor the reverse walk at TODAY (i=0 is today's outstanding
  // → undo back one month to land at last month's opening balance, etc).
  // The total walk length must cover from today all the way back to the
  // earliest in-scope month, regardless of whether the FY has already
  // ended — months past the FY end on the today-side are skipped but
  // the balance walk-back still has to traverse them.
  const monthsToWalk = monthsBetween(earliest, today);
  if (monthsToWalk <= 0) return { months: 0, principal: 0, interest: 0 };

  const monthlyRate = loan.interestRate / 12 / 100;
  let balance = loan.currentBalance;
  let months = 0;
  let principalSum = 0;
  let interestSum = 0;

  // Cap at 60 months — anything further than 5 years back exceeds
  // typical tax-relevance windows (and protects against runaway when
  // start_date is a sentinel like 1970-01-01).
  for (let i = 0; i < Math.min(monthsToWalk + 1, 60); i++) {
    const monthDate = addMonths(today, -i);
    const iso = monthDate.toISOString().slice(0, 10);

    if (iso < fyStart || iso > fyEnd) {
      // Outside FY but still walking the balance back for context.
      balance = (balance + loan.monthlyEmi) / (1 + monthlyRate);
      continue;
    }

    const opening = (balance + loan.monthlyEmi) / (1 + monthlyRate);
    const interestN = opening * monthlyRate;
    const principalN = loan.monthlyEmi - interestN;
    principalSum += Math.round(principalN);
    interestSum += Math.round(interestN);
    months += 1;
    balance = opening;

    // Safety: if opening exceeds original amount * 1.05, we've walked
    // beyond loan origination — stop.
    if (opening > loan.originalAmount * 1.05) break;
  }

  return { months, principal: principalSum, interest: interestSum };
}

/** Difference in calendar months between two dates (positive when b > a). */
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Add N months to a date (N can be negative). Returns a new Date. */
function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

/**
 * Aggregate FY-window splits across all loans.
 *
 * Only loans whose status is null/'ACTIVE' AND (
 *   principal_qualifies_80c OR interest_qualifies_24b
 * ) contribute. The per-liability rows surface ALL such loans even
 * when both flags are false — useful for the future "would qualify if
 * you toggled this" hint.
 */
export function aggregateLoanTaxDeductions(
  loans: LoanTaxInputRow[],
  fy: string,
): LoanTaxDeductionResult | { error: string } {
  const bounds = fyDateRange(fy);
  if (!bounds) return { error: 'Invalid fy format, use YYYY-YY' };

  const perLiability: LoanTaxPerLiability[] = [];
  let totalInterest = 0;
  let totalPrincipal = 0;

  for (const loan of loans) {
    if (loan.status && loan.status !== 'ACTIVE') continue;
    if (!loan.principalQualifies80c && !loan.interestQualifies24b) continue;

    const split = fyAggregateForLoan(loan, bounds.start, bounds.end);
    perLiability.push({
      id: loan.id,
      name: loan.name,
      type: loan.type,
      principalQualifies80c: loan.principalQualifies80c,
      interestQualifies24b: loan.interestQualifies24b,
      fyMonthsActive: split.months,
      fyPrincipalPaisa: split.principal,
      fyInterestPaisa: split.interest,
    });
    if (loan.principalQualifies80c) totalPrincipal += split.principal;
    if (loan.interestQualifies24b) totalInterest += split.interest;
  }

  return {
    totalInterestPaisa: totalInterest,
    totalPrincipalPaisa: totalPrincipal,
    perLiability,
  };
}
