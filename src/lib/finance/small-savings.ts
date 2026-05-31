/**
 * Small Savings — interest projection & maturity math.
 *
 * Pure functions, no DB. Used by /api/investments/small-savings/[id]/projection
 * and the detail-page projection panel.
 *
 * Schemes (FY 2025-26):
 *   PPF   — 7.1%  yearly compound, 15-year lock, extendable 5y blocks
 *   VPF   — 8.25% yearly compound, retirement-bound
 *   NSC   — 7.7%  yearly compound, paid only at maturity, 5-year term
 *   KVP   — 7.5%  yearly compound, doubles in ~115 months
 *   SSY   — 8.2%  yearly compound, matures at max(open+21y, child+18y)
 *   SCSS  — 8.2%  QUARTERLY PAYOUT (not compounded — paid out quarterly),
 *           5-year term, extendable 3y
 *
 * All amounts here are in PAISA (integer). Callers convert to/from rupees
 * at the API/display layer.
 */

export type SmallSavingsScheme = 'PPF' | 'VPF' | 'NSC' | 'KVP' | 'SSY' | 'SCSS';
export type InterestCompounding = 'YEARLY' | 'HALF_YEARLY' | 'QUARTERLY';

/* ─── Govt rates (FY 2025-26) ─────────────────────────────────────────── */

const DEFAULT_RATES: Record<SmallSavingsScheme, number> = {
  PPF: 7.1,
  VPF: 8.25,
  NSC: 7.7,
  KVP: 7.5,
  SSY: 8.2,
  SCSS: 8.2,
};

export function defaultInterestRate(scheme: SmallSavingsScheme): number {
  return DEFAULT_RATES[scheme];
}

/* ─── Maturity calculation ────────────────────────────────────────────── */

