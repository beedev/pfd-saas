/**
 * Sector strength — momentum clusters. If several of today's strongest names share
 * a sector (Banking leading, or Power, or Defence), that sector is "in gear" and a
 * candidate in it deserves a boost. Built from the curated Nifty sector universes;
 * stocks outside them score neutral. Feeds the pick score (the review's "buy the
 * strongest stock in the strongest sector").
 */

import { resolveUniverse } from './universes';

const SECTOR_KEYS = ['NIFTY_BANK', 'NIFTY_IT', 'NIFTY_PHARMA', 'NIFTY_AUTO', 'NIFTY_FMCG', 'NIFTY_METAL', 'NIFTY_ENERGY', 'NIFTY_REALTY', 'NIFTY_FIN_SERVICE'];

let cached: Map<string, string> | null = null;
function sectorMap(): Map<string, string> {
  if (cached) return cached;
  const m = new Map<string, string>();
  for (const key of SECTOR_KEYS) {
    const label = key.replace('NIFTY_', '');
    for (const sym of resolveUniverse(key)) if (!m.has(sym)) m.set(sym, label);
  }
  cached = m;
  return m;
}

/** Sector label for a `.NS` symbol, or 'OTHER' if not in a tracked sector. */
export function sectorOf(symbol: string): string {
  return sectorMap().get(symbol) ?? 'OTHER';
}

/**
 * Per-symbol sector-strength score (0..1): how many of the STRONG names share its
 * sector, normalized by the biggest cluster. 'OTHER' (untracked) scores neutral 0.5.
 */
export function sectorStrengthScores(strongSymbols: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of strongSymbols) { const sec = sectorOf(s); if (sec !== 'OTHER') counts.set(sec, (counts.get(sec) ?? 0) + 1); }
  const max = Math.max(1, ...counts.values());
  const out = new Map<string, number>();
  for (const s of strongSymbols) { const sec = sectorOf(s); out.set(s, sec === 'OTHER' ? 0.5 : (counts.get(sec) ?? 0) / max); }
  return out;
}
