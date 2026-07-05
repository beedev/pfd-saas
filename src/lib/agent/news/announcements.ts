/**
 * Whole-spectrum candidate source — NSE corporate announcements. Breaks the
 * "Nifty-500 bubble": instead of only looking at stocks already on a list, we let
 * the market's own official filings nominate candidates. ANY listed stock that
 * files a material announcement enters the pool; the character + Stage-2 +
 * liquidity gates downstream decide whether it's actually tradeable.
 *
 * The entity is already resolved — each NSE filing carries the stock's symbol —
 * so no LLM extraction is needed. We keep only material categories (results,
 * orders, fund-raising, M&A, …) and hand back unique symbols.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface Announcement { symbol: string; company: string; text: string; category: string; at: string }

// Material = likely to move price. Routine compliance filings are dropped.
const MATERIAL = /order|bag(s|ged)?|win(s|ning)?|award|contract|acqui|merger|amalgamat|fund\s*rais|preferential|qip|rights issue|result|profit|revenue|dividend|bonus|split|buyback|approv|launch|expansion|capacity|investment|stake|deal|agreement|partnership|joint venture|patent|approval|de-?merger|record date|earnings/i;
const ROUTINE = /trading window|newspaper|compliance certificate|scrutinizer|voting result|postal ballot|duplicate|loss of|reg\.?\s*74|reg\.?\s*39|reg\.?\s*40|certificate under|analyst\/?\s*institutional|investor meet|schedule of|closure of trading|intimation of|record of|book closure/i;

interface RawAnn { symbol?: string; sm_name?: string; attchmntText?: string; desc?: string; an_dt?: string }

async function nseCookies(): Promise<string> {
  const res = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const set = (res.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return set.map((c) => c.split(';')[0]).join('; ');
}

/** Recent NSE corporate announcements, material only, deduped by symbol (latest first). */
export async function getAnnouncements(limit = 60): Promise<Announcement[]> {
  let cookies = '';
  try { cookies = await nseCookies(); } catch { return []; }
  let raw: RawAnn[] = [];
  try {
    const res = await fetch('https://www.nseindia.com/api/corporate-announcements?index=equities', {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements', ...(cookies ? { Cookie: cookies } : {}) },
    });
    if (!res.ok) return [];
    raw = (await res.json()) as RawAnn[];
  } catch { return []; }
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: Announcement[] = [];
  for (const a of raw) {
    const symbol = (a.symbol ?? '').trim().toUpperCase();
    const text = (a.attchmntText ?? '').trim();
    if (!symbol || seen.has(symbol)) continue;
    const blob = `${text} ${a.desc ?? ''}`;
    if (ROUTINE.test(blob) || !MATERIAL.test(blob)) continue;   // keep only material, non-routine
    seen.add(symbol);
    out.push({ symbol, company: (a.sm_name ?? '').trim(), text, category: (a.desc ?? '').trim(), at: (a.an_dt ?? '').trim() });
    if (out.length >= limit) break;
  }
  return out;
}

/** Unique `.NS` symbols with a material announcement — the candidate feed. */
export async function getAnnouncementSymbols(limit = 40): Promise<string[]> {
  const anns = await getAnnouncements(limit).catch(() => []);
  return anns.map((a) => `${a.symbol}.NS`);
}
