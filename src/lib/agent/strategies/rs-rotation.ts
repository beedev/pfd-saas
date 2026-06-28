/**
 * Relative-strength rotation — the mutual-fund sleeve. Rank funds by
 * vol-adjusted 12-1 return; hold the top K; absolute filter (12-1 > 0) routes
 * weak funds to cash. Low churn (the orchestrator runs this slowly). Fractional
 * units allowed. NAV history closes are NAV×100 (paisa).
 */

import { returnBetween, annualisedVolatilityPct } from '../signals/indicators';
import { scoreToConfidence } from '../signals/score';
import { spendable, equalWeightQty } from '../engine/sizing';
import type { Strategy, SleeveContext, StrategyIntent, OpenPositionLite, InstrumentInput } from './types';
import { posKey } from './types';

interface Ranked { inst: InstrumentInput; mom: number; vol: number; norm: number; last: number; }

export const rsRotationStrategy: Strategy = {
  key: 'RS_ROTATION',
  run(ctx: SleeveContext): StrategyIntent[] {
    const p = ctx.params;
    const holdK = p.holdCount ?? 3;
    const bufferPct = p.cashBufferPct ?? 5;
    const alloc = ctx.sleeve.allocationPaisa;
    const buffer = Math.round((bufferPct / 100) * alloc);
    const perSlot = Math.round(alloc / holdK);

    const ranked: Ranked[] = [];
    for (const inst of ctx.instruments) {
      const closes = inst.history.map((h) => h.closePaisa);
      const mom = returnBetween(closes, 252, 21);
      if (mom == null) continue;
      const vol = annualisedVolatilityPct(closes) ?? 1;
      ranked.push({ inst, mom, vol, norm: mom / (vol || 1), last: inst.quote.lastPricePaisa });
    }
    ranked.sort((a, b) => b.norm - a.norm);
    const topKeys = new Set(
      ranked.filter((r) => r.mom > 0).slice(0, holdK).map((r) => posKey(r.inst.assetClass, r.inst.symbol, r.inst.schemeCode)),
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
      const inputs: Record<string, number | string> = { momentum12_1Pct: r.mom, volPct: r.vol, rank: i + 1, navPaisa: last };
      const signals = { momentum12_1Pct: r.mom, volatilityPct: r.vol, rank: i + 1 };
      const score = Math.max(-100, Math.min(100, Math.round(r.norm * 10)));
      const common = { watchlistId: inst.watchlistId, assetClass: inst.assetClass, symbol: inst.symbol, schemeCode: inst.schemeCode, name: inst.name, contractMultiplier: inst.contractMultiplier, side: 'LONG' as const, pricePaisa: last, signals };
      const asOf = inst.history.at(-1)?.date;

      if (pos && !inTop) {
        const amount = Math.round(last * pos.quantity * inst.contractMultiplier);
        out.push({ ...common, action: 'SELL', score, recommendation: 'SELL', confidence: 'MEDIUM', quantity: pos.quantity, amountPaisa: amount,
          evidence: { rule: `rank ${i + 1} fell out of top ${holdK}`, inputs, source: inst.source, dataAsOf: asOf } });
        cash += amount; openCount -= 1; return;
      }
      if (!pos && inTop && openCount < holdK) {
        const budget = Math.min(perSlot, spendable(cash, buffer));
        const qty = equalWeightQty(budget, last, inst.contractMultiplier, { fractional: true });
        if (qty > 0) {
          const amount = Math.round(last * qty * inst.contractMultiplier);
          out.push({ ...common, action: 'BUY', score, recommendation: 'BUY', confidence: scoreToConfidence(score), quantity: qty, amountPaisa: amount,
            evidence: { rule: `top ${holdK} fund by vol-adj 12-1 (rank ${i + 1})`, inputs, sizing: { units: qty, perSlotPaisa: perSlot, navPaisa: last }, source: inst.source, dataAsOf: asOf } });
          cash -= amount; openCount += 1; return;
        }
      }
      out.push({ ...common, action: pos ? 'HOLD' : 'WATCH', score, recommendation: inTop ? 'BUY' : 'HOLD', confidence: 'LOW', quantity: 0, amountPaisa: 0,
        evidence: { rule: pos ? `held, still top ${holdK}` : (inTop ? 'top fund but no room/cash' : `rank ${i + 1}, not top ${holdK}`), inputs, source: inst.source, dataAsOf: asOf } });
    });
    return out;
  },
};
