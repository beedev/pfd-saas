/**
 * Chit Fund Returns Calculator
 *
 * Models a chit fund where:
 * - V = chit value (paisa). Total prize pool.
 * - N = duration in months (= number of members in a single-ticket scenario).
 * - M = monthly installment (paisa). For face-value chits: M = V / N.
 * - c = foreman commission as fraction of V (typical: 0.05).
 * - B_avg = average winning bid in months OTHER than yours (paisa). Typical: 0.70 * V.
 * - K = the month YOU win (1..N).
 * - B_your = the bid YOU accept in month K (paisa). Lower = more discount = more dividend.
 *
 * Mechanic: each auction month, winner accepts B (< V). Discount D = V - B.
 * Foreman takes c*V from the pool. Remaining V*(1-c) - B is distributed equally
 * across all N members as dividend that month, reducing each member's net outflow.
 *
 * Note: This model assumes face-value contributions (every member pays M each
 * month, dividend is offset). It ignores GST, late fees, and assumes perfect
 * auction dynamics with B_avg representing the steady-state market price.
 */
import { calculateXirr } from '@/lib/finance/xirr';

export interface ChitCalcParams {
  chitValue: number;        // paisa
  months: number;            // N
  monthlyInstallment: number; // paisa, typically V/N
  foremanCommissionPct: number; // %, e.g. 5
  avgWinningBidPct: number;   // %, e.g. 70 (=> avg bid is 70% of chit value)
  winMonth: number;            // 1..N
  yourBid: number;             // paisa, must be <= chit value
  fdRatePct: number;            // %, e.g. 8
  startDate?: Date;             // first installment date; defaults to today
}

