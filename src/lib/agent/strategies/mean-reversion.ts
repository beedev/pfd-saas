/**
 * Mean-reversion (Connors RSI-2) — the 2-3 day "very short" sleeve.
 * Buy short-term oversold dips IN uptrends; exit on bounce or a time stop.
 * No tight price stop (Kaminski-Lo: price stops hurt mean-reversion).
 */

import { rsi, sma } from '../signals/indicators';
import { scoreToConfidence } from '../signals/score';
import { spendable, equalWeightQty } from '../engine/sizing';
import type { Strategy, SleeveContext, StrategyIntent, OpenPositionLite } from './types';
import { posKey, daysBetween } from './types';

export const meanReversionStrategy: Strategy = {
  key: 'MEAN_REVERSION',
  run(ctx: SleeveContext): StrategyIntent[] {
    const p = ctx.params;
    const rsiBuy = p.rsi2Buy ?? 10;
    const rsiSell = p.rsi2Sell ?? 70;
    const maxHold = p.maxHoldDays ?? 3;
    const maxPos = p.maxPositions ?? 8;
    const perPct = p.perPositionPct ?? 12;
    const bufferPct = p.cashBufferPct ?? 10;
    const alloc = ctx.sleeve.allocationPaisa;
    const buffer = Math.round((bufferPct / 100) * alloc);
    const perSlot = Math.round((perPct / 100) * alloc);
    const regimeOk = ctx.regimeRiskOn !== false; // #5 only dip-buy when index regime is risk-on

    const held = new Map<string, OpenPositionLite>();
    for (const pos of ctx.positions) held.set(posKey(pos.assetClass, pos.symbol, pos.schemeCode), pos);
    let openCount = ctx.positions.length;
    let cash = ctx.cashPaisa;
    const out: StrategyIntent[] = [];

    for (const inst of ctx.instruments) {
      const closes = inst.history.map((h) => h.closePaisa);
      const last = inst.quote.lastPricePaisa;
      const rsi2 = rsi(closes, 2);
      const sma200 = sma(closes, 200);
      const sma5 = sma(closes, 5);
      const key = posKey(inst.assetClass, inst.symbol, inst.schemeCode);
      const pos = held.get(key);
      const inputs: Record<string, number | string> = {
        rsi2: rsi2 ?? -1,
        closePaisa: last,
        sma200Paisa: sma200 ?? -1,
        sma5Paisa: sma5 ?? -1,
      };
      const signals = { rsi2: rsi2 ?? undefined, sma5Paisa: sma5 ?? undefined, sma200Paisa: sma200 ?? undefined };
      const common = {
        watchlistId: inst.watchlistId,
        assetClass: inst.assetClass,
        symbol: inst.symbol,
        schemeCode: inst.schemeCode,
        name: inst.name,
        contractMultiplier: inst.contractMultiplier,
        side: 'LONG' as const,
        pricePaisa: last,
        signals,
      };

      // EXIT: bounce (RSI back up / above 5SMA) or time stop.
      if (pos) {
        const heldDays = daysBetween(ctx.runDate, pos.openedDate);
        const bounce = (rsi2 != null && rsi2 > rsiSell) || (sma5 != null && last > sma5);
        const timeUp = heldDays >= maxHold;
        if (bounce || timeUp) {
          const rule = timeUp ? `held ${heldDays}d ≥ max ${maxHold}d` : `RSI(2) ${rsi2?.toFixed(1)} > ${rsiSell} or close>5SMA`;
          const amount = Math.round(last * pos.quantity * inst.contractMultiplier);
          out.push({ ...common, action: 'SELL', score: -50, recommendation: 'SELL', confidence: 'MEDIUM',
            quantity: pos.quantity, amountPaisa: amount,
            evidence: { rule, inputs, thresholds: { rsi2Sell: rsiSell, maxHoldDays: maxHold }, source: inst.source, dataAsOf: inst.history.at(-1)?.date } });
          cash += amount; openCount -= 1;
          continue;
        }
        out.push({ ...common, action: 'HOLD', score: 0, recommendation: 'HOLD', confidence: 'LOW', quantity: 0, amountPaisa: 0,
          evidence: { rule: 'in position, no exit trigger', inputs, source: inst.source, dataAsOf: inst.history.at(-1)?.date } });
        continue;
      }

      // ENTRY: oversold dip in an uptrend.
      const canBuy = rsi2 != null && sma200 != null && last > sma200 && rsi2 < rsiBuy && regimeOk;
      if (canBuy && openCount < maxPos) {
        const budget = Math.min(perSlot, spendable(cash, buffer));
        const qty = equalWeightQty(budget, last, inst.contractMultiplier, { fractional: false });
        if (qty > 0) {
          const amount = Math.round(last * qty * inst.contractMultiplier);
          const score = 40;
          out.push({ ...common, action: 'BUY', score, recommendation: 'BUY', confidence: scoreToConfidence(score),
            quantity: qty, amountPaisa: amount,
            evidence: { rule: `RSI(2) ${rsi2!.toFixed(1)} < ${rsiBuy} & close>200SMA`, inputs,
              thresholds: { rsi2Buy: rsiBuy }, sizing: { qty, perSlotPaisa: perSlot, priceUsedPaisa: last }, source: inst.source, dataAsOf: inst.history.at(-1)?.date } });
          cash -= amount; openCount += 1;
          continue;
        }
      }
      out.push({ ...common, action: 'WATCH', score: 0, recommendation: 'HOLD', confidence: 'LOW', quantity: 0, amountPaisa: 0,
        evidence: { rule: canBuy ? 'signal but no room/cash' : 'no oversold-in-uptrend setup', inputs, thresholds: { rsi2Buy: rsiBuy }, source: inst.source, dataAsOf: inst.history.at(-1)?.date } });
    }
    return out;
  },
};
