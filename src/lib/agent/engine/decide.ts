/**
 * Decision logic — turns per-instrument signals into BUY/SELL/HOLD/WATCH
 * intents against the virtual portfolio. Pure (no DB/IO). Money in paisa.
 *
 * Rules:
 *  - SELL: held + recommendation SELL → close the whole position.
 *  - BUY:  not held + recommendation BUY + cash available + under maxPositions.
 *          Budget per new position = startingCapital × perPositionPct, capped by
 *          (cash − cashBuffer). Stocks/futures buy whole units; MF buys fractional.
 *  - else HOLD (held) / WATCH (not held).
 */

import type { AgentAction, AgentAssetClass, AgentRecommendation, AgentSide } from '@/db/schema';

export interface DecisionInputItem {
  assetClass: AgentAssetClass;
  symbol: string;
  schemeCode: string;
  name: string;
  contractMultiplier: number;
  signalId: number | null;
  score: number;
  recommendation: AgentRecommendation;
  confidence: string;
  lastPricePaisa: number;
}

export interface OpenPositionLite {
  assetClass: AgentAssetClass;
  symbol: string;
  schemeCode: string;
  quantity: number;
}

export interface PortfolioSettings {
  startingCapitalPaisa: number;
  maxPositions: number;
  perPositionPct: number;
  cashBufferPct: number;
}

export interface DecisionIntent {
  action: AgentAction;
  assetClass: AgentAssetClass;
  symbol: string;
  schemeCode: string;
  name: string;
  side: AgentSide;
  contractMultiplier: number;
  signalId: number | null;
  score: number;
  confidence: string;
  quantity: number;       // 0 for HOLD/WATCH
  pricePaisa: number;
  amountPaisa: number;    // notional of the trade leg (0 for HOLD/WATCH)
}

const posKey = (assetClass: string, symbol: string, schemeCode: string) =>
  assetClass === 'MF' ? `MF:${schemeCode}` : `${assetClass}:${symbol}`;

export function decide(
  settings: PortfolioSettings,
  cashPaisa: number,
  positions: OpenPositionLite[],
  items: DecisionInputItem[],
): DecisionIntent[] {
  const held = new Map<string, OpenPositionLite>();
  for (const p of positions) held.set(posKey(p.assetClass, p.symbol, p.schemeCode), p);

  let openCount = positions.length;
  let cash = cashPaisa;
  const buffer = Math.round((settings.cashBufferPct / 100) * settings.startingCapitalPaisa);
  const perPositionBudget = Math.round((settings.perPositionPct / 100) * settings.startingCapitalPaisa);

  const intents: DecisionIntent[] = [];

  for (const it of items) {
    const key = posKey(it.assetClass, it.symbol, it.schemeCode);
    const position = held.get(key);
    const base = {
      assetClass: it.assetClass,
      symbol: it.symbol,
      schemeCode: it.schemeCode,
      name: it.name,
      contractMultiplier: it.contractMultiplier,
      signalId: it.signalId,
      score: it.score,
      confidence: it.confidence,
      pricePaisa: it.lastPricePaisa,
    };

    // SELL: close an existing long when the signal turns bearish.
    if (position && it.recommendation === 'SELL') {
      const amount = Math.round(it.lastPricePaisa * position.quantity * it.contractMultiplier);
      intents.push({ ...base, action: 'SELL', side: 'LONG', quantity: position.quantity, amountPaisa: amount });
      cash += amount;
      openCount -= 1;
      continue;
    }

    // BUY: open a new long when bullish, not already held, room + cash exist.
    if (!position && it.recommendation === 'BUY' && it.lastPricePaisa > 0) {
      if (openCount >= settings.maxPositions) {
        intents.push({ ...base, action: 'WATCH', side: 'LONG', quantity: 0, amountPaisa: 0 });
        continue;
      }
      const spendable = Math.min(perPositionBudget, Math.max(0, cash - buffer));
      const unitCostPaisa = Math.round(it.lastPricePaisa * it.contractMultiplier);
      if (spendable <= 0 || unitCostPaisa <= 0) {
        intents.push({ ...base, action: 'WATCH', side: 'LONG', quantity: 0, amountPaisa: 0 });
        continue;
      }
      // MF buys fractional units; stocks/futures buy whole units/lots.
      const qty = it.assetClass === 'MF'
        ? Math.floor((spendable / unitCostPaisa) * 1000) / 1000
        : Math.floor(spendable / unitCostPaisa);
      if (qty <= 0) {
        intents.push({ ...base, action: 'WATCH', side: 'LONG', quantity: 0, amountPaisa: 0 });
        continue;
      }
      const amount = Math.round(it.lastPricePaisa * qty * it.contractMultiplier);
      intents.push({ ...base, action: 'BUY', side: 'LONG', quantity: qty, amountPaisa: amount });
      cash -= amount;
      openCount += 1;
      continue;
    }

    // Otherwise: HOLD if held, WATCH if not.
    intents.push({
      ...base,
      action: position ? 'HOLD' : 'WATCH',
      side: 'LONG',
      quantity: 0,
      amountPaisa: 0,
    });
  }

  return intents;
}
