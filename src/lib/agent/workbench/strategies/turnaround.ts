/**
 * Turnaround (N-down-days) — the "Turnaround Tuesday" pattern, generalized.
 * Buy the close after N consecutive down days; exit on the first close above the
 * prior day's high (the bounce confirmed), a max-hold cap, or an ATR stop (the
 * runner enforces the stop). "Tuesday" is just the N=3 + Monday-gated instance;
 * here N is a swept parameter, so the sensitivity test — not us — picks it.
 * Reference: Timothy Masters, "Testing and Tuning Market Trading Systems".
 */

import type { Strategy } from '../strategy';
import { atr } from '../../signals/indicators';

const P = (rupees: number) => Math.round(rupees * 100);

export const turnaround: Strategy = {
  meta: {
    id: 'turnaround',
    name: 'Turnaround (N down days)',
    description: 'Buy the close after N consecutive down days; exit on the first close above the prior day’s high, a max-hold cap, or an ATR stop. Short-term mean-reversion bounce.',
    horizon: 'SWING',
    universe: 'NIFTY_500',
    params: [
      { key: 'downDays', label: 'Consecutive down days', min: 2, max: 6, step: 1, default: 3 },
      { key: 'stopAtr', label: 'Stop (× ATR)', min: 1, max: 4, step: 0.5, default: 3 },
      { key: 'maxHold', label: 'Max hold (days)', min: 2, max: 10, step: 1, default: 5 },
    ],
  },

  entry(bars, p) {
    const n = Math.round(p.downDays);
    if (bars.length < n + 16) return null;                        // need history for the pattern + ATR(14)
    for (let k = 0; k < n; k++) {                                 // last n bars each a down day
      const i = bars.length - 1 - k;
      if (!(bars[i].close < bars[i - 1].close)) return null;
    }
    const px = bars[bars.length - 1].close;
    const a = atr(bars.map((b) => ({ high: b.high, low: b.low, close: b.close })), 14);
    if (a == null || a <= 0) return null;
    const stop = px - p.stopAtr * a;
    if (stop >= px) return null;
    return { stopPaisa: P(stop), targetPaisa: null, note: `${n} down days, ATR ${a.toFixed(2)}` };
  },

  exit(bars, p, pos) {
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    if (prev && last.close > prev.high) return { reason: 'close > prior high' };   // bounce confirmed
    if (pos.barsHeld >= Math.round(p.maxHold)) return { reason: `max hold ${Math.round(p.maxHold)}d` };
    return null;
  },
};
