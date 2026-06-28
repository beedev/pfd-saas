/**
 * Cross-sectional momentum (12-1) — the ~3-month "short term" stock sleeve.
 * Rank the universe by 12-1 return (skip last month), vol-normalized; hold the
 * top N with an uptrend filter; absolute filter keeps us out of falling names.
 */

import { returnBetween, annualisedVolatilityPct, sma } from '../signals/indicators';
import { scoreToConfidence } from '../signals/score';
import { spendable, equalWeightQty } from '../engine/sizing';
import type { Strategy, SleeveContext, StrategyIntent, OpenPositionLite, InstrumentInput } from './types';
import { posKey } from './types';

interface Ranked { inst: InstrumentInput; mom: number; vol: number; norm: number; last: number; sma200: number | null; }

export const xsMomentumStrategy: Strategy = {
  key: 'XS_MOMENTUM',
  run(ctx: SleeveContext): StrategyIntent[] {
    const p = ctx.params;
    const topN = p.maxPositions ?? 6;
    const bufferPct = p.cashBufferPct ?? 10;
    const alloc = ctx.sleeve.allocationPaisa;
    const buffer = Math.round((bufferPct / 100) * alloc);
    const perSlot = Math.round(alloc / topN);

    // Compute metrics + rank.
    const ranked: Ranked[] = [];
    for (const inst of ctx.instruments) {
      const closes = inst.history.map((h) => h.closePaisa);
      const mom = returnBetween(closes, 252, 21);
      if (mom == null) continue;
      const vol = annualisedVolatilityPct(closes) ?? 1;
      ranked.push({ inst, mom, vol, norm: mom / (vol || 1), last: inst.quote.lastPricePaisa, sma200: sma(closes, 200) });
    }
    ranked.sort((a, b) => b.norm - a.norm);
    const topKeys = new Set(
      ranked.filter((r) => r.mom > 0 && (r.sma200 == null || r.last > r.sma200)).slice(0, topN)
        .map((r) => posKey(r.inst.assetClass, r.inst.symbol, r.inst.schemeCode)),
    );

    const held = new Map<string, OpenPositionLite>();
    for (const pos of ctx.positions) held.set(posKey(pos.assetClass, pos.symbol, pos.schemeCode), pos);
    let openCount = ctx.positions.length;
    let cash = ctx.cashPaisa;
    const out: StrategyIntent[] = [];

    ranked.forEach((r, i) => {
      const inst = r.inst;
      const key = posKey(inst.assetClass, inst.symbol, inst.schemeCode);
      const last = r.last;
      const inTop = topKeys.has(key);
      const pos = held.get(key);
      const inputs: Record<string, number | string> = { momentum12_1Pct: r.mom, volPct: r.vol, rank: i + 1, closePaisa: last, sma200Paisa: r.sma200 ?? -1 };
      const signals = { momentum12_1Pct: r.mom, volatilityPct: r.vol, rank: i + 1, sma200Paisa: r.sma200 ?? undefined };
      const score = Math.max(-100, Math.min(100, Math.round(r.norm * 10)));
      const common = { watchlistId: inst.watchlistId, assetClass: inst.assetClass, symbol: inst.symbol, schemeCode: inst.schemeCode, name: inst.name, contractMultiplier: inst.contractMultiplier, side: 'LONG' as const, pricePaisa: last, signals };
      const asOf = inst.history.at(-1)?.date;

      if (pos && !inTop) {
        const amount = Math.round(last * pos.quantity * inst.contractMultiplier);
        out.push({ ...common, action: 'SELL', score, recommendation: 'SELL', confidence: 'MEDIUM', quantity: pos.quantity, amountPaisa: amount,
          evidence: { rule: `rank ${i + 1} fell out of top ${topN}`, inputs, source: inst.source, dataAsOf: asOf } });
        cash += amount; openCount -= 1; return;
      }
      if (!pos && inTop && openCount < topN) {
        const budget = Math.min(perSlot, spendable(cash, buffer));
        const qty = equalWeightQty(budget, last, inst.contractMultiplier, { fractional: false });
        if (qty > 0) {
          const amount = Math.round(last * qty * inst.contractMultiplier);
          out.push({ ...common, action: 'BUY', score, recommendation: 'BUY', confidence: scoreToConfidence(score), quantity: qty, amountPaisa: amount,
            evidence: { rule: `top ${topN} by 12-1 momentum (rank ${i + 1}), uptrend`, inputs, sizing: { qty, perSlotPaisa: perSlot, priceUsedPaisa: last }, source: inst.source, dataAsOf: asOf } });
          cash -= amount; openCount += 1; return;
        }
      }
      out.push({ ...common, action: pos ? 'HOLD' : 'WATCH', score, recommendation: inTop ? 'BUY' : 'HOLD', confidence: 'LOW', quantity: 0, amountPaisa: 0,
        evidence: { rule: pos ? `held, still in top ${topN}` : (inTop ? 'top-ranked but no room/cash' : `rank ${i + 1}, not in top ${topN}`), inputs, source: inst.source, dataAsOf: asOf } });
    });
    return out;
  },
};
