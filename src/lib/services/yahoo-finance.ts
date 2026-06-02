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

export { getQuote, getQuotes, searchSymbol };
export type { YahooQuote, YahooSearchResult };
