/**
 * NSE-direct provider (best-effort). Calls NSE India's public website API the
 * way a browser does: first hit the homepage to obtain session cookies, then
 * call the JSON endpoints with those cookies + browser headers. Cached and
 * throttled; every failure returns null so callers fall back to Yahoo.
 *
 * UNOFFICIAL/fragile: NSE rate-limits and may block datacenter IPs. This is the
 * "primary, with Yahoo fallback" feed for Indian equities + F&O. Quotes only
 * here (history stays on Yahoo, which is far more reliable for long series).
 */

const NSE_BASE = 'https://www.nseindia.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const COMMON_HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };

let cookieCache: { cookie: string; ts: number } | null = null;
const COOKIE_TTL_MS = 10 * 60 * 1000;
const quoteCache = new Map<string, { paisa: number; ts: number }>();
const QUOTE_TTL_MS = 60 * 1000; // throttle: at most one live fetch per symbol per minute

async function getCookies(): Promise<string | null> {
  if (cookieCache && Date.now() - cookieCache.ts < COOKIE_TTL_MS) return cookieCache.cookie;
  try {
    const res = await fetch(`${NSE_BASE}/`, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      cache: 'no-store',
    });
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
    const cookie = sc.map((c) => c.split(';')[0]).join('; ');
    if (cookie) { cookieCache = { cookie, ts: Date.now() }; return cookie; }
  } catch (err) {
    console.warn('NSE cookie bootstrap failed:', err instanceof Error ? err.message : err);
  }
  return null;
}

/** Map a Yahoo symbol to an NSE trading symbol, or null if not an NSE equity. */
export function nseSymbolFor(symbol: string): string | null {
  if (symbol.endsWith('.NS')) return symbol.slice(0, -3);
  if (symbol.endsWith('.BO')) return symbol.slice(0, -3);
  return null; // indices (^NSEI), commodity futures (GC=F), FX → not NSE equity
}

/** Latest NSE equity price in paisa, or null (→ caller falls back to Yahoo). */
export async function nseEquityQuotePaisa(nseSymbol: string): Promise<number | null> {
  const cached = quoteCache.get(nseSymbol);
  if (cached && Date.now() - cached.ts < QUOTE_TTL_MS) return cached.paisa;
  const cookie = await getCookies();
  if (!cookie) return null;
  try {
    const url = `${NSE_BASE}/api/quote-equity?symbol=${encodeURIComponent(nseSymbol)}`;
    const res = await fetch(url, {
      headers: { ...COMMON_HEADERS, Referer: `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(nseSymbol)}`, Cookie: cookie },
      cache: 'no-store',
    });
    if (!res.ok) return cached?.paisa ?? null;
    const j = (await res.json()) as { priceInfo?: { lastPrice?: number } };
    const lp = j?.priceInfo?.lastPrice;
    if (!Number.isFinite(lp) || (lp as number) <= 0) return cached?.paisa ?? null;
    const paisa = Math.round((lp as number) * 100);
    quoteCache.set(nseSymbol, { paisa, ts: Date.now() });
    return paisa;
  } catch (err) {
    console.warn(`NSE quote failed for ${nseSymbol}:`, err instanceof Error ? err.message : err);
    return cached?.paisa ?? null;
  }
}

export interface DepthLevel { pricePaisa: number; qty: number }
export interface NseDepth {
  ltpPaisa: number; changePct: number | null;
  bids: DepthLevel[]; asks: DepthLevel[];
  totalBuyQty: number; totalSellQty: number; ts: number;
}
const depthCache = new Map<string, { depth: NseDepth; ts: number }>();
const DEPTH_TTL_MS = 10 * 1000; // throttle DOM polling to once / 10s / symbol

/**
 * NSE Depth-of-Market (order book): best-5 bid/ask + total buy/sell quantity,
 * from the same quote-equity endpoint as the LTP. Best-effort; null on failure
 * (caller hides the panel). Only meaningful while the market is open.
 */
export async function nseEquityDepth(nseSymbol: string): Promise<NseDepth | null> {
  const cached = depthCache.get(nseSymbol);
  if (cached && Date.now() - cached.ts < DEPTH_TTL_MS) return cached.depth;
  const cookie = await getCookies();
  if (!cookie) return cached?.depth ?? null;
  try {
    const url = `${NSE_BASE}/api/quote-equity?symbol=${encodeURIComponent(nseSymbol)}`;
    const res = await fetch(url, {
      headers: { ...COMMON_HEADERS, Referer: `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(nseSymbol)}`, Cookie: cookie },
      cache: 'no-store',
    });
    if (!res.ok) return cached?.depth ?? null;
    const j = (await res.json()) as {
      priceInfo?: { lastPrice?: number; pChange?: number };
      marketDeptOrderBook?: {
        totalBuyQuantity?: number; totalSellQuantity?: number;
        bid?: Array<{ price?: number; quantity?: number }>;
        ask?: Array<{ price?: number; quantity?: number }>;
      };
    };
    const lp = j?.priceInfo?.lastPrice;
    if (!Number.isFinite(lp) || (lp as number) <= 0) return cached?.depth ?? null;
    const ob = j.marketDeptOrderBook ?? {};
    const lvl = (a?: Array<{ price?: number; quantity?: number }>): DepthLevel[] =>
      (a ?? []).filter((x) => Number.isFinite(x.price) && (x.price as number) > 0)
        .map((x) => ({ pricePaisa: Math.round((x.price as number) * 100), qty: Math.round(x.quantity ?? 0) }));
    const depth: NseDepth = {
      ltpPaisa: Math.round((lp as number) * 100),
      changePct: Number.isFinite(j.priceInfo?.pChange) ? (j.priceInfo!.pChange as number) : null,
      bids: lvl(ob.bid), asks: lvl(ob.ask),
      totalBuyQty: Math.round(ob.totalBuyQuantity ?? 0), totalSellQty: Math.round(ob.totalSellQuantity ?? 0),
      ts: Date.now(),
    };
    depthCache.set(nseSymbol, { depth, ts: Date.now() });
    return depth;
  } catch (err) {
    console.warn(`NSE depth failed for ${nseSymbol}:`, err instanceof Error ? err.message : err);
    return cached?.depth ?? null;
  }
}

/** Raw NSE option chain for an index/equity (F&O). Best-effort; null on failure. */
export async function nseOptionChain(symbol: string, kind: 'indices' | 'equities' = 'indices'): Promise<unknown | null> {
  const cookie = await getCookies();
  if (!cookie) return null;
  try {
    const url = `${NSE_BASE}/api/option-chain-${kind}?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { headers: { ...COMMON_HEADERS, Referer: `${NSE_BASE}/option-chain`, Cookie: cookie }, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
