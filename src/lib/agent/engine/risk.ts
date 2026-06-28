/**
 * Portfolio-level loss mitigation, applied to a strategy's intents before
 * execution (same code in live + backtest):
 *   1. Drawdown kill-switch — halt NEW buys once sleeve drawdown ≥ killSwitchPct.
 *   2. Hard stop-loss — force-SELL a position that has fallen ≥ stopLossPct from
 *      its average cost (catastrophic-loss cap; mean-reversion uses a wide one so
 *      normal noise isn't stopped — Kaminski-Lo).
 *   3. Correlation/exposure guard — block a BUY that is ≥ corrMax correlated with
 *      something already held (avoids stacking the same bet).
 * All money in paisa. Defaults are per-strategy.
 */

import type { AgentStrategy } from '@/db';
import type { SleeveContext, StrategyIntent, OpenPositionLite, InstrumentInput } from '../strategies/types';
import { posKey } from '../strategies/types';

function defaultStopPct(strategy: AgentStrategy): number {
  switch (strategy) {
    case 'MEAN_REVERSION': return 10; // wide/catastrophic only
    case 'XS_MOMENTUM': return 15;
    case 'TREND': return 18;
    default: return 0;                 // RS_ROTATION: no hard stop on funds
  }
}

function dailyReturns(closes: number[], n: number): number[] {
  const s = closes.slice(-n - 1);
  const r: number[] = [];
  for (let i = 1; i < s.length; i++) if (s[i - 1] > 0) r.push((s[i] - s[i - 1]) / s[i - 1]);
  return r;
}
function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 30) return 0;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a1 = x[i] - mx, b1 = y[i] - my; num += a1 * b1; dx += a1 * a1; dy += b1 * b1; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

export function applyRiskControls(ctx: SleeveContext, intents: StrategyIntent[]): StrategyIntent[] {
  const p = ctx.params;
  const stopPct = (p.stopLossPct ?? defaultStopPct(ctx.sleeve.strategy)) / 100;
  const killPct = (p.killSwitchPct ?? 20) / 100;
  const corrMax = p.corrMax ?? 0.9;

  const held = new Map<string, OpenPositionLite>();
  for (const pos of ctx.positions) held.set(posKey(pos.assetClass, pos.symbol, pos.schemeCode), pos);
  const instByKey = new Map<string, InstrumentInput>();
  for (const i of ctx.instruments) instByKey.set(posKey(i.assetClass, i.symbol, i.schemeCode), i);

  // Drawdown kill-switch.
  const peak = ctx.peakEquityPaisa ?? 0;
  const cur = ctx.currentEquityPaisa ?? 0;
  const dd = peak > 0 ? (peak - cur) / peak : 0;
  const halted = dd >= killPct && killPct > 0;

  // Returns of currently-held names (for the correlation guard).
  const heldReturns: number[][] = ctx.positions.map((pos) => {
    const inst = instByKey.get(posKey(pos.assetClass, pos.symbol, pos.schemeCode));
    return inst ? dailyReturns(inst.history.map((h) => h.closePaisa), 120) : [];
  }).filter((r) => r.length >= 30);

  return intents.map((it) => {
    const key = posKey(it.assetClass, it.symbol, it.schemeCode);
    const pos = held.get(key);

    // 2. Hard stop-loss — force a SELL if a held position breached the stop.
    if (pos && stopPct > 0 && it.action !== 'SELL') {
      const last = instByKey.get(key)?.quote.lastPricePaisa ?? it.pricePaisa;
      if (last <= pos.avgPricePaisa * (1 - stopPct)) {
        const amount = Math.round(last * pos.quantity * pos.contractMultiplier);
        return { ...it, action: 'SELL', side: pos.side, quantity: pos.quantity, pricePaisa: last, amountPaisa: amount,
          evidence: { ...it.evidence, rule: `hard stop −${(stopPct * 100).toFixed(0)}% (avg ${pos.avgPricePaisa}, last ${last})` } };
      }
    }

    if (it.action === 'BUY') {
      // 1. Kill-switch — no new buys while sleeve is in deep drawdown.
      if (halted) {
        return { ...it, action: 'WATCH', quantity: 0, amountPaisa: 0,
          evidence: { ...it.evidence, rule: `kill-switch: sleeve drawdown ${(dd * 100).toFixed(1)}% ≥ ${(killPct * 100).toFixed(0)}%` } };
      }
      // 3. Correlation guard — don't stack a near-duplicate of an existing holding.
      const inst = instByKey.get(key);
      if (inst && heldReturns.length) {
        const cand = dailyReturns(inst.history.map((h) => h.closePaisa), 120);
        const maxC = heldReturns.reduce((m, hr) => Math.max(m, Math.abs(corr(cand, hr))), 0);
        if (maxC >= corrMax) {
          return { ...it, action: 'WATCH', quantity: 0, amountPaisa: 0,
            evidence: { ...it.evidence, rule: `corr guard: ${maxC.toFixed(2)} ≥ ${corrMax} with a holding` } };
        }
      }
    }
    return it;
  });
}
