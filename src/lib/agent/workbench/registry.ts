/**
 * Workbench strategy registry — the single list of every strategy the workbench
 * knows about. Adding a new model = author its file, then add ONE line here.
 * From that moment it is discoverable by the backtest engine, the validation
 * suite, the paper-trade buckets, and the signal feed — all of which look
 * strategies up by id and consume the same Strategy interface. No other wiring.
 */

import type { Strategy } from './strategy';
import { turnaround } from './strategies/turnaround';

export const STRATEGIES: Strategy[] = [
  turnaround,
  // ← new strategies get one line here (e.g. `gapDownReversal,`)
];

export const strategyById = (id: string): Strategy | undefined => STRATEGIES.find((s) => s.meta.id === id);
export const listStrategies = () => STRATEGIES.map((s) => s.meta);
