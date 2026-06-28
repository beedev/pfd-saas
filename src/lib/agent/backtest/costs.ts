/**
 * Indian transaction-cost + tax model — HOLDING-PERIOD AWARE, so a trade is
 * charged what it would really cost given how long it was held:
 *
 *   Same-day round trip (intraday): intraday STT (0.025%, SELL side only),
 *     low slippage on liquid F&O names, and slab-rate tax on the speculative gain.
 *   Overnight+ (delivery / swing): delivery STT (0.1% BOTH sides), normal
 *     slippage, STCG (<365d) / LTCG (>=365d).
 *
 * Costs are settled at the SELL leg (full round trip) so the BUY leg never has
 * to guess the eventual holding period. Mutual funds: no per-side STT; a 1%
 * exit load if redeemed within 365 days. Never zero-cost — this is what reveals
 * whether a high-turnover sleeve actually has a net edge. Money in paisa; rates %.
 */

import type { AgentAssetClass } from '@/db';

export interface CostModel {
  sttDeliveryPctPerSide: number;      // delivery STT, each side
  sttIntradaySellPct: number;         // intraday STT, sell side only
  chargesPctPerSide: number;          // exchange + SEBI + stamp + GST, lumped, each side
  slippageDeliveryPctPerSide: number; // swing / large-cap
  slippageIntradayPctPerSide: number; // liquid F&O, intraday
  mfExitLoadPct: number;
  mfExitLoadDays: number;
  stcgPct: number;                    // equity short-term (<365d, delivery)
  ltcgPct: number;                    // equity long-term
  ltcgThresholdDays: number;
  intradaySlabPct: number;            // same-day speculative gain, slab proxy (conservative)
}

export const DEFAULT_COST_MODEL: CostModel = {
  sttDeliveryPctPerSide: 0.1,
  sttIntradaySellPct: 0.025,
  chargesPctPerSide: 0.03,
  slippageDeliveryPctPerSide: 0.05,
  slippageIntradayPctPerSide: 0.02,
  mfExitLoadPct: 1.0,
  mfExitLoadDays: 365,
  stcgPct: 20,
  ltcgPct: 12.5,
  ltcgThresholdDays: 365,
  intradaySlabPct: 30,
};

const round = (n: number) => Math.round(n);

/**
 * Round-trip transaction cost (paisa), charged entirely at the SELL leg; the BUY
 * leg returns 0 so it never has to guess whether the trade will be intraday.
 *   intraday (holdingDays === 0): intraday STT (sell-only) + 2× intraday slippage + 2× charges.
 *   delivery (holdingDays >= 1):  2× delivery STT + 2× delivery slippage + 2× charges.
 */
export function tradeCostPaisa(
  notionalPaisa: number,
  assetClass: AgentAssetClass,
  isSell: boolean,
  holdingDays: number,
  m: CostModel,
): number {
  if (assetClass === 'MF') {
    if (isSell && holdingDays < m.mfExitLoadDays) return round((m.mfExitLoadPct / 100) * notionalPaisa);
    return 0;
  }
  if (!isSell) return 0; // round-trip cost settled at exit
  const intraday = holdingDays === 0;
  const stt = intraday ? m.sttIntradaySellPct : m.sttDeliveryPctPerSide * 2;
  const slip = (intraday ? m.slippageIntradayPctPerSide : m.slippageDeliveryPctPerSide) * 2;
  const charges = m.chargesPctPerSide * 2;
  return round(((stt + slip + charges) / 100) * notionalPaisa);
}

/** Capital-gains / speculative tax (paisa) on a realized gain, by holding period. */
export function cgTaxPaisa(gainPaisa: number, holdingDays: number, m: CostModel): number {
  if (gainPaisa <= 0) return 0;
  const rate = holdingDays === 0 ? m.intradaySlabPct
    : holdingDays >= m.ltcgThresholdDays ? m.ltcgPct
    : m.stcgPct;
  return round((rate / 100) * gainPaisa);
}

/**
 * Break-even round-trip cost (%) a trade must clear BEFORE tax — for the hurdle
 * display. intraday=true uses the same-day rate stack; false uses delivery.
 */
export function roundTripCostPct(m: CostModel, intraday: boolean): number {
  const stt = intraday ? m.sttIntradaySellPct : m.sttDeliveryPctPerSide * 2;
  const slip = (intraday ? m.slippageIntradayPctPerSide : m.slippageDeliveryPctPerSide) * 2;
  return stt + slip + m.chargesPctPerSide * 2;
}
