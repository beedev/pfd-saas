/**
 * Workbench data layer — the ONE guarded way to load history for backtests.
 *
 * The trap this closes: Yahoo silently downsamples `interval=1d&range=max` to
 * MONTHLY bars for long-history symbols (e.g. ^NSEI 'max' = 227 bars / 19y).
 * That contamination inverted a whole strategy comparison once already, so
 * every loader here is bounded to a range Yahoo serves as true daily, drops
 * implausible bars, and REFUSES anything that isn't actually daily.
 */

import { getDailyOHLC, type DailyBar } from '@/lib/services/yahoo-finance';

export const DAILY_RANGE = '10y';   // Yahoo serves true daily to ~a decade; never use 'max' for daily.

/** Median calendar-day gap — daily ≈ 1-4 (weekends/holidays), monthly ≈ 30. */
export function medianGapDays(bars: DailyBar[]): number {
  if (bars.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < bars.length; i++) gaps.push((Date.parse(bars[i].date) - Date.parse(bars[i - 1].date)) / 86400000);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}
export const isDaily = (bars: DailyBar[]): boolean => bars.length < 3 || medianGapDays(bars) <= 4;

/** Load DAILY bars for one symbol: bounded range, drop bad bars, throw if the series is coarse. */
export async function loadDaily(symbol: string, range: string = DAILY_RANGE): Promise<DailyBar[]> {
  const raw = await getDailyOHLC(symbol, range);
  const bars = raw.filter((b) => b.close > 0 && b.high >= b.low && b.low > 0);
  if (!isDaily(bars)) throw new Error(`${symbol}: non-daily bars (median gap ${medianGapDays(bars).toFixed(0)}d, range=${range}) — never use 'max' for daily`);
  return bars;
}

/** Load a whole universe daily, in parallel chunks; skip failures + coarse/too-short series. */
export async function loadUniverseDaily(symbols: string[], range: string = DAILY_RANGE, minBars = 260): Promise<Map<string, DailyBar[]>> {
  const out = new Map<string, DailyBar[]>();
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    const res = await Promise.all(chunk.map(async (s) => { try { return [s, await loadDaily(s, range)] as const; } catch { return [s, [] as DailyBar[]] as const; } }));
    for (const [s, b] of res) if (b.length >= minBars) out.set(s, b);
  }
  return out;
}
