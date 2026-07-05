/**
 * RS + Stage-2 screen — dynamically surfaces the strongest names instead of a
 * static blue-chip watchlist. The RELIANCE finding (2026-07-05) showed the fixed
 * watchlist was the weak link: blue chips are rarely Stage 2. This screens a
 * universe for names that are BOTH in Stage 2 (advancing) AND leading the index
 * on relative strength — the WealthLab "RS Screen" idea, in our own engine.
 *
 * RS = the stock's 6-month return minus the index's, so only names OUTPERFORMING
 * the market survive. Stage-2 gate (workbench/stage) removes basing/declining
 * names. Output feeds the morning pipeline as fresh MULTIDAY candidates.
 */

import { loadDaily } from '../workbench/data';
import { computeStage } from '../workbench/stage';

export interface StrongName { symbol: string; name: string; rsExcess: number; stage: 'STAGE2' }

const LOOKBACK = 126;            // ~6 months of trading days
const CONCURRENCY = 8;

/** 6-month total return of a close series (0 if too short). */
function ret6mo(closes: number[]): number {
  if (closes.length < LOOKBACK + 1) return 0;
  return closes[closes.length - 1] / closes[closes.length - 1 - LOOKBACK] - 1;
}

/**
 * Screen a universe for Stage-2 names beating the index on 6-month RS.
 * Returns the top `limit`, strongest first. Bars are loaded concurrency-limited.
 */
export async function screenRsStage(universe: string[], indexSymbol: string, limit: number): Promise<StrongName[]> {
  const idx = await loadDaily(indexSymbol, '1y').catch(() => []);
  const idxRet = ret6mo(idx.map((b) => b.close));

  const found: StrongName[] = [];
  for (let i = 0; i < universe.length; i += CONCURRENCY) {
    const batch = universe.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(batch.map(async (sym): Promise<StrongName | null> => {
      const bars = await loadDaily(sym, '1y').catch(() => []);
      if (bars.length < 220) return null;                        // need a 200-DMA to stage
      const closes = bars.map((b) => b.close);
      if (computeStage(closes) !== 'STAGE2') return null;        // advancing only
      const rsExcess = ret6mo(closes) - idxRet;                  // must beat the market
      if (rsExcess <= 0) return null;
      return { symbol: sym, name: sym.replace('.NS', ''), rsExcess, stage: 'STAGE2' };
    }));
    for (const r of rows) if (r) found.push(r);
  }
  return found.sort((a, b) => b.rsExcess - a.rsExcess).slice(0, limit);
}
