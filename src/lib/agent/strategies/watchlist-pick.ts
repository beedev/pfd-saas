/**
 * "My Picks" entry — the combined market-conditions trigger for the user-curated
 * watchlist. The user picks the STOCKS; this decides the WHEN. Long-only.
 * Buys a name only when ALL hold:
 *   • market regime OK (passed in — Nifty above its 50-day SMA),
 *   • the stock is in an uptrend (close > its 50-day SMA),
 *   • AND a trigger fires — EITHER a breakout (close > prior N-day high) OR a
 *     pullback bounce (near the 20-day SMA and turning back up).
 * Combines "trend + regime", "breakout/momentum", and "pullback/dip". Prices in
 * the bars are native rupees; the entry/stop are returned in paisa.
 */

import type { DailyBar } from '@/lib/services/yahoo-finance';
import type { AgentDecisionEvidence } from '@/db';
import { sma, atr } from '../signals/indicators';
import { isStage2 } from '../workbench/stage';

export interface PickParams { smaSlow: number; smaFast: number; breakoutN: number; stopAtr: number; atrPeriod: number }
export const PICK_DEFAULTS: PickParams = { smaSlow: 50, smaFast: 20, breakoutN: 20, stopAtr: 2.0, atrPeriod: 14 };

export interface PickResult { entryPaisa: number; stopPaisa: number; atrPaisa: number; rule: string; evidence: AgentDecisionEvidence }

const P = (r: number) => Math.round(r * 100);

export function watchlistPick(bars: DailyBar[], regimeOk: boolean, params: PickParams): PickResult | null {
  if (!regimeOk) return null;
  if (bars.length < params.smaSlow + 2) return null;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const px = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const smaSlow = sma(closes, params.smaSlow);
  const smaFast = sma(closes, params.smaFast);
  const a = atr(bars.map((b) => ({ high: b.high, low: b.low, close: b.close })), params.atrPeriod);
  if (smaSlow == null || smaFast == null || a == null || a <= 0) return null;

  if (!(px > smaSlow)) return null;                                   // stock must be in an uptrend (50-DMA)
  if (!isStage2(closes)) return null;                                 // Stage-2 gate: above a RISING 200-DMA — no basing/declining names
  const priorHigh = Math.max(...highs.slice(-params.breakoutN - 1, -1)); // prior N-day high (excl today)
  const breakout = px > priorHigh && px > prev;                       // momentum: new high, still pushing
  const pullback = px <= smaFast * 1.02 && px >= smaFast * 0.97 && px > prev; // near 20-SMA, bouncing
  if (!breakout && !pullback) return null;

  const stop = px - params.stopAtr * a;
  if (stop >= px) return null;
  const rule = breakout
    ? `breakout > ${params.breakoutN}d high in uptrend (regime OK)`
    : `pullback to ${params.smaFast}-SMA bounce in uptrend (regime OK)`;
  return {
    entryPaisa: P(px), stopPaisa: P(stop), atrPaisa: P(a), rule,
    evidence: { rule, inputs: { close: +px.toFixed(2), sma50: +smaSlow.toFixed(2), sma20: +smaFast.toFixed(2), atr: +a.toFixed(2) }, thresholds: { stopPaisa: P(stop) }, source: 'YAHOO' },
  };
}

/** Market regime = index (^NSEI) above its 50-day SMA. */
export function regimeOkFromIndex(indexCloses: number[]): boolean {
  const s = sma(indexCloses, 50);
  return s != null && indexCloses[indexCloses.length - 1] > s;
}
