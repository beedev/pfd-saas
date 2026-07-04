/**
 * Validation suite — Timothy Masters' four tests, the gate every strategy passes
 * before it can be trusted. A profitable-looking backtest proves nothing; these
 * ask whether the edge is REAL:
 *   1. Sensitivity  — sweep a param; a smooth plateau = robust, a lone spike = curve-fit.
 *   2. Permutation  — shuffle the bar order K× and rerun; beating the shuffles = not luck.
 *   3. Partition    — split return into market-drift-while-held vs timing skill.
 *   4. Benchmark    — vs buy-hold: return, drawdown, Sharpe (is active trading worth it?).
 * Everything runs on the pooled, net-of-cost trades from backtest.ts.
 */

import type { DailyBar } from '@/lib/services/yahoo-finance';
import type { Strategy, Params } from './strategy';
import { runUniverse, poolMetrics, type Trade } from './backtest';

// ---- 1. Sensitivity ---------------------------------------------------------
export interface SensitivityPoint { value: number; expectancy: number; winRate: number; trades: number }
export function sensitivity(strategy: Strategy, barsBySymbol: Map<string, DailyBar[]>, key: string, values: number[], base: Params): SensitivityPoint[] {
  return values.map((value) => {
    const m = poolMetrics(runUniverse(strategy, barsBySymbol, { ...base, [key]: value }));
    return { value, expectancy: m.expectancy, winRate: m.winRate, trades: m.trades };
  });
}
/** A plateau = the default and its neighbours are all same-signed and within a band → robust, not a spike. */
export function isPlateau(points: SensitivityPoint[], defaultValue: number): boolean {
  const i = points.findIndex((p) => p.value === defaultValue);
  if (i < 0) return false;
  const neigh = [points[i - 1], points[i], points[i + 1]].filter(Boolean);
  if (neigh.length < 2) return false;
  const allPositive = neigh.every((p) => p.expectancy > 0);
  const e = neigh.map((p) => p.expectancy);
  const spread = Math.max(...e) - Math.min(...e);
  return allPositive && spread <= Math.abs(points[i].expectancy) * 1.5;   // no cliff next to the default
}

// ---- 2. Permutation (Monte-Carlo bar-order shuffle) -------------------------
export interface PermutationResult { realExpectancy: number; shuffles: number; beatByReal: number; pValue: number }

/** Shuffle a bar series' candle ORDER (each candle kept intact, relative to prior close) → destroys serial pattern, keeps distribution. */
function shuffleCandles(bars: DailyBar[], rnd: () => number): DailyBar[] {
  if (bars.length < 3) return bars;
  const c: Array<{ fo: number; fh: number; fl: number; fc: number }> = [];
  for (let i = 1; i < bars.length; i++) { const pc = bars[i - 1].close || 1; c.push({ fo: bars[i].open / pc, fh: bars[i].high / pc, fl: bars[i].low / pc, fc: bars[i].close / pc }); }
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  const out: DailyBar[] = [{ ...bars[0] }];
  let pc = bars[0].close;
  for (let i = 0; i < c.length; i++) { const close = pc * c[i].fc; out.push({ date: bars[i + 1].date, open: pc * c[i].fo, high: pc * c[i].fh, low: pc * c[i].fl, close }); pc = close; }
  return out;
}

export function permutation(strategy: Strategy, barsBySymbol: Map<string, DailyBar[]>, params: Params, K: number, rnd: () => number = Math.random): PermutationResult {
  const realExpectancy = poolMetrics(runUniverse(strategy, barsBySymbol, params)).expectancy;
  let beatByReal = 0;
  for (let k = 0; k < K; k++) {
    const shuffled = new Map<string, DailyBar[]>();
    for (const [sym, bars] of barsBySymbol) shuffled.set(sym, shuffleCandles(bars, rnd));
    const e = poolMetrics(runUniverse(strategy, shuffled, params)).expectancy;
    if (realExpectancy > e) beatByReal++;
  }
  return { realExpectancy, shuffles: K, beatByReal, pValue: (K - beatByReal + 1) / (K + 1) };
}

// ---- 3. Partition (market drift vs timing skill) ---------------------------
export interface PartitionResult { expectancy: number; driftWhileHeld: number; skill: number; skillPct: number; timeInMarketPct: number }
export function partition(trades: Trade[], barsBySymbol: Map<string, DailyBar[]>, marketDailyDrift: number): PartitionResult {
  const m = poolMetrics(trades);
  const medHold = m.medianHold || 1;
  const driftWhileHeld = marketDailyDrift * medHold;               // what a random hold of the same length would earn
  const skill = m.expectancy - driftWhileHeld;
  let totalBars = 0, heldBars = 0;
  for (const [, bars] of barsBySymbol) totalBars += Math.max(0, bars.length - 30);
  for (const t of trades) heldBars += t.barsHeld;
  return { expectancy: m.expectancy, driftWhileHeld, skill, skillPct: m.expectancy ? skill / m.expectancy : 0, timeInMarketPct: totalBars ? heldBars / totalBars : 0 };
}

// ---- 4. Benchmark (single-position equity vs buy-hold) ---------------------
export interface BenchmarkResult {
  stratTotalRet: number; stratMaxDD: number; benchTotalRet: number; benchMaxDD: number; benchCagr: number; years: number;
}
const maxDrawdown = (equity: number[]): number => { let peak = equity[0] ?? 1, dd = 0; for (const v of equity) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); } return dd; };

/** Strategy equity = trades compounded in exit-date order (single-position proxy). Bench = NIFTYBEES buy-hold over the same window. */
export function benchmark(trades: Trade[], benchBars: DailyBar[]): BenchmarkResult {
  const ordered = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate));
  const eq: number[] = [1];
  for (const t of ordered) eq.push(eq[eq.length - 1] * (1 + t.netRet));
  const stratTotalRet = eq[eq.length - 1] - 1;

  const closes = benchBars.map((b) => b.close);
  const benchTotalRet = closes.length ? closes[closes.length - 1] / closes[0] - 1 : 0;
  const years = benchBars.length ? benchBars.length / 252 : 1;
  return {
    stratTotalRet, stratMaxDD: maxDrawdown(eq),
    benchTotalRet, benchMaxDD: maxDrawdown(closes),
    benchCagr: years > 0 ? (1 + benchTotalRet) ** (1 / years) - 1 : 0, years,
  };
}

/** Mean daily return of the universe — the market-drift input for partition. */
export function meanDailyDrift(barsBySymbol: Map<string, DailyBar[]>): number {
  let sum = 0, n = 0;
  for (const [, bars] of barsBySymbol) for (let i = 1; i < bars.length; i++) { if (bars[i - 1].close > 0) { sum += bars[i].close / bars[i - 1].close - 1; n++; } }
  return n ? sum / n : 0;
}
