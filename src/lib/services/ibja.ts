/**
 * IBJA (India Bullion and Jewellers Association) gold rate service.
 *
 * IBJA publishes daily gold/silver rates, but the site has no stable public API
 * and scraping is fragile. This service uses a pragmatic fallback chain:
 *
 *   1. Yahoo Finance gold futures (GC=F in USD/oz) × USDINR FX rate
 *      → convert to INR per gram. This is directionally correct and robust
 *      since Yahoo's v8 chart endpoint is the same one we already use for
 *      equities.
 *   2. Hardcoded MANUAL_FALLBACK constant (~₹7400/g for 24K, April 2026)
 *      so the service ALWAYS returns something — the UI never goes blank.
 *
 * Purity conversion:
 *   999 (24K) = rate24K
 *   995       = rate24K × 0.995
 *   916 (22K) = rate24K × 0.916
 *
 * Cache TTL: 1 hour. Stale cache is returned on transient errors.
 */

export interface GoldRate {
  ratePerGram24K: number;  // INR per gram for 999 purity
  ratePerGram22K: number;  // INR per gram for 916 purity
  asOfDate: string;        // ISO YYYY-MM-DD
  source:
    | 'BANKBAZAAR_CHENNAI'
    | 'IBJA'
    | 'GOODRETURNS'
    | 'YAHOO_FUTURES'
    | 'MANUAL_FALLBACK';
  // Breakdown — present when source is YAHOO_FUTURES, useful for transparency
  // and debugging "why is the rate off" complaints.
  breakdown?: {
    usdPerOz: number;
    usdInr: number;
    spotInrPerGram: number;   // before premium
    premiumMultiplier: number; // INDIA_RETAIL_PREMIUM
  };
}

// 1 troy ounce = 31.1034768 grams
const GRAMS_PER_TROY_OUNCE = 31.1034768;

// Premium applied to international spot to approximate Indian jewellery-store
// display rate (≈ 3% GST + 5-10% dealer/making margin). Tune here if your
// reference source differs:
//   1.03 → spot + GST only (digital gold / Paytm / MMTC PAMP price)
//   1.07 → spot + light dealer margin (investment bullion)
//   1.12 → jewellery retail (Tanishq / local jeweller display rate)  ← current
//   1.15 → jewellery with higher making charges
const INDIA_RETAIL_PREMIUM = 1.12;

// Last-known-good fallback (May 2026): ~₹15,500/g for 24K Indian retail.
// Derived from ~$4,540/oz × ₹95.95/USD ÷ 31.10 g/oz × 1.12.
const MANUAL_FALLBACK_24K = 15500;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const USER_AGENT = 'Mozilla/5.0 (compatible; PersonalFinanceDashboard/1.0)';
const CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';

let cache: { rate: GoldRate; timestamp: number } | null = null;

interface YahooChartMeta {
  regularMarketPrice: number;
  regularMarketTime?: number;
}
interface YahooChartResponse {
  chart: {
    result: Array<{ meta: YahooChartMeta }> | null;
    error: unknown;
  };
}

