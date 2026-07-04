/**
 * DSL interpreter — the trusted evaluator. `dslToStrategy(spec)` returns a plain
 * Strategy, so an LLM/NL-authored spec runs through the exact same registry,
 * backtest, and validation pipeline as a hand-coded strategy. No eval, no code
 * execution — just walking a data tree. Adding a primitive = one case here.
 */

import type { DailyBar } from '@/lib/services/yahoo-finance';
import { sma, rsi, atr } from '../signals/indicators';
import type { Strategy, Params } from './strategy';
import type { NumExpr, Condition, StopRule, DslSpec } from './dsl';

interface Ctx { bars: DailyBar[]; params: Params }
const at = (bars: DailyBar[], field: 'open' | 'high' | 'low' | 'close', off: number): number => bars[bars.length - 1 - off]?.[field] ?? NaN;
const closesOf = (bars: DailyBar[]) => bars.map((b) => b.close);

function evalNum(e: NumExpr, ctx: Ctx): number {
  if (typeof e === 'number') return e;
  if ('param' in e) return ctx.params[e.param] ?? NaN;
  if ('close' in e) return at(ctx.bars, 'close', e.close);
  if ('open' in e) return at(ctx.bars, 'open', e.open);
  if ('high' in e) return at(ctx.bars, 'high', e.high);
  if ('low' in e) return at(ctx.bars, 'low', e.low);
  if ('sma' in e) return sma(closesOf(ctx.bars), Math.round(evalNum(e.sma, ctx))) ?? NaN;
  if ('rsi' in e) return rsi(closesOf(ctx.bars), Math.round(evalNum(e.rsi, ctx))) ?? NaN;
  if ('atr' in e) return atr(ctx.bars.map((b) => ({ high: b.high, low: b.low, close: b.close })), Math.round(evalNum(e.atr, ctx))) ?? NaN;
  if ('priorHigh' in e) { const n = Math.round(evalNum(e.priorHigh, ctx)); const s = n >= 1 ? ctx.bars.slice(-n - 1, -1) : []; return s.length ? Math.max(...s.map((b) => b.high)) : NaN; }
  if ('priorLow' in e) { const n = Math.round(evalNum(e.priorLow, ctx)); const s = n >= 1 ? ctx.bars.slice(-n - 1, -1) : []; return s.length ? Math.min(...s.map((b) => b.low)) : NaN; }
  if ('sub' in e) return evalNum(e.sub[0], ctx) - evalNum(e.sub[1], ctx);
  if ('add' in e) return evalNum(e.add[0], ctx) + evalNum(e.add[1], ctx);
  if ('mul' in e) return evalNum(e.mul[0], ctx) * evalNum(e.mul[1], ctx);
  if ('div' in e) return evalNum(e.div[0], ctx) / evalNum(e.div[1], ctx);
  return NaN;
}

/** Evaluate a NumExpr as of the PRIOR bar (for crossAbove/crossBelow). */
const prior = (ctx: Ctx): Ctx => ({ bars: ctx.bars.slice(0, -1), params: ctx.params });

function evalCond(c: Condition, ctx: Ctx): boolean {
  if (typeof c === 'boolean') return c;
  if ('gt' in c) return evalNum(c.gt[0], ctx) > evalNum(c.gt[1], ctx);
  if ('lt' in c) return evalNum(c.lt[0], ctx) < evalNum(c.lt[1], ctx);
  if ('gte' in c) return evalNum(c.gte[0], ctx) >= evalNum(c.gte[1], ctx);
  if ('lte' in c) return evalNum(c.lte[0], ctx) <= evalNum(c.lte[1], ctx);
  if ('and' in c) return c.and.every((x) => evalCond(x, ctx));
  if ('or' in c) return c.or.some((x) => evalCond(x, ctx));
  if ('not' in c) return !evalCond(c.not, ctx);
  if ('consecutiveDownDays' in c) { const n = Math.round(evalNum(c.consecutiveDownDays, ctx)); if (!(n >= 1) || ctx.bars.length < n + 1) return false; for (let k = 0; k < n; k++) if (!(at(ctx.bars, 'close', k) < at(ctx.bars, 'close', k + 1))) return false; return true; }
  if ('consecutiveUpDays' in c) { const n = Math.round(evalNum(c.consecutiveUpDays, ctx)); if (!(n >= 1) || ctx.bars.length < n + 1) return false; for (let k = 0; k < n; k++) if (!(at(ctx.bars, 'close', k) > at(ctx.bars, 'close', k + 1))) return false; return true; }
  if ('gapDownPct' in c) { const p = evalNum(c.gapDownPct, ctx); return at(ctx.bars, 'open', 0) <= at(ctx.bars, 'close', 1) * (1 - p / 100); }
  if ('gapUpPct' in c) { const p = evalNum(c.gapUpPct, ctx); return at(ctx.bars, 'open', 0) >= at(ctx.bars, 'close', 1) * (1 + p / 100); }
  if ('crossAbove' in c) { const p = prior(ctx); return evalNum(c.crossAbove[0], p) <= evalNum(c.crossAbove[1], p) && evalNum(c.crossAbove[0], ctx) > evalNum(c.crossAbove[1], ctx); }
  if ('crossBelow' in c) { const p = prior(ctx); return evalNum(c.crossBelow[0], p) >= evalNum(c.crossBelow[1], p) && evalNum(c.crossBelow[0], ctx) < evalNum(c.crossBelow[1], ctx); }
  return false;
}

const P = (r: number) => Math.round(r * 100);

function evalStop(stop: StopRule | undefined, ctx: Ctx): number | null {
  if (!stop) return null;
  const px = at(ctx.bars, 'close', 0);
  if (stop.type === 'pct') { const s = px * (1 - evalNum(stop.pct, ctx) / 100); return s < px ? P(s) : null; }
  const a = atr(ctx.bars.map((b) => ({ high: b.high, low: b.low, close: b.close })), Math.round(stop.n));
  if (a == null || a <= 0) return null;                          // no ATR → no valid stop → no entry (matches coded)
  const s = px - evalNum(stop.mult, ctx) * a;
  return s < px ? P(s) : null;
}

export function dslToStrategy(spec: DslSpec): Strategy {
  return {
    meta: { ...spec.meta, params: spec.params },
    entry(bars, params) {
      const ctx: Ctx = { bars, params };
      if (!evalCond(spec.entry, ctx)) return null;
      const stopPaisa = spec.stop ? evalStop(spec.stop, ctx) : P(at(bars, 'close', 0) * 0.9);
      if (stopPaisa == null) return null;
      return { stopPaisa, targetPaisa: null, note: spec.meta.id };
    },
    exit(bars, params, pos) {
      const ctx: Ctx = { bars, params };
      if (evalCond(spec.exit, ctx)) return { reason: 'exit rule' };
      if (spec.maxHoldDays != null && pos.barsHeld >= Math.round(evalNum(spec.maxHoldDays, ctx))) return { reason: 'max hold' };
      return null;
    },
  };
}
