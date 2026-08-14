/**
 * Yahoo Finance service.
 *
 * Uses the v8 chart endpoint (still working as of 2026 without crumb tokens)
 * and the v1 search endpoint. Quotes return native currency (INR for .NS/.BO).
 * Convert to paisa at the persistence boundary via Math.round(price * 100).
 *
 * 5-minute in-memory cache reduces rate-limiting; stale entries are returned
 * on transient errors so the UI never goes blank.
 */

interface YahooQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  previousClose: number;
  currency: string;
  exchange: string;
  longName?: string;
  shortName?: string;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketVolume: number;
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | string;
  regularMarketTime: number; // Unix timestamp
}

interface YahooSearchResult {
  symbol: string;
  longname?: string;
  shortname?: string;
  exchDisp?: string;
  typeDisp?: string;
  currency?: string;
  exchange?: string;
}

// In-memory cache: symbol → { price, timestamp }
const priceCache = new Map<string, { price: YahooQuote; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const USER_AGENT = 'Mozilla/5.0 (compatible; PersonalFinanceDashboard/1.0)';
const CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEARCH_ENDPOINT = 'https://query2.finance.yahoo.com/v1/finance/search';

// Hard cap on every outbound Yahoo call. Without this, a stalled connection or
// a dead DNS resolver (as happened when the Docker VM wedged and killed the
// container's nameserver) makes fetch hang for the OS-level timeout — which
// froze the overview page on its spinner because its Promise.all waited on a
// stock quote that never returned. AbortSignal.timeout fails the request fast;
// callers already handle the error by returning stale cache / empty.
const FETCH_TIMEOUT_MS = 8000;

// Yahoo's v8 chart response shape
interface YahooChartMeta {
  symbol: string;
  regularMarketPrice: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketVolume: number;
  currency: string;
  exchangeName: string;
  regularMarketTime: number;
  marketState: string;
  shortName?: string;
  longName?: string;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

interface YahooChartResponse {
  chart: {
    result: Array<{ meta: YahooChartMeta }> | null;
    error: { code: string; description: string } | null;
  };
}

function chartMetaToQuote(meta: YahooChartMeta, requestedSymbol: string): YahooQuote {
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice;
  const change = meta.regularMarketPrice - previousClose;
  const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;

  return {
    symbol: meta.symbol ?? requestedSymbol,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketChange: change,
    regularMarketChangePercent: changePercent,
    previousClose,
    currency: meta.currency ?? 'INR',
    exchange: meta.exchangeName ?? '',
    longName: meta.longName,
    shortName: meta.shortName,
    regularMarketDayHigh: meta.regularMarketDayHigh ?? meta.regularMarketPrice,
    regularMarketDayLow: meta.regularMarketDayLow ?? meta.regularMarketPrice,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    regularMarketVolume: meta.regularMarketVolume ?? 0,
    marketState: meta.marketState ?? 'CLOSED',
    regularMarketTime: meta.regularMarketTime ?? Math.floor(Date.now() / 1000),
  };
}

async function getQuote(symbol: string): Promise<YahooQuote | null> {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const url = `${CHART_ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Yahoo Finance API error for ${symbol}: ${response.status}`);
      return cached?.price ?? null;
    }

    const data = (await response.json()) as YahooChartResponse;
    const result = data.chart?.result?.[0];

    if (!result?.meta || data.chart.error) {
      console.warn(`No quote data for symbol: ${symbol}`);
      return cached?.price ?? null;
    }

    const quote = chartMetaToQuote(result.meta, symbol);
    priceCache.set(symbol, { price: quote, timestamp: Date.now() });
    return quote;
  } catch (err) {
    console.error(`Failed to fetch quote for ${symbol}:`, err);
    if (cached) {
      console.info(`Using stale cached price for ${symbol}`);
      return cached.price;
    }
    return null;
  }
}

async function getQuotes(symbols: string[]): Promise<YahooQuote[]> {
  const unique = Array.from(new Set(symbols.filter(Boolean)));
  const results = await Promise.allSettled(unique.map((sym) => getQuote(sym)));
  return results
    .filter(
      (r): r is PromiseFulfilledResult<YahooQuote> =>
        r.status === 'fulfilled' && r.value !== null
    )
    .map((r) => r.value);
}

