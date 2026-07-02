/** Strategy registry — maps a sleeve's strategy key to its implementation. */

import type { AgentStrategy } from '@/db';
import type { Strategy } from './types';
import { meanReversionStrategy } from './mean-reversion';
import { xsMomentumStrategy } from './xs-momentum';
import { trendStrategy } from './trend';
import { rsRotationStrategy } from './rs-rotation';

// Daily strategies (the SleeveContext/Strategy interface). INTRADAY_ORB is NOT
// here — it's a true same-day strategy with its own runner (run-intraday.ts).
const STRATEGIES: Partial<Record<AgentStrategy, Strategy>> = {
  MEAN_REVERSION: meanReversionStrategy,
  XS_MOMENTUM: xsMomentumStrategy,
  TREND: trendStrategy,
  RS_ROTATION: rsRotationStrategy,
};

export function getStrategy(key: AgentStrategy): Strategy {
  const s = STRATEGIES[key];
  if (!s) throw new Error(`No daily strategy for ${key} (intraday strategies use their own runner)`);
  return s;
}

/** Default sleeve definitions for the equal-split seeding. */
export const DEFAULT_SLEEVES: Array<{ key: import('@/db').AgentSleeveKey; name: string; strategy: AgentStrategy; cadence: import('@/db').AgentCadence }> = [
  { key: 'STK_FAST', name: 'My Picks · 2-3 day', strategy: 'MEAN_REVERSION', cadence: 'INTRADAY' },
  { key: 'STK_SHORT', name: 'My Picks · 2-3 month', strategy: 'XS_MOMENTUM', cadence: 'DAILY_OPEN' },
  { key: 'FUT', name: 'Futures', strategy: 'TREND', cadence: 'DAILY_OPEN' },
  // Mutual funds retired as an active bucket (2026-07-02) — MFs are long-term
  // holdings, not day-trading alpha (NAV is EOD-only, 1% <1yr exit load). Existing
  // MF sleeves are disabled on deploy; not re-seeded here.
  { key: 'STK_INTRADAY', name: 'Intraday (ORB)', strategy: 'INTRADAY_ORB', cadence: 'INTRADAY' },
  { key: 'STK_VWAP', name: 'Intraday · VWAP reversion', strategy: 'VWAP_REVERSION', cadence: 'INTRADAY' },
  { key: 'STK_GAP', name: 'Intraday · gap-and-go', strategy: 'GAP_AND_GO', cadence: 'INTRADAY' },
  { key: 'STK_NEWS', name: 'Intraday · news signals', strategy: 'NEWS_SIGNAL', cadence: 'INTRADAY' },
  // "My Picks" intraday bucket — trades the user's INTRADAY-tagged watchlist
  // names on the combined trigger, squared off same day (run-swing INTRADAY).
  { key: 'STK_WATCH', name: 'My Picks · intraday', strategy: 'WATCHLIST', cadence: 'INTRADAY' },
];
