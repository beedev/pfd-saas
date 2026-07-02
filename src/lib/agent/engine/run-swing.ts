/**
 * Swing funnel engine — the conviction layer fed by the intraday discovery layer.
 * LONG-ONLY: cash-equity shorts can't be held overnight in India, so multi-day
 * holds are long only (a bearish view is an intraday short or a futures short,
 * not an equity swing). Two entry styles coexist in the 2-3 day (SHORT) bucket:
 *
 *   • Catalyst hold — a bullish catalyst (high-impact brief + TRUSTED news-signal
 *     phrases, ∩ Nifty 500) → hold toward a % target with an ATR stop-loss.
 *   • Mean-reversion dip (Connors RSI-2) — RSI(2) oversold in an uptrend on the
 *     watchlist → hold with NO tight stop (stops hurt mean-reversion), exit on
 *     bounce (RSI back up / close > 5-SMA) or a time stop.
 *
 * Exit branches on whether the position carries a stop: stop-set = catalyst
 * (target/stop/max-hold), stop-null = mean-reversion (bounce/time). Multi-day —
 * NEVER a same-day square-off; exits pay delivery cost + STCG. The 2-3 month
 * (LONG) bucket is catalyst-only. Only acts while the market is open. Paisa.
 */

import { and, eq, inArray } from 'drizzle-orm';
import {
  db, agentTrades, agentPositions, agentNewsSignalTags, agentWatchlist,
  type AgentSleeve, type AgentBriefBias,
} from '@/db';
import { getQuotes, getDailyOHLC, type DailyBar } from '@/lib/services/yahoo-finance';
import { atr, rsi, sma } from '../signals/indicators';
import { NIFTY_500 } from '../universe/nifty500';
import { getTodayBrief } from '../news/brief';
import { getTrustedPhrases } from '../signal/dictionary';
import { sizeQty, persistOpen, persistClose, saveCash, type OpenPositionLite } from './intraday-core';
import { MIN_NOTIONAL_PCT } from './orb-step';
import type { SleeveRunResult } from './run-sleeve';

const NIFTY500 = new Set<string>(NIFTY_500);
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);

interface HorizonParams {
  maxHoldDays: number; targetPct: number; stopAtr: number; riskPctPerTrade: number; maxPositions: number;
  impactMin: number; rsi2Buy: number; rsi2Sell: number; meanReversion: boolean;
}
const HORIZON: Record<'SHORT' | 'LONG', HorizonParams> = {
  SHORT: { maxHoldDays: 3, targetPct: 4, stopAtr: 1.5, riskPctPerTrade: 1.0, maxPositions: 5, impactMin: 0.4, rsi2Buy: 10, rsi2Sell: 70, meanReversion: true },
  LONG: { maxHoldDays: 45, targetPct: 12, stopAtr: 2.5, riskPctPerTrade: 1.0, maxPositions: 6, impactMin: 0.6, rsi2Buy: 10, rsi2Sell: 70, meanReversion: false },
};

