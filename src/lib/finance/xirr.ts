/**
 * XIRR wrapper.
 *
 * Uses the `xirr` npm package (Newton-Raphson solver) and returns the annualised
 * rate as a percentage. Negative values indicate a loss; positive values an annual
 * gain. Returns null if the solver cannot converge (e.g. all flows same sign).
 */

import xirr from 'xirr';

export interface CashFlow {
  /** Amount in rupees. Negative = outflow (investment), positive = inflow (redemption / current value). */
  amount: number;
  /** Date of the cash flow. */
  when: Date;
}

export function calculateXirr(flows: CashFlow[]): number | null {
  if (!flows || flows.length < 2) return null;

  // xirr requires at least one negative and one positive flow.
  const hasNegative = flows.some((f) => f.amount < 0);
  const hasPositive = flows.some((f) => f.amount > 0);
  if (!hasNegative || !hasPositive) return null;

  try {
    const rate = xirr(
      flows.map((f) => ({ amount: f.amount, when: f.when }))
    );
    if (!Number.isFinite(rate)) return null;
    const pct = rate * 100;
    // Newton-Raphson can converge to spurious far-from-zero roots when flows
    // net out (e.g. mid-flight chit win followed by 13 more outflows). Cap at
    // a sane band — anything outside is treated as non-convergent.
    if (pct < -99 || pct > 1000) return null;
    return pct;
  } catch {
    return null;
  }
}
