/**
 * Technical-indicator primitives. Pure functions over chronological
 * (oldest→newest) numeric series. Inputs may be paisa (prices) or NAV rupees;
 * the math is unit-agnostic. Percentages are returned as plain numbers (7.5 = 7.5%).
 */

/** Simple moving average of the last `n` values, or null if not enough data. */
export function sma(series: number[], n: number): number | null {
  if (series.length < n || n <= 0) return null;
  let sum = 0;
  for (let i = series.length - n; i < series.length; i++) sum += series[i];
  return sum / n;
}

/** Exponential moving average (last value of the EMA series), or null. */
export function ema(series: number[], n: number): number | null {
  if (series.length < n || n <= 0) return null;
  const k = 2 / (n + 1);
  // Seed with the SMA of the first n points, then walk forward.
  let prev = 0;
  for (let i = 0; i < n; i++) prev += series[i];
  prev /= n;
  for (let i = n; i < series.length; i++) prev = series[i] * k + prev * (1 - k);
  return prev;
}

/** Percent change from `lookbackDays` ago to the latest value, or null. */
export function momentumPct(series: number[], lookbackDays: number): number | null {
  if (series.length <= lookbackDays || lookbackDays <= 0) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 1 - lookbackDays];
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((last - prev) / prev) * 100;
}

/** Sample standard deviation of daily returns, annualised, as a percent. */
export function annualisedVolatilityPct(series: number[]): number | null {
  if (series.length < 20) return null;
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev === 0) continue;
    rets.push((series[i] - prev) / prev);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Clamp a number to [min, max]. */
export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Wilder's RSI over `period` on a close series. Returns 0-100, or null if not
 * enough data. RSI(2) is the workhorse for short-term mean reversion.
 */
export function rsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1 || period <= 0) return null;
  let gain = 0;
  let loss = 0;
  // Seed with the first `period` changes.
  for (let i = closes.length - period; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Highest close over the last `n` bars (close-based Donchian upper). */
export function donchianHigh(closes: number[], n: number): number | null {
  if (closes.length < n || n <= 0) return null;
  return Math.max(...closes.slice(closes.length - n));
}

/** Lowest close over the last `n` bars (close-based Donchian lower). */
export function donchianLow(closes: number[], n: number): number | null {
  if (closes.length < n || n <= 0) return null;
  return Math.min(...closes.slice(closes.length - n));
}

/**
 * ATR proxy from closes only (we don't have intraday high/low): the average
 * absolute close-to-close change over `n` bars. Used for risk-based sizing
 * and trailing-stop distance. Same units as price (paisa).
 */
export function atrProxy(closes: number[], n: number): number | null {
  if (closes.length < n + 1 || n <= 0) return null;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) sum += Math.abs(closes[i] - closes[i - 1]);
  return sum / n;
}

/**
 * Return (%) between two points measured in trading days back from the latest:
 * from `startAgo` days ago to `endAgo` days ago. For 12-1 momentum use
 * startAgo≈252, endAgo≈21 (skip the most recent month — short-term reversal).
 */
export function returnBetween(closes: number[], startAgo: number, endAgo: number): number | null {
  if (startAgo <= endAgo) return null;
  const n = closes.length;
  if (n <= startAgo) return null;
  const start = closes[n - 1 - startAgo];
  const end = closes[n - 1 - endAgo];
  if (!Number.isFinite(start) || start === 0) return null;
  return ((end - start) / start) * 100;
}
