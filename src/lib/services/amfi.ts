/**
 * AMFI NAV service.
 *
 * Fetches and parses the daily NAV file from AMFI India:
 *   https://www.amfiindia.com/spages/NAVAll.txt
 *
 * The file is a pipe-delimited ("; " actually ";") text file with section
 * headers (AMC group lines have no semicolons and must be skipped).
 *
 * Fund lines have the shape:
 *   SchemeCode;ISIN Div Payout/Growth;ISIN Div Reinvestment;SchemeName;NAV;Date
 *
 * The full file is ~5 MB and is refreshed once per business day. We cache it
 * in-memory for 1 hour; if the fetch fails and a cached copy exists, the stale
 * cache is returned so the UI never goes blank.
 */

export interface AmfiFund {
  schemeCode: string;
  isin: string;
  schemeName: string;
  nav: number;      // rupees
  navDate: string;  // ISO YYYY-MM-DD
}

const AMFI_ENDPOINT = 'https://www.amfiindia.com/spages/NAVAll.txt';
const USER_AGENT = 'Mozilla/5.0 (compatible; PersonalFinanceDashboard/1.0)';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cache: { funds: AmfiFund[]; timestamp: number } | null = null;

// "08-Apr-2026" -> "2026-04-08"
const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function parseAmfiDate(raw: string): string {
  const parts = raw.trim().split('-');
  if (parts.length !== 3) return '';
  const [dd, monStr, yyyy] = parts;
  const mm = MONTHS[monStr];
  if (!mm) return '';
  return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
}

function parseNavAll(text: string): AmfiFund[] {
  const lines = text.split(/\r?\n/);
  const funds: AmfiFund[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Header row
    if (line.startsWith('Scheme Code')) continue;
    // AMC group headers / open-ended markers have no semicolons
    if (!line.includes(';')) continue;

    const cols = line.split(';');
    if (cols.length < 6) continue;

    const [schemeCode, isinGrowth, isinReinv, schemeName, navStr, dateStr] = cols;

    const nav = parseFloat(navStr);
    if (!Number.isFinite(nav) || nav <= 0) continue;

    const isin = (isinGrowth && isinGrowth !== '-' ? isinGrowth : isinReinv).trim();
    if (!schemeCode || !schemeName) continue;

    funds.push({
      schemeCode: schemeCode.trim(),
      isin,
      schemeName: schemeName.trim(),
      nav,
      navDate: parseAmfiDate(dateStr),
    });
  }

  return funds;
}

async function fetchAndCache(): Promise<AmfiFund[]> {
  try {
    const response = await fetch(AMFI_ENDPOINT, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
    });
    if (!response.ok) {
      console.error(`AMFI fetch failed: ${response.status}`);
      if (cache) return cache.funds;
      return [];
    }
    const text = await response.text();
    const funds = parseNavAll(text);
    cache = { funds, timestamp: Date.now() };
    return funds;
  } catch (err) {
    console.error('AMFI fetch error:', err);
    if (cache) {
      console.info('Returning stale AMFI cache');
      return cache.funds;
    }
    return [];
  }
}

export async function getAllNavs(): Promise<AmfiFund[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.funds;
  }
  return fetchAndCache();
}

