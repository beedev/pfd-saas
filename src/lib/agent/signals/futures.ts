/**
 * Futures signals — trend + momentum on the underlying daily closes (paisa).
 * Direction of the score implies the suggested side (LONG > 0, SHORT < 0).
 */

import { sma, momentumPct, clamp } from './indicators';
import type { SignalResult } from './types';

const D_1M = 21;

export function computeFuturesSignals(
  closesPaisa: number[],
  lastPricePaisa: number,
): SignalResult {
  const mom1 = momentumPct(closesPaisa, D_1M);
  const sma20 = sma(closesPaisa, 20);
  const sma50 = sma(closesPaisa, 50);

  let trendPct: number | undefined;
  if (sma50 != null && sma50 > 0) trendPct = ((lastPricePaisa - sma50) / sma50) * 100;

  let score = 0;
  if (mom1 != null) score += clamp(mom1, -25, 25) * 1.5;
  if (trendPct != null) score += clamp(trendPct, -25, 25) * 1.2;
  if (sma20 != null && sma50 != null) score += sma20 > sma50 ? 10 : -10;

  return {
    score: clamp(Math.round(score), -100, 100),
    signals: {
      momentum1mPct: mom1 ?? undefined,
      sma50Paisa: sma50 != null ? Math.round(sma50) : undefined,
      trendPct,
    },
  };
}
