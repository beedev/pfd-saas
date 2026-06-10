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
 * Fetch historical NAV for a given scheme code on a specific date.
 *
 * Uses https://api.mfapi.in/mf/{schemeCode} which returns the full history.
 * Finds the NAV on or just before the target date.
 *
 * @param schemeCode - AMFI scheme code (e.g. "119551")
 * @param dateIso   - ISO date string "YYYY-MM-DD"
 * @returns NAV in rupees, or null if lookup fails
 */
export async function getHistoricalNav(
  schemeCode: string,
  dateIso: string,
): Promise<number | null> {
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

    // mfapi.in data is sorted newest-first. Find the NAV for the exact date
    // or the nearest business day on or after the target (handles weekends/holidays).
    // If no NAV exists on or after target (i.e., future date), return null.
    let exactNav: number | null = null;
    let nearestAfterNav: number | null = null;
    let nearestAfterDate: Date | null = null;

    for (const point of dataPoints) {
      const parts = point.date.split('-');
      if (parts.length !== 3) continue;
      const [dd, mm, yyyy] = parts;
      const entryDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
      if (isNaN(entryDate.getTime())) continue;

      const nav = parseFloat(point.nav);
      if (!Number.isFinite(nav) || nav <= 0) continue;

      // Exact match
      if (entryDate.getTime() === target.getTime()) {
        exactNav = nav;
        break;
      }

      // Nearest entry on or after target (within 5 days to handle long weekends)
      if (entryDate > target) {
        const diffDays = (entryDate.getTime() - target.getTime()) / 86400000;
        if (diffDays <= 5 && (!nearestAfterDate || entryDate < nearestAfterDate)) {
          nearestAfterNav = nav;
          nearestAfterDate = entryDate;
        }
      }
    }

    return exactNav ?? nearestAfterNav;
  } catch (err) {
    console.error('Historical NAV lookup error:', err);
    return null;
  }
}

/**
 * Resolve an ISIN to an AMFI scheme code by looking up the daily NAV file.
 */
export async function getSchemeCodeByIsin(isin: string): Promise<string | null> {
  const fund = await getByIsin(isin);
  return fund?.schemeCode ?? null;
}