export async function searchByName(query: string, limit = 20): Promise<AmfiFund[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const funds = await getAllNavs();
  const matches: AmfiFund[] = [];
  for (const f of funds) {
    if (f.schemeName.toLowerCase().includes(q)) {
      matches.push(f);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

export async function getByIsin(isin: string): Promise<AmfiFund | null> {
  const target = isin.trim().toUpperCase();
  if (!target) return null;
  const funds = await getAllNavs();
  return funds.find((f) => f.isin.toUpperCase() === target) ?? null;
}

export async function getBySchemeCode(code: string): Promise<AmfiFund | null> {
  const target = code.trim();
  if (!target) return null;
  const funds = await getAllNavs();
  return funds.find((f) => f.schemeCode === target) ?? null;
}

// ---------------------------------------------------------------------------
// Historical NAV via mfapi.in
// ---------------------------------------------------------------------------

interface MfApiDataPoint {
  date: string; // "DD-MM-YYYY"
  nav: string;  // e.g. "45.1234"
}

interface MfApiResponse {
  meta: Record<string, string>;
  data: MfApiDataPoint[];
  status: string;
}

// In-memory cache: schemeCode -> full history (sorted newest-first by mfapi.in)
const historyCache = new Map<string, { data: MfApiDataPoint[]; timestamp: number }>();
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch the historical NAV for a scheme on a date, AND the date that NAV
 * actually belongs to.
 *
 * If the target date has no published NAV (weekend OR exchange holiday),
 * the nearest published NAV on or after the target is returned together
 * with ITS real date. Callers must settle a redemption at that real date
 * — not the requested date — so the FY and LTCG/STCG classification are
 * correct (a holiday redemption legally takes the next business day's
 * NAV, and that day is the sale date for tax purposes).
 *
 * @param schemeCode - AMFI scheme code (e.g. "119551")
 * @param dateIso    - ISO date string "YYYY-MM-DD"
 * @returns { navRupees, navDateIso } or null if lookup fails / not yet published
 */
export async function getHistoricalNavOn(
  schemeCode: string,
  dateIso: string,
): Promise<{ navRupees: number; navDateIso: string } | null> {
  try {
    const code = schemeCode.trim();
    if (!code || !dateIso) return null;
    // Scheme codes are numeric AMFI identifiers — reject anything else
    // before it reaches the URL (prevents path/query injection).
    if (!/^\d+$/.test(code)) return null;

    let dataPoints: MfApiDataPoint[];

    // Check cache
    const cached = historyCache.get(code);
    if (cached && Date.now() - cached.timestamp < HISTORY_CACHE_TTL_MS) {
      dataPoints = cached.data;
    } else {
      const response = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, {
        headers: { 'User-Agent': USER_AGENT },
        cache: 'no-store',
      });
      if (!response.ok) {
        console.error(`mfapi.in fetch failed for ${code}: ${response.status}`);
        return null;
      }
      const json: MfApiResponse = await response.json();
      if (!json.data || !Array.isArray(json.data)) return null;
      dataPoints = json.data;
      historyCache.set(code, { data: dataPoints, timestamp: Date.now() });
    }

    // Parse target date
    const target = new Date(dateIso + 'T00:00:00Z');
    if (isNaN(target.getTime())) return null;

    // mfapi.in data is sorted newest-first. Take the EARLIEST published NAV on or
    // after the target date: exact match if present, otherwise the next available
    // NAV — with NO distance cap, so weekends, holidays and any gap in the feed
    // resolve naturally (the published NAV dates ARE the business calendar). If
    // nothing exists on or after the target (NAV not yet published / future date),
    // return null so the caller keeps the redemption pending.
    let bestNav: number | null = null;
    let bestDate: Date | null = null;

    for (const point of dataPoints) {
      const parts = point.date.split('-');
      if (parts.length !== 3) continue;
      const [dd, mm, yyyy] = parts;
      const entryDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
      if (isNaN(entryDate.getTime())) continue;

      const nav = parseFloat(point.nav);
      if (!Number.isFinite(nav) || nav <= 0) continue;

      if (entryDate.getTime() < target.getTime()) continue; // only on/after target
      if (!bestDate || entryDate < bestDate) {
        bestNav = nav;
        bestDate = entryDate;
      }
    }

    if (bestNav != null && bestDate != null) {
      return { navRupees: bestNav, navDateIso: bestDate.toISOString().slice(0, 10) };
    }
    return null;
  } catch (err) {
    console.error('Historical NAV lookup error:', err);
    return null;
  }
}

/**
 * Back-compat wrapper: the NAV value only. Prefer {@link getHistoricalNavOn}
 * in settlement paths so the real NAV date drives the sale date.
 */
export async function getHistoricalNav(
  schemeCode: string,
  dateIso: string,
): Promise<number | null> {
  const r = await getHistoricalNavOn(schemeCode, dateIso);
  return r?.navRupees ?? null;
}

/**
 * Full NAV history for a scheme, chronologically ordered (oldest → newest),
 * for the analyst agent's trailing-return signals. Reuses the same mfapi.in
 * source + 30-min cache as {@link getHistoricalNavOn}. Empty array on failure.
 */
export async function getNavHistory(
  schemeCode: string,
): Promise<Array<{ dateIso: string; nav: number }>> {
  try {
    const code = schemeCode.trim();
    if (!code || !/^\d+$/.test(code)) return [];

    let dataPoints: MfApiDataPoint[];
    const cached = historyCache.get(code);
    if (cached && Date.now() - cached.timestamp < HISTORY_CACHE_TTL_MS) {
      dataPoints = cached.data;
    } else {
      const response = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, {
        headers: { 'User-Agent': USER_AGENT },
        cache: 'no-store',
      });
      if (!response.ok) {
        console.error(`mfapi.in fetch failed for ${code}: ${response.status}`);
        return [];
      }
      const json: MfApiResponse = await response.json();
      if (!json.data || !Array.isArray(json.data)) return [];
      dataPoints = json.data;
      historyCache.set(code, { data: dataPoints, timestamp: Date.now() });
    }

    const out: Array<{ dateIso: string; nav: number }> = [];
    for (const point of dataPoints) {
      const parts = point.date.split('-');
      if (parts.length !== 3) continue;
      const [dd, mm, yyyy] = parts;
      const nav = parseFloat(point.nav);
      if (!Number.isFinite(nav) || nav <= 0) continue;
      out.push({ dateIso: `${yyyy}-${mm}-${dd}`, nav });
    }
    // mfapi.in is newest-first; sort ascending for the signal engine.
    out.sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : 0));
    return out;
  } catch (err) {
    console.error('NAV history lookup error:', err);
    return [];
  }
}

/**
 * Resolve an ISIN to an AMFI scheme code by looking up the daily NAV file.
 */
export async function getSchemeCodeByIsin(isin: string): Promise<string | null> {
  const fund = await getByIsin(isin);
  return fund?.schemeCode ?? null;
}
