/**
 * Strategy DSL — the JSON grammar an NL description compiles into. A DSL spec is
 * pure data (no code), so it's safe to generate with an LLM and safe to execute:
 * a trusted interpreter (dsl-interpreter.ts) evaluates it against bars. Growing
 * the grammar (a new indicator/pattern) is the ONE place code gets touched.
 *
 * Two expression kinds:
 *   NumExpr   → evaluates to a number (a price, an indicator, arithmetic).
 *   Condition → evaluates to a boolean (comparisons, patterns, and/or/not).
 * Offsets: 0 = the decision bar (today), 1 = yesterday, ...
 */

import type { ParamSpec, StrategyHorizon, StrategyUniverse } from './strategy';

export type NumExpr =
  | number
  | { param: string }                                   // a strategy parameter
  | { close: number } | { open: number } | { high: number } | { low: number }   // series value at offset
  | { sma: number } | { rsi: number } | { atr: number } // indicator (period), at today
  | { priorHigh: number } | { priorLow: number }        // extreme over the prior N bars (excl today)
  | { sub: [NumExpr, NumExpr] } | { add: [NumExpr, NumExpr] } | { mul: [NumExpr, NumExpr] } | { div: [NumExpr, NumExpr] };

export type Condition =
  | boolean
  | { gt: [NumExpr, NumExpr] } | { lt: [NumExpr, NumExpr] } | { gte: [NumExpr, NumExpr] } | { lte: [NumExpr, NumExpr] }
  | { and: Condition[] } | { or: Condition[] } | { not: Condition }
  | { consecutiveDownDays: NumExpr } | { consecutiveUpDays: NumExpr }  // last N bars each lower/higher close
  | { gapDownPct: NumExpr } | { gapUpPct: NumExpr }                    // today's open gapped vs prior close
  | { crossAbove: [NumExpr, NumExpr] } | { crossBelow: [NumExpr, NumExpr] };

export type StopRule = { type: 'atr'; n: number; mult: NumExpr } | { type: 'pct'; pct: NumExpr };

export interface DslSpec {
  meta: { id: string; name: string; description: string; horizon: StrategyHorizon; universe: StrategyUniverse };
  params: ParamSpec[];
  entry: Condition;               // long entry on this bar's close when true
  exit: Condition;                // close the position when true
  stop?: StopRule;                // protective stop (enforced by the backtest runner)
  maxHoldDays?: NumExpr;          // optional time exit
}
