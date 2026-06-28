/**
 * Indian transaction-cost + tax model for the backtester. Never zero-cost —
 * this is what reveals whether a high-turnover sleeve actually has a net edge.
 * All money in paisa; rates in percent. Defaults are deliberately conservative.
 *
 * Equity/futures: STT + exchange/SEBI/stamp/GST (lumped) + slippage, per side.
 * Mutual funds: no per-side STT; a 1% exit load if redeemed within 365 days.
 * Capital-gains tax applied to realized gains: STCG 20% (<365d) / LTCG 12.5%.
 */

import type { AgentAssetClass } from '@/db';

export interface CostModel {
  equitySttPctPerSide: number;
  equityChargesPctPerSide: number;
  slippagePctPerSide: number;
  mfExitLoadPct: number;
  mfExitLoadDays: number;
  stcgPct: number;
  ltcgPct: number;
  ltcgThresholdDays: number;
}

export const DEFAULT_COST_MODEL: CostModel = {
  equitySttPctPerSide: 0.1,      // STT, delivery, each side
  equityChargesPctPerSide: 0.03, // exchange + SEBI + stamp + GST, lumped
  slippagePctPerSide: 0.05,      // conservative for liquid large-caps
  mfExitLoadPct: 1.0,
  mfExitLoadDays: 365,
  stcgPct: 20,
  ltcgPct: 12.5,
  ltcgThresholdDays: 365,
};

const round = (n: number) => Math.round(n);

/** Transaction cost (paisa) on one trade leg (BUY or SELL) of given notional. */
export function tradeCostPaisa(
  notionalPaisa: number,
  assetClass: AgentAssetClass,
  isSell: boolean,
  holdingDays: number,
  m: CostModel,
): number {
  if (assetClass === 'MF') {
    // Exit load only on sells within the load window; buys are load-free.
    if (isSell && holdingDays < m.mfExitLoadDays) return round((m.mfExitLoadPct / 100) * notionalPaisa);
    return 0;
  }
  const pct = m.equitySttPctPerSide + m.equityChargesPctPerSide + m.slippagePctPerSide;
  return round((pct / 100) * notionalPaisa);
}

/** Capital-gains tax (paisa) on a realized gain, by holding period. */
export function cgTaxPaisa(gainPaisa: number, holdingDays: number, m: CostModel): number {
  if (gainPaisa <= 0) return 0;
  const rate = holdingDays >= m.ltcgThresholdDays ? m.ltcgPct : m.stcgPct;
  return round((rate / 100) * gainPaisa);
}
