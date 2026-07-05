/**
 * NSE end-of-day bhavcopy provider — the free, whole-universe source of daily
 * VOLUME and DELIVERY % that Yahoo can't give us. Fetches `sec_bhavdata_full`
 * (all NSE equities, one row each) past NSE's bot-protection via a cookie
 * handshake + browser-like headers, and parses it into a per-symbol map.
 *
 * Two things it unlocks:
 *   • real traded-value/day  → the liquidity gate stops being a Yahoo guess.
 *   • delivery %             → a CONVICTION signal (high delivery = real buying
 *                              to hold, not intraday churn).
 *
 * EOD only (fine for our daily/swing cadence). In-memory cached per trading day.
 * Proven 2026-07-05: Fri file 372 KB, RELIANCE vol 78.4L / delivery 66.1%.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const ARCHIVE = 'https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_';

export interface BhavRow {
  symbol: string;          // NSE symbol, no suffix (e.g. "RELIANCE")
  close: number;           // rupees
  volume: number;          // shares traded
  tradedValueCr: number;   // ₹ crore traded (turnover)
  deliveryQty: number;
  deliveryPct: number;     // 0..100 — share of volume taken for delivery
}

const cache = new Map<string, Map<string, BhavRow>>();   // dateKey → symbol → row
const ddmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;

/** Grab NSE session cookies from the homepage (required before hitting the archive). */
async function nseCookies(): Promise<string> {
  const res = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const set = (res.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return set.map((c) => c.split(';')[0]).join('; ');
}

function parseBhav(csv: string): Map<string, BhavRow> {
  const out = new Map<string, BhavRow>();
  const lines = csv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < 15) continue;
    if (cols[1] !== 'EQ') continue;                        // equity series only
    const symbol = cols[0];
    const close = parseFloat(cols[8]);                     // CLOSE_PRICE
    const volume = parseInt(cols[10], 10);                 // TTL_TRD_QNTY
    const turnoverLacs = parseFloat(cols[11]);             // TURNOVER_LACS (₹ lakh)
    const deliveryQty = parseInt(cols[13], 10);            // DELIV_QTY
    const deliveryPct = parseFloat(cols[14]);              // DELIV_PER
    if (!symbol || !Number.isFinite(close)) continue;
    out.set(symbol, {
      symbol, close,
      volume: Number.isFinite(volume) ? volume : 0,
      tradedValueCr: Number.isFinite(turnoverLacs) ? turnoverLacs / 100 : 0,   // lakh → crore
      deliveryQty: Number.isFinite(deliveryQty) ? deliveryQty : 0,
      deliveryPct: Number.isFinite(deliveryPct) ? deliveryPct : 0,
    });
  }
  return out;
}

/** Fetch + parse one specific date's archive (null if weekend/holiday/missing). */
async function fetchDateRows(d: Date, cookies: string): Promise<Map<string, BhavRow> | null> {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return null;                 // weekend
  try {
    const res = await fetch(`${ARCHIVE}${ddmmyyyy(d)}.csv`, {
      headers: { 'User-Agent': UA, Referer: 'https://www.nseindia.com/', ...(cookies ? { Cookie: cookies } : {}) },
    });
    if (!res.ok) return null;
    const csv = await res.text();
    if (csv.length < 5000 || !csv.includes('DELIV_PER')) return null;
    const map = parseBhav(csv);
    return map.size > 100 ? map : null;
  } catch { return null; }
}

/** Fetch the most recent available bhavcopy (walks back up to 6 days over weekends/holidays). */
export async function getBhavcopy(): Promise<Map<string, BhavRow>> {
  const today = new Date();
  const key = ddmmyyyy(today);
  if (cache.has(key)) return cache.get(key)!;
  let cookies = '';
  try { cookies = await nseCookies(); } catch { /* archive sometimes serves without */ }
  for (let back = 0; back <= 6; back++) {
    const rows = await fetchDateRows(new Date(today.getTime() - back * 86400000), cookies);
    if (rows) { cache.set(key, rows); return rows; }
  }
  cache.set(key, new Map());                               // negative-cache the miss for this run
  return cache.get(key)!;
}

/** Fetch a specific past date's bhavcopy (used by the delivery-history backfill). */
export async function getBhavcopyForDate(d: Date): Promise<Map<string, BhavRow> | null> {
  let cookies = '';
  try { cookies = await nseCookies(); } catch { /* archive sometimes serves without */ }
  return fetchDateRows(d, cookies);
}

/** Convenience: look up one symbol (accepts "RELIANCE" or "RELIANCE.NS"). */
export async function getBhavRow(symbol: string): Promise<BhavRow | null> {
  const bhav = await getBhavcopy();
  return bhav.get(symbol.replace(/\.NS$/, '')) ?? null;
}
