/**
 * Prepayment simulator — pure math, no UI.
 *
 * Models "tenure reduction" prepayment: EMI stays constant; extra payments
 * (monthly recurring and/or one-time lump sum) reduce principal directly,
 * shortening the loan. This matches how Indian banks default-treat prepayment
 * on floating/standard loans, and matches the user's stated question: "how
 * much interest do I save and how soon does the loan close?".
 *
 * All money in paisa (integer); annualRate as a percent (e.g. 9.5).
 */

export interface PrepayInput {
  /** Current outstanding principal (paisa). */
  outstandingPaisa: number;
  /** Annual interest rate, percent. */
  annualRate: number;
  /** Base contractual EMI (paisa). */
  baseEmiPaisa: number;
  /** Extra principal paid every month on top of EMI (paisa). */
  monthlyExtraPaisa: number;
  /** One-time lump-sum prepayment applied today, before next EMI (paisa). */
  lumpSumPaisa: number;
  /** Prepayment penalty on the lump sum, percent. Defaults to 0. */
  penaltyPct?: number;
}

export interface PrepayResult {
  /** Months until full closure. -1 if the EMI doesn't even cover interest. */
  months: number;
  /** Cumulative interest paid until closure (paisa). */
  totalInterestPaisa: number;
  /** Total cash outflow: EMIs + monthly extras + lump + penalty (paisa). */
  totalPaidPaisa: number;
  /** Balance at the end of each month — length = months + 1, [0] = start. */
  balanceCurve: number[];
  /** Payoff date if a start (next-EMI) date was provided. */
  payoffDateIso: string | null;
}

export interface PrepayComparison {
  base: PrepayResult;
  scenario: PrepayResult;
  /** base − scenario interest, in paisa. Can be negative if penalty dominates. */
  interestSavedPaisa: number;
  /** base − scenario tenure, in months. */
  monthsSaved: number;
}

const MAX_MONTHS = 600; // 50-year safety cap

/**
 * Simulate one prepayment scenario and return its closure path.
 *
 * @param startDate  ISO date of the next EMI (the "month 1" payment date).
 *                   Used only to compute payoffDateIso.
 */
export function simulatePrepay(
  input: PrepayInput,
  startDate?: string | null,
): PrepayResult {
  const {
    outstandingPaisa: O,
    annualRate,
    baseEmiPaisa: E,
    monthlyExtraPaisa: X,
    lumpSumPaisa: L,
    penaltyPct = 0,
  } = input;

  const r = annualRate / 12 / 100;
  const penaltyPaisa = Math.round(L * (penaltyPct / 100));

  // Apply lump sum + penalty at month 0.
  let balance = Math.max(0, O - L);
  const curve: number[] = [balance];

  let interestSum = 0;
  let emisPaid = 0;
  let extrasPaid = 0;
  let months = 0;

  while (balance > 0 && months < MAX_MONTHS) {
    const interest = Math.round(balance * r);
    const principalFromEmi = E - interest;
    const targetDrop = principalFromEmi + X;

    // EMI < interest → loan never closes. Bail.
    if (targetDrop <= 0) {
      return {
        months: -1,
        totalInterestPaisa: -1,
        totalPaidPaisa: -1,
        balanceCurve: curve,
        payoffDateIso: null,
      };
    }

    let drop: number;
    let emiPaidThisMonth: number;
    let extraPaidThisMonth: number;

    if (targetDrop >= balance) {
      // Final month — close out exactly. EMI principal lands first; extra
      // covers the rest. If EMI alone is enough, skip the extra entirely.
      drop = balance;
      if (principalFromEmi >= balance) {
        emiPaidThisMonth = balance + interest;
        extraPaidThisMonth = 0;
      } else {
        emiPaidThisMonth = E;
        extraPaidThisMonth = balance - principalFromEmi;
      }
    } else {
      drop = targetDrop;
      emiPaidThisMonth = E;
      extraPaidThisMonth = X;
    }

    balance -= drop;
    interestSum += interest;
    emisPaid += emiPaidThisMonth;
    extrasPaid += extraPaidThisMonth;
    curve.push(balance);
    months += 1;
  }

  return {
    months,
    totalInterestPaisa: interestSum,
    totalPaidPaisa: emisPaid + extrasPaid + L + penaltyPaisa,
    balanceCurve: curve,
    payoffDateIso: addMonthsEom(startDate, months),
  };
}

/**
 * Run baseline (no prepay) and scenario side-by-side and return the deltas.
 */
export function comparePrepay(
  input: PrepayInput,
  startDate?: string | null,
): PrepayComparison {
  const base = simulatePrepay(
    { ...input, monthlyExtraPaisa: 0, lumpSumPaisa: 0, penaltyPct: 0 },
    startDate,
  );
  const scenario = simulatePrepay(input, startDate);
  return {
    base,
    scenario,
    interestSavedPaisa:
      base.totalInterestPaisa < 0 || scenario.totalInterestPaisa < 0
        ? 0
        : base.totalInterestPaisa - scenario.totalInterestPaisa,
    monthsSaved:
      base.months < 0 || scenario.months < 0 ? 0 : base.months - scenario.months,
  };
}

/**
 * Add `months` to startDate (ISO) and snap to end-of-month. Used so the payoff
 * date reads as the last day of the closure month — matches how banks present
 * EMI due dates (last working day of month).
 */
function addMonthsEom(startDate: string | null | undefined, months: number): string | null {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (isNaN(d.getTime())) return null;
  // monthIndex of payoff month = startMonth + (months - 1). If months=0 (lump
  // closed it), payoff = startMonth − 1 end-of-month, i.e. last month.
  const refMonth = d.getUTCMonth() + Math.max(0, months - 1);
  const eom = new Date(Date.UTC(d.getUTCFullYear(), refMonth + 1, 0));
  return eom.toISOString().slice(0, 10);
}