export async function runSwing(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string,
  opts: { marketOpen: boolean; horizon: 'SHORT' | 'LONG'; candidatesOverride?: Catalyst[] },
): Promise<SleeveRunResult> {
  const p = { ...HORIZON[opts.horizon], ...((sleeve.paramsJson as Record<string, number>) ?? {}) };
  const today = istDate();

  const positions = await db.select().from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));
  let cash = sleeve.cashBalancePaisa;
  let openCount = positions.length;
  let grossDeployed = positions.reduce((a, x) => a + Math.round(x.avgPricePaisa * x.quantity * x.contractMultiplier), 0);
  let quotes = 0, decisions = 0, trades = 0;

  // Overnight/closed: hold — swing positions are multi-day, no square-off.
  if (!opts.marketOpen) return { sleeveKey: sleeve.key, quotesFetched: 0, decisions: 0, tradesExecuted: 0, cashBalancePaisa: cash };

  const ohlcCache = new Map<string, DailyBar[]>();
  const getOhlc = async (sym: string): Promise<DailyBar[]> => {
    if (!ohlcCache.has(sym)) ohlcCache.set(sym, await getDailyOHLC(sym, '1y'));
    return ohlcCache.get(sym)!;
  };

  // ---- 1. Manage holds — exit branches on entry style (stop set = catalyst) ----
  const heldSymbols = positions.map((x) => x.symbol);
  const priceMap = new Map<string, number>();
  if (heldSymbols.length) {
    const qs = await getQuotes(heldSymbols);
    for (const q of qs) if (Number.isFinite(q.regularMarketPrice)) priceMap.set(q.symbol, Math.round(q.regularMarketPrice * 100));
  }
  for (const existing of positions) {
    const lastPx = priceMap.get(existing.symbol);
    if (lastPx == null) continue;
    const heldDays = Math.max(1, daysBetween(existing.openedDate, today));
    const maxHold = heldDays >= p.maxHoldDays;
    let exit = false, reason = '';
    if (existing.stopPaisa != null) {
      // Catalyst hold: target / stop / max-hold.
      const long = existing.side === 'LONG';
      const hitStop = long ? lastPx <= existing.stopPaisa : lastPx >= existing.stopPaisa;
      const hitTarget = existing.targetPaisa != null && (long ? lastPx >= existing.targetPaisa : lastPx <= existing.targetPaisa);
      if (hitStop || hitTarget || maxHold) { exit = true; reason = hitStop ? 'stop hit' : hitTarget ? 'target hit' : `max hold ${p.maxHoldDays}d`; }
    } else {
      // Mean-reversion: exit on bounce (RSI back up / close > 5-SMA) or time stop.
      const closes = (await getOhlc(existing.symbol)).map((b) => Math.round(b.close * 100));
      const rsi2 = rsi(closes, 2), sma5 = sma(closes, 5);
      const bounce = (rsi2 != null && rsi2 > p.rsi2Sell) || (sma5 != null && lastPx > sma5);
      if (bounce || maxHold) { exit = true; reason = maxHold ? `held ${heldDays}d ≥ ${p.maxHoldDays}` : `RSI(2) bounce / close>5-SMA`; }
    }
    if (!exit) continue;
    const pos: OpenPositionLite = {
      id: existing.id, symbol: existing.symbol, side: existing.side, quantity: existing.quantity,
      contractMultiplier: existing.contractMultiplier, avgPricePaisa: existing.avgPricePaisa,
      stopPaisa: existing.stopPaisa, targetPaisa: existing.targetPaisa, openedDate: existing.openedDate,
    };
    cash = await persistClose(userId, sleeve, runId, runDate, pos, existing.name, lastPx, reason, today, cash, heldDays);
    openCount--; grossDeployed -= Math.round(existing.avgPricePaisa * existing.quantity * existing.contractMultiplier);
    decisions++; trades++;
  }

  const held = new Set(heldSymbols);
  const tradedRows = await db.select({ symbol: agentTrades.symbol }).from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.tradeDate, runDate)));
  const tradedToday = new Set(tradedRows.map((r) => r.symbol));
  const skip = (sym: string) => held.has(sym) || tradedToday.has(sym);

  // ---- 2. Catalyst entries — LONG-ONLY (bullish catalysts), ATR stop + target ----
  if (openCount < p.maxPositions) {
    const catalysts = opts.candidatesOverride ?? await gatherCatalysts(opts.horizon, p.impactMin, today);
    for (const c of catalysts) {
      if (openCount >= p.maxPositions) break;
      if (c.direction !== 'BULLISH' || skip(c.symbol)) continue;   // long-only: no overnight equity shorts
      const ohlc = await getOhlc(c.symbol);
      if (ohlc.length < 16) continue;
      quotes++;
      const a = atr(ohlc.map((b) => ({ high: b.high, low: b.low, close: b.close })), 14);
      if (a == null || a <= 0) continue;
      const entry = Math.round(ohlc[ohlc.length - 1].close * 100);
      const atrP = Math.round(a * 100);
      const stop = entry - Math.round(p.stopAtr * atrP);
      const target = entry + Math.round((entry * p.targetPct) / 100);
      const qty = sizeQty(entry, stop, 'LONG', { allocationPaisa: sleeve.allocationPaisa, cashBalancePaisa: cash, grossDeployedPaisa: grossDeployed, riskPctPerTrade: p.riskPctPerTrade });
      if (qty < 1) continue;
      const rationale = `${opts.horizon === 'LONG' ? '2-3mo' : '2-3d'} catalyst (${c.source}) → LONG ${c.symbol} @ ₹${(entry / 100).toFixed(2)}; target ₹${(target / 100).toFixed(2)} (+${p.targetPct}%), stop ₹${(stop / 100).toFixed(2)}.`;
      cash = await persistOpen(userId, sleeve, runId, runDate, {
        symbol: c.symbol, name: c.symbol, side: 'LONG', entryPaisa: entry, stopPaisa: stop, targetPaisa: target, qty, rationale,
        evidence: { rule: `swing catalyst (${c.source})`, inputs: { entryPaisa: entry, atr: +a.toFixed(2), targetPct: p.targetPct }, thresholds: { stopPaisa: stop, targetPaisa: target }, source: 'YAHOO', dataAsOf: today },
      }, cash);
      grossDeployed += entry * qty; openCount++; held.add(c.symbol); decisions++; trades++;
    }
  }

  // ---- 3. Mean-reversion dip entries (SHORT bucket only) — RSI-2 oversold, NO stop ----
  if (p.meanReversion && openCount < p.maxPositions) {
    const wl = await db.select({ symbol: agentWatchlist.symbol }).from(agentWatchlist)
      .where(and(eq(agentWatchlist.sleeveId, sleeve.id), eq(agentWatchlist.enabled, true)));
    const perSlot = Math.round(sleeve.allocationPaisa / p.maxPositions);
    const perNameCap = Math.round(sleeve.allocationPaisa * 0.30);
    const minNotional = Math.round((sleeve.allocationPaisa * MIN_NOTIONAL_PCT) / 100);
    for (const w of wl) {
      if (openCount >= p.maxPositions) break;
      if (!w.symbol || skip(w.symbol)) continue;
      const closes = (await getOhlc(w.symbol)).map((b) => Math.round(b.close * 100));
      const rsi2 = rsi(closes, 2), sma200 = sma(closes, 200);
      const last = closes[closes.length - 1];
      if (rsi2 == null || sma200 == null || !(last > sma200) || !(rsi2 < p.rsi2Buy)) continue;
      quotes++;
      // Equal-weight sizing (no stop → can't risk-size); capped by slot/cash/gross/name.
      const budget = Math.min(perSlot, perNameCap, sleeve.allocationPaisa - grossDeployed, cash);
      const qty = Math.floor(budget / last);
      if (qty < 1 || last * qty < minNotional) continue;
      const rationale = `2-3d mean-reversion → LONG ${w.symbol} @ ₹${(last / 100).toFixed(2)} — RSI(2) ${rsi2.toFixed(1)} < ${p.rsi2Buy} in uptrend; no stop, exit on bounce / ${p.maxHoldDays}d.`;
      cash = await persistOpen(userId, sleeve, runId, runDate, {
        symbol: w.symbol, name: w.symbol, side: 'LONG', entryPaisa: last, stopPaisa: null, targetPaisa: null, qty, rationale,
        evidence: { rule: 'swing mean-reversion (RSI-2)', inputs: { rsi2: +rsi2.toFixed(1), sma200Paisa: sma200, closePaisa: last }, source: 'YAHOO', dataAsOf: today },
      }, cash);
      grossDeployed += last * qty; openCount++; held.add(w.symbol); decisions++; trades++;
    }
  }

  await saveCash(sleeve.id, cash);
  return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash };
}

