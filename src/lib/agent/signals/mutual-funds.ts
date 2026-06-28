/**
 * Mutual-fund signals from a NAV history series. Trailing 1/3/6/12-month
 * returns (annualised-agnostic, point-to-point) + volatility → composite score.
 */

import { annualisedVolatilityPct, clamp } from './indicators';
import type { SignalResult } from './types';

export interface NavPoint {
  dateIso: string; // YYYY-MM-DD, ascending
  nav: number;     // rupees
}

/** Return % from the NAV nearest-on-or-before `monthsAgo` to the latest NAV. */
function trailingReturnPct(history: NavPoint[], monthsAgo: number): number | undefined {
  if (history.length < 2) return undefined;
  const latest = history[history.length - 1];
  const target = new Date(latest.dateIso + 'T00:00:00Z');
  target.setUTCMonth(target.getUTCMonth() - monthsAgo);
  const targetIso = target.toISOString().slice(0, 10);
  // Walk back to the last point on/before the target date.
  let base: NavPoint | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].dateIso <= targetIso) {
      base = history[i];
      break;
    }
  }
  if (!base || base.nav <= 0) return undefined;
  return ((latest.nav - base.nav) / base.nav) * 100;
}

export function computeMfSignals(history: NavPoint[]): SignalResult {
  const m1 = trailingReturnPct(history, 1);
  const m3 = trailingReturnPct(history, 3);
  const m6 = trailingReturnPct(history, 6);
  const m12 = trailingReturnPct(history, 12);
  const vol = annualisedVolatilityPct(history.map((h) => h.nav));

  // Composite: weight medium/longer-term momentum more than 1-month noise.
  let score = 0;
  if (m3 != null) score += clamp(m3, -25, 25) * 1.4;
  if (m6 != null) score += clamp(m6, -35, 35) * 0.9;
  if (m12 != null) score += clamp(m12, -50, 50) * 0.5;
  if (m1 != null) score += clamp(m1, -15, 15) * 0.4;

  return {
    score: clamp(Math.round(score), -100, 100),
    signals: {
      trailing: { m1, m3, m6, m12 },
      volatilityPct: vol ?? undefined,
    },
  };
}
