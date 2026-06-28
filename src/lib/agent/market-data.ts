/**
 * Unified instrument data interface for the analyst agent — one shape over
 * stocks (Yahoo), mutual funds (AMFI/mfapi), and futures (provider abstraction).
 * All prices returned in integer paisa.
 */

import { getQuote, getQuotes } from '@/lib/services/yahoo-finance';
import { getByIsin, getBySchemeCode, getNavHistory } from '@/lib/services/amfi';
import { getFuturesProvider } from './providers/futures-provider';
import { nseSymbolFor, nseEquityQuotePaisa } from './providers/nse';
import type { AgentAssetClass } from '@/db/schema';

export interface InstrumentRef {
  assetClass: AgentAssetClass;
  symbol?: string;     // Yahoo symbol (STOCK/FUTURE)
  schemeCode?: string; // AMFI scheme code (MF)
  isin?: string;
  contractMultiplier?: number;
}

export interface InstrumentQuote {
  lastPricePaisa: number;
  dayHighPaisa?: number;
  dayLowPaisa?: number;
  fiftyTwoWkHighPaisa?: number;
  fiftyTwoWkLowPaisa?: number;
  asOf: number; // unix seconds
  source?: string; // NSE | YAHOO | AMFI
}

export interface PricePoint {
  date: string; // YYYY-MM-DD
  closePaisa: number;
}

const toPaisa = (n: number | undefined | null): number | undefined =>
  n != null && Number.isFinite(n) ? Math.round(n * 100) : undefined;

function refKey(ref: InstrumentRef): string {
  return `${ref.assetClass}:${ref.symbol ?? ''}:${ref.schemeCode ?? ref.isin ?? ''}`;
}

/** Latest quote for one instrument, or null if unavailable. */
export async function getInstrumentQuote(ref: InstrumentRef): Promise<InstrumentQuote | null> {
  if (ref.assetClass === 'MF') {
    const fund = ref.schemeCode
      ? await getBySchemeCode(ref.schemeCode)
      : ref.isin
        ? await getByIsin(ref.isin)
        : null;
    if (!fund || !Number.isFinite(fund.nav)) return null;
    const p = Math.round(fund.nav * 100);
    return { lastPricePaisa: p, asOf: Math.floor(Date.parse(fund.navDate + 'T00:00:00Z') / 1000) || 0, source: 'AMFI' };
  }
  if (ref.assetClass === 'FUTURE') {
    if (!ref.symbol) return null;
    const provider = await getFuturesProvider();
    const fq = await provider.quote(ref.symbol);
    return fq ? { lastPricePaisa: fq.lastPricePaisa, asOf: fq.asOf, source: 'YAHOO' } : null;
  }
  // STOCK — NSE primary, Yahoo fallback.
  if (!ref.symbol) return null;
  const nsym = nseSymbolFor(ref.symbol);
  if (nsym) {
    const nse = await nseEquityQuotePaisa(nsym);
    if (nse) return { lastPricePaisa: nse, asOf: Math.floor(Date.now() / 1000), source: 'NSE' };
  }
  const q = await getQuote(ref.symbol);
  if (!q || !Number.isFinite(q.regularMarketPrice)) return null;
  return {
    lastPricePaisa: Math.round(q.regularMarketPrice * 100),
    dayHighPaisa: toPaisa(q.regularMarketDayHigh),
    dayLowPaisa: toPaisa(q.regularMarketDayLow),
    fiftyTwoWkHighPaisa: toPaisa(q.fiftyTwoWeekHigh),
    fiftyTwoWkLowPaisa: toPaisa(q.fiftyTwoWeekLow),
    asOf: q.regularMarketTime,
    source: 'YAHOO',
  };
}

/** Is the NSE cash market currently open? (via the ^NSEI live market state.) */
export async function isMarketOpen(): Promise<boolean> {
  try {
    const q = await getQuote('^NSEI');
    return q?.marketState === 'REGULAR';
  } catch {
    return false;
  }
}

/** Batched quotes; missing instruments are simply omitted from the map. */
export async function getInstrumentQuotes(
  refs: InstrumentRef[],
): Promise<Map<string, InstrumentQuote>> {
  const out = new Map<string, InstrumentQuote>();
  // Batch all STOCK symbols through one getQuotes() call.
  const stockSymbols = refs
    .filter((r) => r.assetClass === 'STOCK' && r.symbol)
    .map((r) => r.symbol as string);
  if (stockSymbols.length) {
    const quotes = await getQuotes(stockSymbols);
    const bySym = new Map(quotes.map((q) => [q.symbol, q]));
    for (const r of refs) {
      if (r.assetClass !== 'STOCK' || !r.symbol) continue;
      const q = bySym.get(r.symbol);
      if (!q || !Number.isFinite(q.regularMarketPrice)) continue;
      out.set(refKey(r), {
        lastPricePaisa: Math.round(q.regularMarketPrice * 100),
        dayHighPaisa: toPaisa(q.regularMarketDayHigh),
        dayLowPaisa: toPaisa(q.regularMarketDayLow),
        fiftyTwoWkHighPaisa: toPaisa(q.fiftyTwoWeekHigh),
        fiftyTwoWkLowPaisa: toPaisa(q.fiftyTwoWeekLow),
        asOf: q.regularMarketTime,
      });
    }
  }
  // MF + FUTURE resolved individually (different sources).
  await Promise.all(
    refs
      .filter((r) => r.assetClass !== 'STOCK')
      .map(async (r) => {
        const q = await getInstrumentQuote(r);
        if (q) out.set(refKey(r), q);
      }),
  );
  return out;
}

/** Daily close history (paisa) for one instrument. Empty array if unavailable. */
export async function getInstrumentHistory(
  ref: InstrumentRef,
  range = '1y',
): Promise<PricePoint[]> {
  if (ref.assetClass === 'MF') {
    if (!ref.schemeCode) return [];
    const hist = await getNavHistory(ref.schemeCode);
    return hist.map((h) => ({ date: h.dateIso, closePaisa: Math.round(h.nav * 100) }));
  }
  if (ref.assetClass === 'FUTURE') {
    if (!ref.symbol) return [];
    const provider = await getFuturesProvider();
    return provider.history(ref.symbol, range);
  }
  if (!ref.symbol) return [];
  const { getDailyCloses } = await import('@/lib/services/yahoo-finance');
  const closes = await getDailyCloses(ref.symbol, range);
  return closes.map((c) => ({ date: c.date, closePaisa: Math.round(c.close * 100) }));
}

export { refKey };