export interface ChitCalcResult {
  totalContributions: number;   // paisa, sum of all M
  totalDividendsEarned: number; // paisa, your share over N months
  bidReceived: number;           // paisa, B_your
  netProfit: number;             // paisa, received - paid (no time value)
  xirrSpendNow: number;          // %, IRR if bid is consumed at win month
  xirrFdReinvested: number;      // %, IRR if bid is reinvested at FD rate until N
  fdGrowthFromBid: number;       // paisa, terminal FD value of bid - bid principal
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function buildCashFlows(p: ChitCalcParams, scenario: 'spend' | 'fd'): { date: Date; amount: number }[] {
  const c = p.foremanCommissionPct / 100;
  const bAvg = (p.avgWinningBidPct / 100) * p.chitValue;
  const otherDiv = Math.max(0, p.chitValue * (1 - c) - bAvg) / p.months;
  const ownDiv = Math.max(0, p.chitValue * (1 - c) - p.yourBid) / p.months;
  const start = p.startDate ?? new Date();

  const flows: { date: Date; amount: number }[] = [];
  for (let j = 1; j <= p.months; j++) {
    const date = addMonths(start, j - 1);
    let net = -p.monthlyInstallment;
    if (j === p.winMonth) {
      net += ownDiv;
      if (scenario === 'spend') net += p.yourBid;
    } else {
      net += otherDiv;
    }
    flows.push({ date, amount: net });
  }

  if (scenario === 'fd') {
    // Reinvest the bid at FD rate from month K to month N.
    const monthsInvested = p.months - p.winMonth;
    const monthlyRate = p.fdRatePct / 100 / 12;
    const fdValue = p.yourBid * Math.pow(1 + monthlyRate, monthsInvested);
    flows[p.months - 1].amount += fdValue;
  }
  return flows;
}

export function computeChitReturns(p: ChitCalcParams): ChitCalcResult {
  if (p.winMonth < 1 || p.winMonth > p.months) {
    throw new Error('winMonth must be between 1 and months');
  }

  const c = p.foremanCommissionPct / 100;
  const bAvg = (p.avgWinningBidPct / 100) * p.chitValue;
  const otherDiv = Math.max(0, p.chitValue * (1 - c) - bAvg) / p.months;
  const ownDiv = Math.max(0, p.chitValue * (1 - c) - p.yourBid) / p.months;

  const totalContributions = p.monthlyInstallment * p.months;
  const totalDividendsEarned = otherDiv * (p.months - 1) + ownDiv;
  const netProfit = p.yourBid + totalDividendsEarned - totalContributions;

  const monthlyRate = p.fdRatePct / 100 / 12;
  const fdValue = p.yourBid * Math.pow(1 + monthlyRate, p.months - p.winMonth);
  const fdGrowthFromBid = fdValue - p.yourBid;

  const flowsSpend = buildCashFlows(p, 'spend');
  const flowsFd = buildCashFlows(p, 'fd');

  // Convert paisa flows to rupees for xirr (existing helper expects rupees)
  const xirrSpendPct = calculateXirr(flowsSpend.map((f) => ({ amount: f.amount / 100, when: f.date })));
  const xirrFdPct = calculateXirr(flowsFd.map((f) => ({ amount: f.amount / 100, when: f.date })));

  return {
    totalContributions,
    totalDividendsEarned,
    bidReceived: p.yourBid,
    netProfit,
    xirrSpendNow: xirrSpendPct ?? 0,
    xirrFdReinvested: xirrFdPct ?? 0,
    fdGrowthFromBid,
  };
}

// ============================================================================
// Mid-flight Bid Advisor — uses real past data + future projection
// ============================================================================

export interface MidFlightPastInstallment {
  monthNumber: number;
  paidOn: string;          // ISO date
  installmentPaid: number; // paisa — what user actually paid (after dividend)
  dividendReceived: number; // paisa — dividend earned that month
}

export interface MidFlightBidArgs {
  chitValue: number;                 // paisa, V
  months: number;                     // N
  monthlyInstallment: number;         // paisa, M (= V/N for face-value)
  foremanCommissionPct: number;       // %, c (5 for DNC, 7 for Dhanalakshmi)
  documentChargesPaisa: number;       // paisa, fixed deduction from winner's cheque (e.g., ₹15,000)
  promptPaymentDiscountPct: number;   // %, e.g. 1 — discount on net installment for on-time pay
  pastInstallments: MidFlightPastInstallment[];
  currentMonth: number;               // K
  /**
   * Bid given up (discount) in paisa. South Indian convention.
   * Must be >= foreman commission (= c × V), since foreman is always taken
   * first from the bid pool. At minimum bid, dividend = 0 (natural-end case).
   */
  yourBid: number;
  futureDividendPct: number;          // % of installment expected each remaining month (effective: dividend + prompt benefit)
  fdRatePct: number;                  // % annual FD rate
  startDate: string;                  // ISO
}

export interface MidFlightBidResult {
  xirrSpendNow: number | null;
  xirrFdReinvested: number | null;
  netProfit: number;                 // paisa (no time value)
  fdGrowthFromBid: number;            // paisa
  winnerCheque: number;                // paisa — V − bid − foreman − docCharges
  ownDividendAtWin: number;            // paisa — your share of this month's distributable
  netInstallmentForOthers: number;     // paisa — what each non-winner pays this month (with prompt discount)
  futureMonthlyOutgo: number;          // paisa — projected outflow per future month
  totalContributedAtEnd: number;       // paisa
  totalDividendsAtEnd: number;         // paisa
  naturalEndCheque: number;            // paisa — what you'd get if you bid the minimum (V − C − docCharges)
  minBidPaisa: number;                 // paisa — foreman commission, floor for any bid
  foremanCommissionAtWin: number;      // paisa — what the foreman takes from your bid
  distributablePool: number;           // paisa — bid − foreman, distributed as dividend
}

/**
 * Build cash flow array under verified South Indian formula:
 *   bid = discount given up by winner
 *   foremanCommission = c × V (taken first from bid pool)
 *   distributable = max(0, bid − foremanCommission)
 *   dividendPerMember = distributable / N
 *   winnerCheque = V − bid − foremanCommission − documentCharges
 *   netInstallment (others) = (M − dividendPerMember) × (1 − promptDiscount)
 */
function buildMidFlightFlows(
  args: MidFlightBidArgs,
  scenario: 'spend' | 'fd',
): { date: Date; amount: number }[] {
  const foremanCommission = (args.foremanCommissionPct / 100) * args.chitValue;
  const distributable = Math.max(0, args.yourBid - foremanCommission);
  const ownDiv = distributable / args.months;
  // Accounting: V = foreman + docCharges + winnerCheque + distributable
  // → winnerCheque = V − bid − docCharges (foreman is INSIDE the bid pool)
  const winnerCheque =
    args.chitValue - args.yourBid - args.documentChargesPaisa;
  const promptFactor = 1 - args.promptPaymentDiscountPct / 100;

  const start = new Date(args.startDate);
  const flows: { date: Date; amount: number }[] = [];

  // Past flows — verbatim from DB. Already includes both dividend AND prompt benefit.
  for (const p of args.pastInstallments) {
    flows.push({ date: new Date(p.paidOn), amount: -p.installmentPaid / 100 });
  }

  // Win month K
  // Cash this month = -(M − ownDiv) × promptFactor + winnerCheque (if spend)
  const winDate = addMonths(start, args.currentMonth - 1);
  let winFlow = -(args.monthlyInstallment - ownDiv) * promptFactor;
  if (scenario === 'spend') winFlow += winnerCheque;
  flows.push({ date: winDate, amount: winFlow / 100 });

  // Future months K+1..N — linear decay from futureDividendPct (now) to 0 (last month).
  // Reflects the real-world pattern: as fewer non-winners remain, bids drop and
  // dividends shrink. By the last month there's no auction left → 0 dividend.
  const monthsRemainingTotal = args.months - args.currentMonth;
  for (let j = args.currentMonth + 1; j <= args.months; j++) {
    const monthsToEnd = args.months - j;
    const decayFactor = monthsRemainingTotal > 1 ? monthsToEnd / (monthsRemainingTotal - 1) : 0;
    const divRate = (args.futureDividendPct / 100) * decayFactor;
    const netOutflow = args.monthlyInstallment * (1 - divRate);
    const date = addMonths(start, j - 1);
    flows.push({ date, amount: -netOutflow / 100 });
  }

  // Terminal FD value of the cheque (Scenario A only)
  if (scenario === 'fd') {
    const monthsInvested = args.months - args.currentMonth;
    const monthlyRate = args.fdRatePct / 100 / 12;
    const fdValue = winnerCheque * Math.pow(1 + monthlyRate, monthsInvested);
    const lastDate = addMonths(start, args.months - 1);
    const last = flows[flows.length - 1];
    if (last && last.date.getTime() === lastDate.getTime()) {
      last.amount += fdValue / 100;
    } else {
      flows.push({ date: lastDate, amount: fdValue / 100 });
    }
  }

  return flows;
}

export function computeMidFlightBid(args: MidFlightBidArgs): MidFlightBidResult {
  const foremanCommission = (args.foremanCommissionPct / 100) * args.chitValue;
  const distributable = Math.max(0, args.yourBid - foremanCommission);
  const ownDiv = distributable / args.months;
  // Accounting: V = foreman + docCharges + winnerCheque + distributable
  // → winnerCheque = V − bid − docCharges (foreman is INSIDE the bid pool)
  const winnerCheque =
    args.chitValue - args.yourBid - args.documentChargesPaisa;
  // Natural-end case: bid = foreman (minimum), so:
  // winnerCheque = V − foreman − docCharges
  const naturalEndCheque =
    args.chitValue - foremanCommission - args.documentChargesPaisa;
  const promptFactor = 1 - args.promptPaymentDiscountPct / 100;
  const netInstallmentForOthers =
    (args.monthlyInstallment - ownDiv) * promptFactor;

  const monthsRemainingAfterWin = args.months - args.currentMonth;
  // Average future dividend = futureDivPct / 2 (linear decay from futureDivPct to 0)
  const avgFutureDivPct = args.futureDividendPct / 2;
  const futureNetOutflow =
    args.monthlyInstallment * (1 - avgFutureDivPct / 100);

  const pastContributedGross =
    args.monthlyInstallment * args.pastInstallments.length;
  const pastDividendsActual = args.pastInstallments.reduce(
    (s, p) => s + p.dividendReceived,
    0,
  );
  const winMonthGross = args.monthlyInstallment;
  const futureGross = args.monthlyInstallment * monthsRemainingAfterWin;
  const totalContributedAtEnd =
    pastContributedGross + winMonthGross + futureGross;
  const futureDivAvgPaisa =
    (args.monthlyInstallment * avgFutureDivPct) / 100;
  const totalDividendsAtEnd =
    pastDividendsActual + ownDiv + futureDivAvgPaisa * monthsRemainingAfterWin;

  const monthlyRate = args.fdRatePct / 100 / 12;
  const fdValue = winnerCheque * Math.pow(1 + monthlyRate, monthsRemainingAfterWin);
  const fdGrowthFromBid = fdValue - winnerCheque;

  // Effective net profit = chit cash flow + money-rate gain on the cheque.
  // Without this, net would show pure-cash difference and appear negative even
  // when XIRR is positive (because XIRR factors in time value of money).
  const netProfit =
    winnerCheque + fdGrowthFromBid + totalDividendsAtEnd - totalContributedAtEnd;

  const xirrSpendNow = calculateXirr(
    buildMidFlightFlows(args, 'spend').map((f) => ({ when: f.date, amount: f.amount })),
  );
  const xirrFdReinvested = calculateXirr(
    buildMidFlightFlows(args, 'fd').map((f) => ({ when: f.date, amount: f.amount })),
  );

  return {
    xirrSpendNow,
    xirrFdReinvested,
    netProfit,
    fdGrowthFromBid,
    winnerCheque,
    ownDividendAtWin: ownDiv,
    netInstallmentForOthers,
    futureMonthlyOutgo: futureNetOutflow,
    totalContributedAtEnd,
    totalDividendsAtEnd,
    naturalEndCheque,
    minBidPaisa: foremanCommission,
    foremanCommissionAtWin: foremanCommission,
    distributablePool: distributable,
  };
}

/**
 * Sweep bid (discount given up) and find the bid that maximizes XIRR for the
 * chosen scenario. Range: [foremanCommission, 30% × V] in 0.5% steps.
 */
export function bestMidFlightBid(
  args: Omit<MidFlightBidArgs, 'yourBid'>,
  scenario: 'spend' | 'fd',
): { bestBidPct: number; bestBidPaisa: number; bestXirr: number } {
  const foremanCommission = (args.foremanCommissionPct / 100) * args.chitValue;
  const minBidPct = args.foremanCommissionPct;  // bid floor = foreman commission
  const maxBidPct = 30;                          // 30% of V is a typical max in active chits
  let best = { bestBidPct: minBidPct, bestBidPaisa: foremanCommission, bestXirr: -Infinity };
  for (let pct = minBidPct; pct <= maxBidPct; pct += 0.5) {
    const bid = Math.round((pct / 100) * args.chitValue);
    const r = computeMidFlightBid({ ...args, yourBid: bid });
    const x = scenario === 'spend' ? r.xirrSpendNow : r.xirrFdReinvested;
    if (x != null && x > best.bestXirr) {
      best = { bestBidPct: pct, bestBidPaisa: bid, bestXirr: x };
    }
  }
  return best;
}

/**
 * Binary search for the lowest bid that still hits the target XIRR.
 * Below this bid → skip. Returns null if no bid in [minBid, 30%V] achieves target.
 */
export function breakEvenMidFlightBid(
  args: Omit<MidFlightBidArgs, 'yourBid'>,
  targetXirrPct: number,
  scenario: 'spend' | 'fd' = 'fd',
): number | null {
  const foremanCommission = (args.foremanCommissionPct / 100) * args.chitValue;
  let lo = foremanCommission;
  let hi = Math.round(args.chitValue * 0.30);
  let result: number | null = null;
  for (let iter = 0; iter < 30; iter++) {
    const mid = Math.round((lo + hi) / 2);
    const r = computeMidFlightBid({ ...args, yourBid: mid });
    const x = scenario === 'spend' ? r.xirrSpendNow : r.xirrFdReinvested;
    if (x != null && x >= targetXirrPct) {
      result = mid;
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 10000) break; // ₹100 precision
  }
  return result;
}

/**
 * For each possible win month K, compute the XIRR (spend-now scenario)
 * assuming you bid at the average market bid. Returns the curve so the UI
 * can plot it and find the best month visually.
 */
export function bestMonthCurve(
  params: Omit<ChitCalcParams, 'winMonth' | 'yourBid'>,
  bidPctOfValue?: number,
): Array<{ winMonth: number; xirrSpend: number; xirrFd: number }> {
  const bidPct = bidPctOfValue ?? params.avgWinningBidPct;
  const yourBid = (bidPct / 100) * params.chitValue;
  const out: Array<{ winMonth: number; xirrSpend: number; xirrFd: number }> = [];
  for (let k = 1; k <= params.months; k++) {
    const r = computeChitReturns({ ...params, winMonth: k, yourBid });
    out.push({ winMonth: k, xirrSpend: r.xirrSpendNow, xirrFd: r.xirrFdReinvested });
  }
  return out;
}

/**
 * Find the LOWEST bid (highest discount) you can accept in winMonth K and
 * still hit the target return. Bidding below this means you lose money
 * relative to the alternative (FD).
 *
 * Returns null if no bid achieves the target.
 */
export function breakEvenBid(
  params: Omit<ChitCalcParams, 'yourBid'>,
  targetXirrPct: number,
  scenario: 'spend' | 'fd' = 'spend',
): number | null {
  // Binary search on yourBid in range [0, chitValue]
  let lo = 0;
  let hi = params.chitValue;
  let result: number | null = null;
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    const r = computeChitReturns({ ...params, yourBid: mid });
    const x = scenario === 'spend' ? r.xirrSpendNow : r.xirrFdReinvested;
    if (x >= targetXirrPct) {
      result = mid;
      hi = mid; // try lower bid
    } else {
      lo = mid;
    }
    if (hi - lo < 100) break; // ₹1 precision
  }
  return result;
}
