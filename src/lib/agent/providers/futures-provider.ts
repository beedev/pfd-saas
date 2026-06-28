/**
 * Futures data-provider abstraction.
 *
 * v1 ships YahooFuturesProvider only (commodity/index futures Yahoo can quote,
 * e.g. GC=F, SI=F, CL=F, ^NSEI). The interface is kept deliberately broad
 * (including `depth()` for a future DOM panel) so a broker provider — Zerodha
 * Kite, Angel One SmartAPI, etc. — can be slotted in later without reworking
 * callers. Yahoo has no order-book depth, so DOM is unavailable in v1.
 */

import { getQuote, getDailyCloses } from '@/lib/services/yahoo-finance';

export interface FuturesQuote {
  lastPricePaisa: number;
  asOf: number; // unix seconds
}

export interface FuturesPricePoint {
  date: string;
  closePaisa: number;
}

/** One level of the order book (bid or ask) — for a future DOM panel. */
export interface DepthLevel {
  pricePaisa: number;
  quantity: number;
  orders?: number;
}

export interface MarketDepth {
  bids: DepthLevel[];
  asks: DepthLevel[];
  asOf: number;
}

export interface FuturesProvider {
  readonly id: string;
  quote(symbol: string): Promise<FuturesQuote | null>;
  history(symbol: string, range?: string): Promise<FuturesPricePoint[]>;
  /** Order-book depth (DOM). Null when the provider can't supply it (Yahoo). */
  depth(symbol: string): Promise<MarketDepth | null>;
}

class YahooFuturesProvider implements FuturesProvider {
  readonly id = 'yahoo';
  async quote(symbol: string): Promise<FuturesQuote | null> {
    const q = await getQuote(symbol);
    if (!q || !Number.isFinite(q.regularMarketPrice)) return null;
    return { lastPricePaisa: Math.round(q.regularMarketPrice * 100), asOf: q.regularMarketTime };
  }
  async history(symbol: string, range = '1y'): Promise<FuturesPricePoint[]> {
    const closes = await getDailyCloses(symbol, range);
    return closes.map((c) => ({ date: c.date, closePaisa: Math.round(c.close * 100) }));
  }
  async depth(): Promise<MarketDepth | null> {
    return null; // Yahoo has no order-book depth; DOM needs a broker feed.
  }
}

const yahooProvider = new YahooFuturesProvider();

export async function getFuturesProvider(): Promise<FuturesProvider> {
  return yahooProvider;
}