async function searchSymbol(query: string): Promise<YahooSearchResult[]> {
  try {
    const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&lang=en&region=IN&quotesCount=10&newsCount=0`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Yahoo search error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { quotes?: YahooSearchResult[] };
    return data.quotes ?? [];
  } catch (err) {
    console.error('Failed to search symbols:', err);
    return [];
  }
}

// ─── FX rate helpers — Sprint 5.10b ───────────────────────────────────
// Yahoo exposes FX rates via the same chart endpoint using the symbol
// pattern `<BASE><QUOTE>=X` (e.g. USDINR=X, EURINR=X). The same 5-min
// in-memory cache keyed on the symbol is reused, so multiple callers
// asking for the same currency in a render cycle share one fetch.
//
// We deliberately reuse getQuote() instead of forking a parallel cache;
// keeping a single source of truth means cache invalidation, stale-on-
// error, and User-Agent header changes stay consistent across stock
// quotes and FX quotes.

/**
 * Fetch INR conversion rates for a set of foreign currencies.
 *
 * Returns a map { USD: 83.45, EUR: 90.12, … }. Currencies that fail to
 * resolve are omitted from the result (callers should treat a missing
 * key as "live rate unavailable" and either skip the row or fall back
 * to a stored last-known rate).
 *
 * INR itself is short-circuited to 1.0 — Yahoo doesn't quote INRINR=X
 * and callers shouldn't have to special-case it.
 */
export async function getFxRatesToInr(
  currencyCodes: string[],
): Promise<Record<string, number>> {
  const unique = Array.from(
    new Set(currencyCodes.map((c) => c.toUpperCase()).filter(Boolean)),
  );
  const result: Record<string, number> = {};
  // Resolve in parallel via the shared getQuote cache. Non-INR symbols
  // become `<CCY>INR=X`; INR is a constant.
  await Promise.all(
    unique.map(async (ccy) => {
      if (ccy === 'INR') {
        result.INR = 1;
        return;
      }
      const sym = `${ccy}INR=X`;
      const q = await getQuote(sym);
      if (q && Number.isFinite(q.regularMarketPrice) && q.regularMarketPrice > 0) {
        result[ccy] = q.regularMarketPrice;
      }
    }),
  );
  return result;
}

// ─── Daily close history — for the analyst agent's signal engine ──────
// SMA/EMA/momentum need a daily close series, which the latest-quote calls
// above don't provide. Reuse the same chart endpoint with a wider range and
// read the timestamp[] + indicators.quote[0].close[] arrays. Separate 30-min
// cache (history changes at most once a day; no need for the 5-min quote TTL).

export interface DailyClose {
  date: string; // ISO YYYY-MM-DD (UTC date of the bar)
  close: number; // native currency (e.g. INR for .NS)
}

interface YahooChartHistory {
  chart: {
    result: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

const historyCache = new Map<string, { closes: DailyClose[]; timestamp: number }>();
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Daily closing prices for a symbol over the given range (default 1 year).
 * Returns chronologically-ordered bars with non-null closes. Empty array on
 * failure (callers skip the instrument). Stale-on-error like getQuote.
 */
async function getDailyCloses(symbol: string, range = '1y'): Promise<DailyClose[]> {
  const key = `${symbol}|${range}`;
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.timestamp < HISTORY_TTL_MS) {
    return cached.closes;
  }

  try {
    const url = `${CHART_ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Yahoo history error for ${symbol}: ${response.status}`);
      return cached?.closes ?? [];
    }
    const data = (await response.json()) as YahooChartHistory;
    const result = data.chart?.result?.[0];
    const ts = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!ts || !closes || data.chart.error) {
      console.warn(`No history data for symbol: ${symbol}`);
      return cached?.closes ?? [];
    }
    const out: DailyClose[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null || !Number.isFinite(c)) continue; // skip gaps/holidays
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    historyCache.set(key, { closes: out, timestamp: Date.now() });
    return out;
  } catch (err) {
    console.error(`Failed to fetch history for ${symbol}:`, err);
    return cached?.closes ?? [];
  }
}

export interface DailyBar { date: string; open: number; high: number; low: number; close: number }

interface YahooChartOHLC {
  chart: {
    result: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

const ohlcCache = new Map<string, { bars: DailyBar[]; timestamp: number }>();

/** Daily OHLC bars for a symbol (for candlestick charts). Empty on failure. */
async function getDailyOHLC(symbol: string, range = '1y'): Promise<DailyBar[]> {
  const key = `${symbol}|${range}`;
  const cached = ohlcCache.get(key);
  if (cached && Date.now() - cached.timestamp < HISTORY_TTL_MS) return cached.bars;
  try {
    const url = `${CHART_ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return cached?.bars ?? [];
    const data = (await response.json()) as YahooChartOHLC;
    const result = data.chart?.result?.[0];
    const ts = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!ts || !q || data.chart.error) return cached?.bars ?? [];
    const bars: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c });
    }
    ohlcCache.set(key, { bars, timestamp: Date.now() });
    return bars;
  } catch (err) {
    console.error(`Failed to fetch OHLC for ${symbol}:`, err);
    return cached?.bars ?? [];
  }
}

export interface IntradayBar { epoch: number; open: number; high: number; low: number; close: number; volume?: number }

/**
 * Intraday OHLC bars for today (default 5-min). For the same-day ORB sleeve.
 * Not cached — bars change through the session and the runner ticks every ~30m.
 * `epoch` is seconds; the caller converts to IST to find the opening range /
 * square-off time. Empty on failure.
 */
async function getIntradayBars(symbol: string, interval = '5m'): Promise<IntradayBar[]> {
  try {
    const url = `${CHART_ENDPOINT}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=1d`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return [];
    const data = (await response.json()) as YahooChartOHLC;
    const result = data.chart?.result?.[0];
    const ts = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!ts || !q || data.chart.error) return [];
    const bars: IntradayBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      const v = q.volume?.[i];
      bars.push({ epoch: ts[i], open: o, high: h, low: l, close: c, volume: v ?? undefined });
    }
    return bars;
  } catch (err) {
    console.error(`Failed to fetch intraday bars for ${symbol}:`, err);
    return [];
  }
}

export { getQuote, getQuotes, searchSymbol, getDailyCloses, getDailyOHLC, getIntradayBars };
export type { YahooQuote, YahooSearchResult };
