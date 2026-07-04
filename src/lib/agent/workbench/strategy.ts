/**
 * The Strategy Model — the keystone abstraction of the trading workbench.
 *
 * A Strategy is a PURE, self-describing, parameterized unit of trading logic:
 * bars in, signals out. It knows nothing about brokers, the DB, or money — so
 * the SAME object is consumed by every stage of the lifecycle:
 *   backtest → validation → paper-trade → optimize → promote → signal feed.
 *
 * Adding a new idea = write `entry` + `exit` + `meta`. Nothing else changes.
 * Long-only for now (no overnight equity shorts). Prices in the bars are native
 * rupees; entry/exit return stops/targets in paisa.
 */

import type { DailyBar } from '@/lib/services/yahoo-finance';

export type StrategyHorizon = 'INTRADAY' | 'SWING' | 'POSITION';
export type StrategyUniverse = string;  // a key in the universe registry (universes.ts) — NIFTY_500, sectors, etc.

/** A tunable knob — its range drives the sensitivity sweep, L3 tuning, and the UI. */
export interface ParamSpec { key: string; label: string; min: number; max: number; step: number; default: number }
export type Params = Record<string, number>;

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  horizon: StrategyHorizon;     // SWING/POSITION can graduate to manual signals; INTRADAY = paper-only
  universe: StrategyUniverse;
  params: ParamSpec[];
}

export interface EntrySignal { stopPaisa: number; targetPaisa: number | null; note: string }
export interface ExitSignal { reason: string }

/** An open long, as the exit rule sees it. */
export interface OpenLeg { entryPaisa: number; entryIndex: number; barsHeld: number }

export interface Strategy {
  meta: StrategyMeta;
  /** `bars` = history up to AND INCLUDING the decision bar (last element). Long-only entry on this bar's close. */
  entry(bars: DailyBar[], params: Params): EntrySignal | null;
  /** Should the open position close on this bar? (Stop-loss is handled by the runner, not here.) */
  exit(bars: DailyBar[], params: Params, pos: OpenLeg): ExitSignal | null;
}

/** Resolve a full param set from a strategy's specs + an optional override (used by sweeps/tuning). */
export const paramsFrom = (specs: ParamSpec[], override?: Params): Params =>
  Object.fromEntries(specs.map((s) => [s.key, override?.[s.key] ?? s.default]));
