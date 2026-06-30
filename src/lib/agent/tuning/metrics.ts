/**
 * Net-of-cost edge metrics for the intraday ORB sleeve — the codified version of
 * the "edge vs costs" analysis (does this strategy actually make money AFTER the
 * 0.125% intraday round-trip + 30% slab tax?). Pure: feed it closed round-trips,
 * get back the score the tuner ranks champion vs challenger on. Money in paisa.
 *
 * A "closed trade" is one completed round-trip (entry → exit). `realizedPnlPaisa`
 * is already net of cost + tax (computed in orb-step.ts), so `netPaisa` is the
 * honest bottom line. `oneRPaisa` is the trade's initial risk (|entry−stop|×qty)
 * so we can express results in R-multiples, not just rupees.
 */

import type { AgentDecisionEvidence } from '@/db';

export interface ClosedTrade {
  symbol: string;
  side: 'LONG' | 'SHORT';
  exitReason: string;        // 'target hit' | 'stop hit' | '15:15 square-off' | 'market closed — square-off' | 'overnight safety square-off'
  grossPnlPaisa: number;     // before cost + tax
  costPaisa: number;
  taxPaisa: number;
  realizedPnlPaisa: number;  // net (gross − cost − tax)
  oneRPaisa: number;         // initial risk amount = |entry − stop| × qty × multiplier
}

export interface EdgeMetrics {
  n: number;
  netPaisa: number;          // Σ realized — the score the tuner maximizes
  grossPaisa: number;        // Σ gross (pre cost/tax)
  totalCostPaisa: number;
  totalTaxPaisa: number;
  wins: number; losses: number; scratches: number;
  winRatePct: number | null;
  avgRealizedPaisa: number | null;   // expectancy per trade (net)
  avgWinPaisa: number | null;
  avgLossPaisa: number | null;       // negative
  payoffRatio: number | null;        // avgWin / |avgLoss|
  avgRMultiple: number | null;       // mean(realized / oneR) — net edge in R units
  costDragPct: number | null;        // (cost + tax) / |gross| — how much friction eats
  sharpe: number | null;             // mean/std of per-trade realized (unannualized)
  exitMix: Record<string, { n: number; netPaisa: number }>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeEdge(trades: ClosedTrade[]): EdgeMetrics {
  const n = trades.length;
  const realized = trades.map((t) => t.realizedPnlPaisa);
  const netPaisa = sum(realized);
  const grossPaisa = sum(trades.map((t) => t.grossPnlPaisa));
  const totalCostPaisa = sum(trades.map((t) => t.costPaisa));
  const totalTaxPaisa = sum(trades.map((t) => t.taxPaisa));

  const winsArr = realized.filter((r) => r > 0);
  const lossArr = realized.filter((r) => r < 0);
  const wins = winsArr.length, losses = lossArr.length, scratches = n - wins - losses;

  const winRatePct = n ? (wins / n) * 100 : null;
  const avgRealizedPaisa = n ? Math.round(netPaisa / n) : null;
  const avgWinPaisa = wins ? Math.round(sum(winsArr) / wins) : null;
  const avgLossPaisa = losses ? Math.round(sum(lossArr) / losses) : null;
  const payoffRatio = avgWinPaisa != null && avgLossPaisa != null && avgLossPaisa !== 0
    ? +(avgWinPaisa / Math.abs(avgLossPaisa)).toFixed(3) : null;

  const rMults = trades.filter((t) => t.oneRPaisa > 0).map((t) => t.realizedPnlPaisa / t.oneRPaisa);
  const avgRMultiple = rMults.length ? +(sum(rMults) / rMults.length).toFixed(3) : null;

  const grossAbs = sum(trades.map((t) => Math.abs(t.grossPnlPaisa)));
  const costDragPct = grossAbs > 0 ? +(((totalCostPaisa + totalTaxPaisa) / grossAbs) * 100).toFixed(1) : null;

  let sharpe: number | null = null;
  if (n >= 2) {
    const mean = netPaisa / n;
    const variance = sum(realized.map((r) => (r - mean) ** 2)) / (n - 1);
    const sd = Math.sqrt(variance);
    sharpe = sd > 0 ? +(mean / sd).toFixed(3) : null;
  }

  const exitMix: EdgeMetrics['exitMix'] = {};
  for (const t of trades) {
    const e = exitMix[t.exitReason] ?? { n: 0, netPaisa: 0 };
    e.n++; e.netPaisa += t.realizedPnlPaisa;
    exitMix[t.exitReason] = e;
  }

  return {
    n, netPaisa, grossPaisa, totalCostPaisa, totalTaxPaisa,
    wins, losses, scratches, winRatePct, avgRealizedPaisa, avgWinPaisa, avgLossPaisa,
    payoffRatio, avgRMultiple, costDragPct, sharpe, exitMix,
  };
}

/**
 * Adapter: build ClosedTrade[] from persisted exit decisions. An ORB exit
 * decision's evidence carries everything we need (entry, exit, stop, cost, tax,
 * realized, side), so the live champion's edge reads straight from the ledger.
 */
export function closedTradesFromExitEvidence(
  rows: Array<{ symbol: string; evidence: AgentDecisionEvidence }>,
): ClosedTrade[] {
  const out: ClosedTrade[] = [];
  for (const { symbol, evidence } of rows) {
    const rule = evidence.rule ?? '';
    if (!rule.startsWith('ORB exit')) continue;
    const inp = evidence.inputs ?? {};
    const sz = evidence.sizing ?? {};
    const side = (inp.side as 'LONG' | 'SHORT') ?? 'LONG';
    const entry = Number(inp.entryPaisa);
    const exit = Number(inp.exitPaisa);
    const qty = Number(sz.qty);
    const stop = Number(sz.stopPaisa);
    const cost = Number(sz.costPaisa) || 0;
    const tax = Number(sz.taxPaisa) || 0;
    const realized = Number(sz.realizedPnlPaisa) || 0;
    const grossPnl = Math.round((side === 'LONG' ? exit - entry : entry - exit) * qty);
    const oneR = Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(qty)
      ? Math.abs(entry - stop) * qty : 0;
    out.push({
      symbol, side, exitReason: rule.replace('ORB exit: ', ''),
      grossPnlPaisa: grossPnl, costPaisa: cost, taxPaisa: tax, realizedPnlPaisa: realized, oneRPaisa: oneR,
    });
  }
  return out;
}
