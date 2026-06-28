/**
 * Trend-following (Donchian breakout) — the futures sleeve. Long-only in v2.1:
 * enter on an N-day high breakout, exit on an M-day low; risk-based sizing off
 * an ATR proxy. Stops HELP here (Kaminski-Lo), so we exit on the channel break.
 */

import { donchianHigh, donchianLow, atrProxy } from '../signals/indicators';
import { scoreToConfidence } from '../signals/score';
import { spendable, riskBasedQty } from '../engine/sizing';
import type { Strategy, SleeveContext, StrategyIntent, OpenPositionLite } from './types';
import { posKey } from './types';

export const trendStrategy: Strategy = {
  key: 'TREND',
  run(ctx: SleeveContext): StrategyIntent[] {
    const p = ctx.params;
    const entryN = p.entryDonchian ?? 20;
    const exitN = p.exitDonchian ?? 10;
    const atrN = p.atrPeriod ?? 14;
    const atrStopMult = p.atrStopMult ?? 2;
    const riskPct = p.riskPct ?? 1.5;
    const maxPos = p.maxPositions ?? 6;
    const bufferPct = p.cashBufferPct ?? 10;
    const alloc = ctx.sleeve.allocationPaisa;
    const buffer = Math.round((bufferPct / 100) * alloc);
    const riskPaisa = Math.round((riskPct / 100) * alloc);

    const held = new Map<string, OpenPositionLite>();
    for (const pos of ctx.positions) held.set(posKey(pos.assetClass, pos.symbol, pos.schemeCode), pos);
    let openCount = ctx.positions.length;
    let cash = ctx.cashPaisa;
    const out: StrategyIntent[] = [];

    for (const inst of ctx.instruments) {
      // Use closes up to the prior bar for the channel (don't include today's close in its own high).
      const closes = inst.history.map((h) => h.closePaisa);
      const prior = closes.slice(0, -1);
      const last = inst.quote.lastPricePaisa;
      const dHighEntry = donchianHigh(prior, entryN);
      const dLowExit = donchianLow(prior, exitN);
      const atr = atrProxy(closes, atrN);
      const key = posKey(inst.assetClass, inst.symbol, inst.schemeCode);
      const pos = held.get(key);
      const inputs: Record<string, number | string> = { closePaisa: last, donchianHighPaisa: dHighEntry ?? -1, donchianLowPaisa: dLowExit ?? -1, atrProxyPaisa: atr ?? -1 };
      const signals = { donchianHighPaisa: dHighEntry ?? undefined, donchianLowPaisa: dLowExit ?? undefined, atrProxyPaisa: atr ?? undefined };
      const common = { watchlistId: inst.watchlistId, assetClass: inst.assetClass, symbol: inst.symbol, schemeCode: inst.schemeCode, name: inst.name, contractMultiplier: inst.contractMultiplier, side: 'LONG' as const, pricePaisa: last, signals };
      const asOf = inst.history.at(-1)?.date;

      if (pos) {
        if (dLowExit != null && last <= dLowExit) {
          const amount = Math.round(last * pos.quantity * inst.contractMultiplier);
          out.push({ ...common, action: 'SELL', score: -40, recommendation: 'SELL', confidence: 'MEDIUM', quantity: pos.quantity, amountPaisa: amount,
            evidence: { rule: `close ≤ ${exitN}-day low (trend exit)`, inputs, source: inst.source, dataAsOf: asOf } });
          cash += amount; openCount -= 1; continue;
        }
        out.push({ ...common, action: 'HOLD', score: 20, recommendation: 'HOLD', confidence: 'LOW', quantity: 0, amountPaisa: 0,
          evidence: { rule: 'trend intact, above exit channel', inputs, source: inst.source, dataAsOf: asOf } });
        continue;
      }

      const breakout = dHighEntry != null && last >= dHighEntry;
      if (breakout && atr != null && atr > 0 && openCount < maxPos) {
        const stopDist = Math.round(atrStopMult * atr);
        const qty = riskBasedQty(riskPaisa, stopDist, last, inst.contractMultiplier, spendable(cash, buffer));
        if (qty > 0) {
          const amount = Math.round(last * qty * inst.contractMultiplier);
          const score = 45;
          out.push({ ...common, action: 'BUY', score, recommendation: 'BUY', confidence: scoreToConfidence(score), quantity: qty, amountPaisa: amount,
            evidence: { rule: `close ≥ ${entryN}-day high (breakout)`, inputs, sizing: { qty, riskPaisa, stopDistPaisa: stopDist, priceUsedPaisa: last }, source: inst.source, dataAsOf: asOf } });
          cash -= amount; openCount += 1; continue;
        }
      }
      out.push({ ...common, action: 'WATCH', score: 0, recommendation: 'HOLD', confidence: 'LOW', quantity: 0, amountPaisa: 0,
        evidence: { rule: breakout ? 'breakout but no room/cash/ATR' : `below ${entryN}-day high, no breakout`, inputs, source: inst.source, dataAsOf: asOf } });
    }
    return out;
  },
};
