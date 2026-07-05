/**
 * Weinstein-style stage classification — the "current-trend gate" that keeps
 * momentum buys honest. A stock's long-run CHARACTER can trend, but if it's
 * basing (Stage 1) or declining (Stage 4) RIGHT NOW, it is not a buy today.
 *
 *   Stage 1 — basing     (flat 200-DMA, no established trend)
 *   Stage 2 — advancing  (price > a RISING 200-DMA, and above the 50-DMA)  ← the buy stage
 *   Stage 3 — topping     (price above a rolling-over 200-DMA)
 *   Stage 4 — declining  (price < a falling 200-DMA)
 *
 * Mirrors the Stage read on WealthLab's RS/Stage-2 screen, against which our
 * convergence check validated (2026-07-05): our momentum picks that were Stage-2
 * there — AUROPHARMA, IDFCFIRSTB — pass here; the miss (INDHOTEL, basing) and a
 * declining blue-chip (RELIANCE, Stage 4) are correctly rejected.
 */

import { sma } from '../signals/indicators';

export type Stage = 'STAGE1' | 'STAGE2' | 'STAGE3' | 'STAGE4';

const SLOPE_LOOKBACK = 20;        // 200-DMA slope measured over ~1 trading month
const MIN_BARS = 200 + SLOPE_LOOKBACK; // need the 200-DMA and its value ~20 bars ago

/** Classify the current Weinstein stage from a daily close series. */
export function computeStage(closes: number[]): Stage {
  if (closes.length < MIN_BARS) return 'STAGE1';   // too little history to confirm a trend → fail-safe (no buy)
  const px = closes[closes.length - 1];
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const s200Prev = sma(closes.slice(0, closes.length - SLOPE_LOOKBACK), 200);
  if (s50 == null || s200 == null || s200Prev == null) return 'STAGE1';
  const rising200 = s200 > s200Prev;
  const above200 = px > s200;
  if (above200 && rising200 && px > s50) return 'STAGE2';   // advancing — the only buy stage
  if (!above200 && !rising200) return 'STAGE4';             // declining
  if (above200 && !rising200) return 'STAGE3';              // topping (above a rolling-over 200-DMA)
  return 'STAGE1';                                          // basing (not yet advancing)
}

/** True only when the stock is in Stage 2 (above a rising 200-DMA + above the 50-DMA). */
export function isStage2(closes: number[]): boolean {
  return computeStage(closes) === 'STAGE2';
}
