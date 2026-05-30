import { calculateXirr, type CashFlow } from './xirr';
import type { ChitFundStatus } from '@/db';

// Build XIRR cash flows for a chit fund given its installments.
//
// Cash flow model (fixed-installment Indian chit):
//  - Each installment is a NEGATIVE flow = -(installmentPaid - dividendReceived)
//    i.e. net outgo for that month.
//  - If the chit has been WON, add a POSITIVE flow on winDate = winAmountReceived.
//  - For still-ACTIVE chits (not yet won), add a synthetic "current value" inflow
//    representing what the subscriber would notionally get if the chit ended today,
//    set to the running netContribution (so XIRR shows ~0 until dividends/win land).
//    This is an interim projection.
export function buildChitCashFlows(args: {
  installments: Array<{ paidOn: string; installmentPaid: number; dividendReceived: number | null }>;
  status: ChitFundStatus;
  winDate: string | null;
  winAmountReceived: number | null;
  netContributionPaisa: number;
  asOfDate?: Date;
}): CashFlow[] {
  const flows: CashFlow[] = [];
  for (const inst of args.installments) {
    const net = inst.installmentPaid - (inst.dividendReceived ?? 0);
    flows.push({ amount: -(net / 100), when: new Date(inst.paidOn) });
  }
  if (args.status === 'WON' && args.winDate && args.winAmountReceived) {
    flows.push({ amount: args.winAmountReceived / 100, when: new Date(args.winDate) });
  } else if (args.status === 'ACTIVE' && args.netContributionPaisa > 0) {
    flows.push({
      amount: args.netContributionPaisa / 100,
      when: args.asOfDate ?? new Date(),
    });
  }
  return flows;
}

/**
 * Build XIRR cash flows from a chit's high-level summary state — used when
 * we have aggregate totals (total paid, dividends, installments paid) but
 * not the per-installment ledger. This is the path imported chits take.
 *
 * Reconstruction rules
 * --------------------
 * - Distribute the recorded `totalPaidPaisa` evenly across the past months
 *   (one negative flow per past month, starting at startDate). This averages
 *   out the dividend bumps but preserves the realised cash position.
 * - For remaining months until expectedEndDate, project full nominal
 *   `monthlyInstallmentPaisa` outgo per month (no dividend assumed —
 *   conservative; if dividends materialise, real XIRR will be higher).
 * - Add a single positive terminal flow on the expected end date:
 *     - WON chits → use the actual winAmountReceived
 *     - ACTIVE/NPS chits → assume win at face value `chitValuePaisa`
 *       on the last installment date (the worst-case win timing)
 *
 * The result is a meaningful "expected XIRR if I see this through to term".
 */
export function buildChitCashFlowsFromSummary(args: {
  startDate: string;            // ISO YYYY-MM-DD
  expectedEndDate: string;      // ISO
  durationMonths: number;
  installmentsPaid: number;
  monthlyInstallmentPaisa: number;
  totalPaidPaisa: number;
  chitValuePaisa: number;
  status: ChitFundStatus;
  winDate?: string | null;
  winAmountReceivedPaisa?: number | null;
  /**
   * Starting dividend rate (% of monthly installment) used for future months.
   * Decays linearly to 0 by the chit's last month. When omitted, future
   * months use the full nominal installment (legacy conservative behaviour).
   * Pass the historical lifetime dividend % for a realistic projection —
   * especially important for WON chits, where the subscriber still receives
   * a dividend share each month even after winning.
   */
  futureDividendStartPct?: number | null;
  /**
   * If set (and chit is WON), the win cheque is shifted from its actual
   * receipt date to the chit's last installment date, compounded monthly
   * at this annual rate. Models "FD-reinvest" or "loan-avoidance" framings
   * where the cheque grows at the user's money rate from win to chit end.
   * Leave null/undefined to keep the cheque at the actual win date.
   */
  reinvestRatePct?: number | null;
}): CashFlow[] {
  const flows: CashFlow[] = [];
  if (args.durationMonths <= 0 || args.monthlyInstallmentPaisa <= 0) return flows;

  const start = new Date(args.startDate);
  if (Number.isNaN(start.getTime())) return flows;

  // Past flows — average the realised totalPaid across paid installments so
  // each historical month has a meaningful negative flow.
  const paidCount = Math.max(0, Math.min(args.installmentsPaid, args.durationMonths));
  const avgPastOutgo = paidCount > 0 ? args.totalPaidPaisa / paidCount : 0;
  for (let i = 0; i < paidCount; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    flows.push({ amount: -(avgPastOutgo / 100), when: d });
  }

  // Future flows. If a starting dividend rate is supplied, apply a linear
  // decay from that rate (month paidCount+1) down to 0 (month durationMonths).
  // Else fall back to full nominal — conservative.
  const startPct = args.futureDividendStartPct ?? 0;
  const futureMonths = args.durationMonths - paidCount;
  for (let i = paidCount; i < args.durationMonths; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    // Linear decay: position 0 (next future month) → startPct, position
    // futureMonths-1 (last month) → 0. Use 1-based midpoint to avoid the
    // last month being exactly 0 (already-decayed).
    const positionFromNext = i - paidCount;
    const decayedPct =
      futureMonths > 1 && startPct > 0
        ? startPct * (1 - positionFromNext / futureMonths)
        : 0;
    const netOutgo = args.monthlyInstallmentPaisa * (1 - decayedPct / 100);
    flows.push({ amount: -(netOutgo / 100), when: d });
  }

  // Terminal inflow.
  const reinvest = args.reinvestRatePct;
  if (args.status === 'WON' && args.winDate && args.winAmountReceivedPaisa) {
    const winDate = new Date(args.winDate);
    const chitEnd = new Date(start);
    chitEnd.setMonth(chitEnd.getMonth() + args.durationMonths - 1);
    if (reinvest && reinvest > 0 && chitEnd > winDate) {
      // Grow cheque from win date → chit end at the reinvest rate (monthly compound).
      const msPerMonth = 30.4375 * 24 * 3600 * 1000;
      const months = Math.max(0, (chitEnd.getTime() - winDate.getTime()) / msPerMonth);
      const grownPaisa =
        args.winAmountReceivedPaisa * Math.pow(1 + reinvest / 100 / 12, months);
      flows.push({ amount: grownPaisa / 100, when: chitEnd });
    } else {
      flows.push({
        amount: args.winAmountReceivedPaisa / 100,
        when: winDate,
      });
    }
  } else {
    // Active / NPS — worst-case win on the very last installment date,
    // receiving full chit value.
    const end = new Date(start);
    end.setMonth(end.getMonth() + args.durationMonths - 1);
    flows.push({ amount: args.chitValuePaisa / 100, when: end });
  }

  return flows;
}

/**
 * Convenience wrapper: build summary flows + run XIRR. Returns a percentage
 * (e.g. 7.42 for 7.42%) or null if the solver cannot converge.
 */
export function calculateChitXirrFromSummary(
  args: Parameters<typeof buildChitCashFlowsFromSummary>[0]
): number | null {
  const flows = buildChitCashFlowsFromSummary(args);
  if (flows.length < 2) return null;
  return calculateXirr(flows);
}
