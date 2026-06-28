/**
 * Equity / stock signals from a daily close series (paisa, chronological).
 * Composite score in [-100, 100] blends momentum, SMA50/200 trend + crossover,
 * and position within the 52-week range.
 */

import { sma, ema, momentumPct, clamp } from './indicators';
import type { SignalResult } from './types';

// Approximate trading-day windows.
const D_1M = 21;
const D_3M = 63;

export interface EquityQuoteCtx {
  lastPricePaisa: number;
  fiftyTwoWkHighPaisa?: number;
  fiftyTwoWkLowPaisa?: number;
}

export function computeEquitySignals(
  closesPaisa: number[],
  quote: EquityQuoteCtx,
): SignalResult {
  const last = quote.lastPricePaisa;
  const mom1 = momentumPct(closesPaisa, D_1M);
  const mom3 = momentumPct(closesPaisa, D_3M);
  const sma50 = sma(closesPaisa, 50);
  const sma200 = sma(closesPaisa, 200);
  const ema12 = ema(closesPaisa, 12);
  const ema26 = ema(closesPaisa, 26);

  let crossover: 'GOLDEN' | 'DEATH' | 'NONE' = 'NONE';
  if (sma50 != null && sma200 != null) {
    crossover = sma50 > sma200 ? 'GOLDEN' : sma50 < sma200 ? 'DEATH' : 'NONE';
  }

  // Position within the 52-week range: 0% = at low, 100% = at high.
  let fiftyTwoWkPositionPct: number | undefined;
  const hi = quote.fiftyTwoWkHighPaisa;
  const lo = quote.fiftyTwoWkLowPaisa;
  if (hi != null && lo != null && hi > lo) {
    fiftyTwoWkPositionPct = clamp(((last - lo) / (hi - lo)) * 100, 0, 100);
  }

  // ── Composite score ──────────────────────────────────────────────
  // Momentum (cap each leg), trend vs SMA200, crossover bonus, range position.
  let score = 0;
  if (mom3 != null) score += clamp(mom3, -30, 30) * 1.2;
  if (mom1 != null) score += clamp(mom1, -20, 20) * 0.6;
  if (sma200 != null && sma200 > 0) {
    score += clamp(((last - sma200) / sma200) * 100, -25, 25) * 0.8;
  }
  if (crossover === 'GOLDEN') score += 12;
  else if (crossover === 'DEATH') score -= 12;
  if (fiftyTwoWkPositionPct != null) score += (fiftyTwoWkPositionPct - 50) * 0.2;

  return {
    score: clamp(Math.round(score), -100, 100),
    signals: {
      momentum1mPct: mom1 ?? undefined,
      momentum3mPct: mom3 ?? undefined,
      sma50Paisa: sma50 != null ? Math.round(sma50) : undefined,
      sma200Paisa: sma200 != null ? Math.round(sma200) : undefined,
      ema12Paisa: ema12 != null ? Math.round(ema12) : undefined,
      ema26Paisa: ema26 != null ? Math.round(ema26) : undefined,
      crossover,
      fiftyTwoWkPositionPct,
    },
  };
}