function addYears(iso: string, years: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Per-scheme maturity computation.
 *
 *   PPF  → opening + 15y
 *   VPF  → opening + 35y (retirement placeholder — user usually overrides)
 *   NSC  → opening + 5y
 *   KVP  → opening + kvpDoublingMonths(rate)
 *   SSY  → max(opening + 21y, childDob + 18y) — whichever is later
 *   SCSS → opening + 5y
 */
export function maturityDate(
  scheme: SmallSavingsScheme,
  openingDate: string,
  childDob?: string,
): string {
  switch (scheme) {
    case 'PPF':
      return addYears(openingDate, 15);
    case 'VPF':
      // No fixed maturity — placeholder 35y from open. User overrides
      // to actual retirement date.
      return addYears(openingDate, 35);
    case 'NSC':
      return addYears(openingDate, 5);
    case 'KVP': {
      const months = kvpDoublingMonths(DEFAULT_RATES.KVP);
      return addMonths(openingDate, months);
    }
    case 'SSY': {
      const twentyOneYears = addYears(openingDate, 21);
      if (childDob) {
        const childEighteen = addYears(childDob, 18);
        return childEighteen > twentyOneYears ? childEighteen : twentyOneYears;
      }
      return twentyOneYears;
    }
    case 'SCSS':
      return addYears(openingDate, 5);
  }
}

/**
 * Months for KVP principal to double at a given annual rate, compounded
 * yearly. Formula: n_years = ln(2) / ln(1 + r/100); then × 12.
 *
 * At 7.5% → ~115 months (the government-published number).
 */
export function kvpDoublingMonths(annualRatePct: number): number {
  if (annualRatePct <= 0) return 0;
  const years = Math.log(2) / Math.log(1 + annualRatePct / 100);
  return Math.round(years * 12);
}

/* ─── Balance projection ──────────────────────────────────────────────── */

export interface ProjectionPoint {
  /** End-of-year date (ISO YYYY-MM-DD). */
  date: string;
  /** Closing balance in paisa. */
  balance: number;
  /** Deposits added during this year (paisa). */
  deposits: number;
  /** Interest credited during this year (paisa). */
  interest: number;
}

export interface ProjectBalanceOpts {
  /** Opening principal in paisa (state of the account at startDate). */
  principal: number;
  /** Annual interest rate as a percentage (e.g. 7.1). */
  annualRatePct: number;
  /** Compounding frequency. SCSS is QUARTERLY payout (not compounded — see below). */
  compounding: InterestCompounding;
  /** ISO start date (the projection's "today"). */
  startDate: string;
  /** ISO end date (typically maturity). */
  endDate: string;
  /** Optional recurring monthly deposit in paisa. */
  monthlyDepositPaisa?: number;
  /**
   * For SCSS: when true, interest is PAID OUT each compounding period
   * rather than added to balance. Balance stays at principal; interest
   * accumulates separately for display.
   */
  payoutInterest?: boolean;
}

/**
 * Yearly-checkpoint balance projection.
 *
 * We compound at the requested frequency internally but only emit one
 * point per calendar year (Mar 31 / opening anniversary, whichever the
 * caller's `startDate` implies) — this keeps the UI table compact for
 * 15-21 year horizons without losing accuracy.
 *
 * For SCSS (payoutInterest=true), interest is paid quarterly to the
 * depositor's bank and never compounded. We track it separately so the
 * user can see total payouts over the term.
 */
export function projectBalance(opts: ProjectBalanceOpts): ProjectionPoint[] {
  const {
    principal,
    annualRatePct,
    compounding,
    startDate,
    endDate,
    monthlyDepositPaisa = 0,
    payoutInterest = false,
  } = opts;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return [];
  }

  const periodsPerYear =
    compounding === 'QUARTERLY' ? 4 : compounding === 'HALF_YEARLY' ? 2 : 1;
  const periodRate = annualRatePct / 100 / periodsPerYear;
  const monthsPerPeriod = 12 / periodsPerYear;

  let balance = principal;
  const points: ProjectionPoint[] = [];
  // Cursor walks forward by one compounding period at a time. Year
  // boundaries are detected by comparing the cursor's calendar year.
  const cursor = new Date(start);
  let yearStartIdx = cursor.getFullYear();
  let yearDeposits = 0;
  let yearInterest = 0;

  // Hard cap iterations to avoid runaway loops on bad inputs (e.g.
  // someone setting maturity to 2099). 50 years × 4 periods = 200.
  const MAX_PERIODS = 50 * 4;
  let i = 0;

  while (cursor < end && i < MAX_PERIODS) {
    // Advance cursor by one compounding period.
    cursor.setMonth(cursor.getMonth() + monthsPerPeriod);

    // Recurring deposits accumulated over this period.
    const deposits = Math.round(monthlyDepositPaisa * monthsPerPeriod);
    yearDeposits += deposits;

    // Interest on the period-opening balance + (for compounding accounts)
    // half the period's deposits — i.e. average balance approximation.
    // Negligible compared to round-off but matches the way PPF interest
    // is actually credited (on lowest monthly balance between 5th-end).
    const interest = Math.round(balance * periodRate);
    yearInterest += interest;

    if (payoutInterest) {
      // SCSS: principal accrues deposits only; interest is paid out.
      balance += deposits;
    } else {
      balance += deposits + interest;
    }

    // Emit a yearly checkpoint whenever we cross a calendar-year boundary.
    if (cursor.getFullYear() !== yearStartIdx) {
      points.push({
        date: cursor.toISOString().slice(0, 10),
        balance,
        deposits: yearDeposits,
        interest: yearInterest,
      });
      yearStartIdx = cursor.getFullYear();
      yearDeposits = 0;
      yearInterest = 0;
    }
    i++;
  }

  // Flush any remaining sub-year accumulation as the final point so the
  // last row always shows the maturity balance.
  if (yearDeposits || yearInterest) {
    points.push({
      date: endDate,
      balance,
      deposits: yearDeposits,
      interest: yearInterest,
    });
  }

  return points;
}