export interface Catalyst { symbol: string; direction: AgentBriefBias; source: string }

/** Today's BULLISH catalysts for a horizon: high-impact brief (routed by impact) + (SHORT) trusted news signals, ∩ Nifty 500. Long-only. */
async function gatherCatalysts(horizon: 'SHORT' | 'LONG', impactMin: number, today: string): Promise<Catalyst[]> {
  const bySymbol = new Map<string, Catalyst>();
  const brief = await getTodayBrief().catch(() => []);
  for (const b of brief) {
    if (b.bias !== 'BULLISH' || !NIFTY500.has(b.symbol)) continue;   // long-only
    const impact = b.impact ?? 0;
    if (impact < impactMin) continue;
    const isLong = impact >= HORIZON.LONG.impactMin;
    if ((horizon === 'LONG') !== isLong) continue;
    if (!bySymbol.has(b.symbol)) bySymbol.set(b.symbol, { symbol: b.symbol, direction: 'BULLISH', source: 'brief' });
  }
  if (horizon === 'SHORT') {
    const trusted = await getTrustedPhrases();
    if (trusted.length) {
      const tags = await db.select({ symbol: agentNewsSignalTags.symbol, direction: agentNewsSignalTags.direction })
        .from(agentNewsSignalTags)
        .where(and(eq(agentNewsSignalTags.taggedDate, today), inArray(agentNewsSignalTags.phraseId, trusted.map((t) => t.id))));
      for (const t of tags) if (t.direction === 'BULLISH' && NIFTY500.has(t.symbol) && !bySymbol.has(t.symbol)) bySymbol.set(t.symbol, { symbol: t.symbol, direction: 'BULLISH', source: 'signal' });
    }
  }
  return [...bySymbol.values()].slice(0, 10);
}