async function fetchYahooMeta(symbol: string): Promise<YahooChartMeta | null> {
  try {
    const url = `${CHART_ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooChartResponse;
    return data.chart?.result?.[0]?.meta ?? null;
  } catch (err) {
    console.error(`ibja: yahoo fetch failed for ${symbol}:`, err);
    return null;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildRate(
  rate24K: number,
  source: GoldRate['source'],
  breakdown?: GoldRate['breakdown'],
): GoldRate {
  return {
    ratePerGram24K: Math.round(rate24K * 100) / 100,
    ratePerGram22K: Math.round(rate24K * 0.916 * 100) / 100,
    asOfDate: todayIso(),
    source,
    breakdown,
  };
}

/**
 * Scrape Chennai retail gold rate from bankbazaar.com. They publish a
 * "Today's Gold Rate in Chennai" page with structured text containing both
 * 24K (999) and 22K (916) per-gram rates. Format is stable: look for
 *   "24 Carat Gold Rate in Chennai (Today & Yesterday)" / "1 gram ₹ X,XXX"
 *   "22 Carat Gold Rate in Chennai (Today & Yesterday)" / "1 gram ₹ X,XXX"
 *
 * This is preferable to Yahoo futures × USDINR × hardcoded premium because
 * it reports the actual local retail rate the user sees in jewellery stores.
 */
async function fetchFromBankBazaarChennai(): Promise<GoldRate | null> {
  try {
    const res = await fetch('https://www.bankbazaar.com/gold-rate-chennai.html', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`ibja: bankbazaar HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    // Strip scripts/styles/tags for a cleaner search corpus.
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ');

    // Find the 24K section and its first "1 gram ₹ N,NNN".
    const extract = (label: '24' | '22'): number | null => {
      const sectionRe = new RegExp(
        `${label} Carat Gold Rate in Chennai[\\s\\S]{0,800}?1 gram[^₹]*?₹\\s*([0-9][0-9,]+)`,
        'i',
      );
      const m = text.match(sectionRe);
      if (!m) return null;
      const n = Number(m[1].replace(/,/g, ''));
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const r24 = extract('24');
    const r22 = extract('22');
    if (!r24 || !r22) {
      console.error(`ibja: bankbazaar regex failed (24K=${r24}, 22K=${r22}, html-len=${html.length})`);
      return null;
    }
    // Sanity: 22K is 91.6% of 24K by material purity, but Indian retail
    // sites often price 22K higher than that (making charges baked into
    // jewellery rates). Accept ratios in [0.88, 0.98]. Outside this band
    // suggests the page format changed or we matched the wrong numbers.
    const ratio = r22 / r24;
    if (ratio < 0.88 || ratio > 0.98) {
      console.error(`ibja: bankbazaar ratio out of band: 22K=${r22}, 24K=${r24}, ratio=${ratio}`);
      return null;
    }

    return {
      ratePerGram24K: r24,
      ratePerGram22K: r22,
      asOfDate: todayIso(),
      source: 'BANKBAZAAR_CHENNAI',
    };
  } catch (err) {
    console.error('ibja: bankbazaar fetch failed:', err);
    return null;
  }
}

async function fetchFromYahooFutures(): Promise<GoldRate | null> {
  // Gold futures in USD/oz and USDINR FX rate, in parallel.
  const [goldMeta, fxMeta] = await Promise.all([
    fetchYahooMeta('GC=F'),
    fetchYahooMeta('USDINR=X'),
  ]);

  if (!goldMeta?.regularMarketPrice || !fxMeta?.regularMarketPrice) {
    return null;
  }

  const usdPerOz = goldMeta.regularMarketPrice;
  const usdInr = fxMeta.regularMarketPrice;
  const spotInrPerGram = (usdPerOz / GRAMS_PER_TROY_OUNCE) * usdInr;
  const inrPerGram = spotInrPerGram * INDIA_RETAIL_PREMIUM;

  if (!Number.isFinite(inrPerGram) || inrPerGram <= 0) return null;
  return buildRate(inrPerGram, 'YAHOO_FUTURES', {
    usdPerOz,
    usdInr,
    spotInrPerGram: Math.round(spotInrPerGram * 100) / 100,
    premiumMultiplier: INDIA_RETAIL_PREMIUM,
  });
}

/**
 * Returns the current gold rate. Never throws — always returns a rate,
 * falling back to MANUAL_FALLBACK if all live sources fail.
 */
export async function getCurrentGoldRate(): Promise<GoldRate> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.rate;
  }

  // Primary: bankbazaar Chennai retail (actual local jewellery-store rate).
  const chennai = await fetchFromBankBazaarChennai();
  if (chennai) {
    cache = { rate: chennai, timestamp: Date.now() };
    return chennai;
  }

  // Fallback: Yahoo futures × USDINR × INDIA_RETAIL_PREMIUM.
  const yahoo = await fetchFromYahooFutures();
  if (yahoo) {
    cache = { rate: yahoo, timestamp: Date.now() };
    return yahoo;
  }

  if (cache) {
    console.info('ibja: returning stale cache');
    return cache.rate;
  }

  const fallback = buildRate(MANUAL_FALLBACK_24K, 'MANUAL_FALLBACK');
  cache = { rate: fallback, timestamp: Date.now() };
  return fallback;
}

/**
 * Convert a gold holding's weight + purity to current INR value.
 *   grams         — weight in grams
 *   purity        — '999' | '995' | '916'
 *   ratePerGram24K — 24K (999) rate in INR per gram
 *
 * Returns INR (rupees, not paisa).
 */
export function calculateValue(
  grams: number,
  purity: '999' | '995' | '916',
  ratePerGram24K: number
): number {
  const purityFactor =
    purity === '999' ? 1 : purity === '995' ? 0.995 : 0.916;
  return grams * ratePerGram24K * purityFactor;
}
