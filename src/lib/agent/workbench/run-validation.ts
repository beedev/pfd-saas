/**
 * One-call validation for a Strategy — the gate behind the workbench UI. Loads a
 * bounded, cached Nifty universe (guarded daily bars), runs the backtest + the
 * Masters tests, and returns a verdict. The universe is cached in-process so the
 * first validation pays the fetch and the rest are fast. This is the "quick
 * check" size; a wider run can be backgrounded later.
 */

import { NIFTY_500 } from '../universe/nifty500';
import { loadUniverseDaily, loadDaily } from './data';
import type { DailyBar } from '@/lib/services/yahoo-finance';
import type { Strategy } from './strategy';
import { paramsFrom } from './strategy';
import { runUniverse, poolMetrics, type Metrics } from './backtest';
import { sensitivity, isPlateau, permutation, benchmark, type SensitivityPoint, type PermutationResult, type BenchmarkResult } from './validation';

const UNIVERSE_SIZE = 80;
const PERMUTATIONS = 30;
const CACHE_TTL_MS = 30 * 60 * 1000;

let cache: { bars: Map<string, DailyBar[]>; bench: DailyBar[]; at: number } | null = null;
async function universe(now: number): Promise<{ bars: Map<string, DailyBar[]>; bench: DailyBar[] }> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache;
  const bars = await loadUniverseDaily(NIFTY_500.slice(0, UNIVERSE_SIZE), '5y');
  const bench = await loadDaily('NIFTYBEES.NS', '5y').catch(() => [] as DailyBar[]);
  cache = { bars, bench, at: now };
  return cache;
}

export interface Verdict {
  verdict: 'PROMISING' | 'REJECTED';
  metrics: Metrics;
  sensitivity: SensitivityPoint[];
  plateau: boolean;
  permutation: PermutationResult;
  benchmark: BenchmarkResult;
  pass: { profit: boolean; profitFactor: boolean; notLuck: boolean; robust: boolean };
  universeSize: number;
}

export async function validateStrategy(strategy: Strategy, now: number = Date.now()): Promise<Verdict> {
  const { bars, bench } = await universe(now);
  const params = paramsFrom(strategy.meta.params);
  const trades = runUniverse(strategy, bars, params);
  const m = poolMetrics(trades);

  const p0 = strategy.meta.params[0];
  const values = p0 ? sweep(p0.min, p0.max, p0.step) : [];
  const sens = p0 ? sensitivity(strategy, bars, p0.key, values, params) : [];
  const plateau = p0 ? isPlateau(sens, p0.default) : false;
  const perm = permutation(strategy, bars, params, PERMUTATIONS);
  const bm = benchmark(trades, bench);

  const pass = { profit: m.expectancy > 0.003, profitFactor: m.profitFactor >= 1.5, notLuck: perm.pValue < 0.05, robust: plateau };
  const verdict: Verdict['verdict'] = pass.profit && pass.profitFactor && pass.notLuck ? 'PROMISING' : 'REJECTED';
  return { verdict, metrics: m, sensitivity: sens, plateau, permutation: perm, benchmark: bm, pass, universeSize: bars.size };
}

function sweep(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step || 1) out.push(+v.toFixed(4));
  return out.slice(0, 12);
}
