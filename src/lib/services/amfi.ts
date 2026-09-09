/**
 * AMFI NAV service.
 *
 * Fetches and parses the daily NAV file from AMFI India:
 *   https://portal.amfiindia.com/spages/NAVAll.txt
 *
 * The file is a semicolon-delimited text file with section headers (AMC group
 * lines have no semicolons and must be skipped).
 *
 * IMPORTANT — the column layout is NOT stable. AMFI has shipped at least two:
 *
 *   6-column (historic):
 *     SchemeCode;ISIN Payout/Growth;ISIN Reinvest;SchemeName;NAV;Date
 *
 *   8-column (current, seen 2026-09):
 *     SchemeCode;ISIN Payout/Growth;ISIN Reinvest;SchemeName;Plan;Option;NAV;Date
 *
 * The 8-column change silently broke a front-indexed parser: `cols[4]` went
 * from being the NAV to being "Direct Plan", every parseFloat returned NaN,
 * and the whole file parsed to zero funds for ~3 weeks without a single error
 * being logged (see docs/changes/CHANGES-2026-09-09.md).
 *
 * So we anchor to the END of the row instead of the front: NAV and Date are
 * always the last two fields, the identifiers are always the first three, and
 * everything between is the scheme's display name. That is correct for both
 * layouts and survives AMFI inserting further descriptive columns.
 *
 * The full file is ~1.5 MB and is refreshed once per business day. We cache it
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

// Canonical host. www.amfiindia.com 302-redirects here; pin the target so we
// do not depend on a redirect AMFI may retire.
const AMFI_ENDPOINT = 'https://portal.amfiindia.com/spages/NAVAll.txt';
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

    // End-anchored: NAV and Date are ALWAYS the final two fields, in both the
    // 6- and 8-column layouts. Never index the NAV from the front.
    const navStr = cols[cols.length - 2];
    const dateStr = cols[cols.length - 1];

    const nav = parseFloat(navStr);
    if (!Number.isFinite(nav) || nav <= 0) continue;

    const [schemeCode, isinGrowth, isinReinv] = cols;

    // Everything between the identifiers and the NAV is the display name. In
    // the 6-column layout that is a single pre-joined field; in the 8-column
    // layout AMFI splits it into Scheme Name / Plan / Option, so re-join them.
    const schemeName = cols
      .slice(3, cols.length - 2)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' - ');

    const isin = (isinGrowth && isinGrowth !== '-' ? isinGrowth : isinReinv).trim();
    if (!schemeCode || !schemeName) continue;

    funds.push({
      schemeCode: schemeCode.trim(),
      isin,
      schemeName,
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

    // A non-empty file that yields ZERO funds is a format break, not a quiet
    // day. Never cache that: caching it would serve an empty NAV universe for
    // the next hour and turn a parser bug into silent wrong answers everywhere
    // downstream (SIP execution skips every fund, search returns nothing,
    // redemptions cannot price). Shout, and keep serving the last good copy.
    if (funds.length === 0 && text.trim().length > 0) {
      console.error(
        `AMFI parse yielded 0 funds from ${text.length} bytes — the NAVAll.txt ` +
        `column layout has probably changed again. Check parseNavAll(). ` +
        `First data line: ${text.split(/\r?\n/).find((l) => l.includes(';')) ?? '(none)'}`,
      );
      if (cache) {
        console.info('Serving stale AMFI cache rather than an empty NAV universe');
        return cache.funds;
      }
      return [];
    }

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
 * Resolve an ISIN to an AMFI scheme code by looking up the daily NAV file.
 */
export async function getSchemeCodeByIsin(isin: string): Promise<string | null> {
  const fund = await getByIsin(isin);
  return fund?.schemeCode ?? null;
}
