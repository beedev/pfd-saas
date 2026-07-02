/**
 * Swing funnel engine — the conviction layer fed by the intraday discovery layer.
 * A stock graduates from the day's catalysts (high-impact pre-market brief +
 * TRUSTED news-signal phrases, filtered to Nifty 500) into a MULTI-DAY hold with:
 *   • direction from the catalyst,
 *   • a price target (default % by horizon; learned per-signal move later),
 *   • an ATR stop-loss floor ("don't lose big"),
 *   • exit on target / stop / max-hold (NEVER a same-day square-off — these are
 *     delivery holds, so exits pay delivery cost + STCG).
 * Horizon routes the bucket: SHORT = 2-3 day momentum drift, LONG = 2-3 month
 * higher-conviction holds. Only acts while the market is open; overnight the
 * position simply holds. Paisa.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, agentTrades, agentPositions, agentNewsSignalTags, type AgentSleeve, type AgentBriefBias } from '@/db';
import { getQuotes, getDailyOHLC } from '@/lib/services/yahoo-finance';
import { atr } from '../signals/indicators';
import { NIFTY_500 } from '../universe/nifty500';
import { getTodayBrief } from '../news/brief';
import { getTrustedPhrases } from '../signal/dictionary';
import { sizeQty, persistOpen, persistClose, saveCash, type OpenPositionLite } from './intraday-core';
import type { SleeveRunResult } from './run-sleeve';

const NIFTY500 = new Set<string>(NIFTY_500);
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);

interface HorizonParams { maxHoldDays: number; targetPct: number; stopAtr: number; riskPctPerTrade: number; maxPositions: number; impactMin: number; }
const HORIZON: Record<'SHORT' | 'LONG', HorizonParams> = {
  SHORT: { maxHoldDays: 3, targetPct: 4, stopAtr: 1.5, riskPctPerTrade: 1.0, maxPositions: 5, impactMin: 0.4 },
  LONG: { maxHoldDays: 45, targetPct: 12, stopAtr: 2.5, riskPctPerTrade: 1.0, maxPositions: 6, impactMin: 0.6 },
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

  // ---- 1. Manage holds — exit on target / stop / max-hold (delivery cost) ----
  const heldSymbols = positions.map((x) => x.symbol);
  const priceMap = new Map<string, number>();
  if (heldSymbols.length) {
    const qs = await getQuotes(heldSymbols);
    for (const q of qs) if (Number.isFinite(q.regularMarketPrice)) priceMap.set(q.symbol, Math.round(q.regularMarketPrice * 100));
  }
  for (const existing of positions) {
    const lastPx = priceMap.get(existing.symbol);
    if (lastPx == null) continue;
    const long = existing.side === 'LONG';
    const heldDays = Math.max(1, daysBetween(existing.openedDate, today));
    const hitStop = existing.stopPaisa != null && (long ? lastPx <= existing.stopPaisa : lastPx >= existing.stopPaisa);
    const hitTarget = existing.targetPaisa != null && (long ? lastPx >= existing.targetPaisa : lastPx <= existing.targetPaisa);
    const maxHold = heldDays >= p.maxHoldDays;
    if (!hitStop && !hitTarget && !maxHold) continue;
    const reason = hitStop ? 'stop hit' : hitTarget ? 'target hit' : `max hold ${p.maxHoldDays}d`;
    const pos: OpenPositionLite = {
      id: existing.id, symbol: existing.symbol, side: existing.side, quantity: existing.quantity,
      contractMultiplier: existing.contractMultiplier, avgPricePaisa: existing.avgPricePaisa,
      stopPaisa: existing.stopPaisa, targetPaisa: existing.targetPaisa, openedDate: existing.openedDate,
    };
    cash = await persistClose(userId, sleeve, runId, runDate, pos, existing.name, lastPx, reason, today, cash, heldDays);
    openCount--; grossDeployed -= Math.round(existing.avgPricePaisa * existing.quantity * existing.contractMultiplier);
    decisions++; trades++;
  }

  // ---- 2. Entries — the funnel: today's catalysts, one per symbol per day ----
  if (openCount >= p.maxPositions) { await saveCash(sleeve.id, cash); return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash }; }

  const catalysts = opts.candidatesOverride ?? await gatherCatalysts(opts.horizon, p.impactMin, today);
  const held = new Set(heldSymbols);
  const tradedRows = await db.select({ symbol: agentTrades.symbol }).from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.tradeDate, runDate)));
  const tradedToday = new Set(tradedRows.map((r) => r.symbol));

  for (const c of catalysts) {
    if (openCount >= p.maxPositions) break;
    if (held.has(c.symbol) || tradedToday.has(c.symbol)) continue;
    const ohlc = await getDailyOHLC(c.symbol, '3mo');
    if (ohlc.length < 16) continue;
    quotes++;
    const a = atr(ohlc.map((b) => ({ high: b.high, low: b.low, close: b.close })), 14);
    if (a == null || a <= 0) continue;
    const entry = Math.round(ohlc[ohlc.length - 1].close * 100);
    const side = c.direction === 'BULLISH' ? 'LONG' : 'SHORT';
    const atrP = Math.round(a * 100);
    const stop = side === 'LONG' ? entry - Math.round(p.stopAtr * atrP) : entry + Math.round(p.stopAtr * atrP);
    const target = side === 'LONG' ? entry + Math.round((entry * p.targetPct) / 100) : entry - Math.round((entry * p.targetPct) / 100);
    const qty = sizeQty(entry, stop, side, { allocationPaisa: sleeve.allocationPaisa, cashBalancePaisa: cash, grossDeployedPaisa: grossDeployed, riskPctPerTrade: p.riskPctPerTrade });
    if (qty < 1) continue;
    const rationale = `${opts.horizon === 'LONG' ? '2-3mo' : '2-3d'} catalyst (${c.source}, ${c.direction}) → ${side} ${c.symbol} @ ₹${(entry / 100).toFixed(2)}; target ₹${(target / 100).toFixed(2)} (+${p.targetPct}%), stop ₹${(stop / 100).toFixed(2)}.`;
    cash = await persistOpen(userId, sleeve, runId, runDate, {
      symbol: c.symbol, name: c.symbol, side, entryPaisa: entry, stopPaisa: stop, targetPaisa: target, qty, rationale,
      evidence: { rule: `swing catalyst (${c.source})`, inputs: { direction: c.direction, entryPaisa: entry, atr: +a.toFixed(2), targetPct: p.targetPct }, thresholds: { stopPaisa: stop, targetPaisa: target }, source: 'YAHOO', dataAsOf: today },
    }, cash);
    grossDeployed += entry * qty; openCount++; decisions++; trades++;
  }

  await saveCash(sleeve.id, cash);
  return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash };
}

interface Catalyst { symbol: string; direction: AgentBriefBias; source: string }

/** Today's catalysts for a horizon: high-impact brief (routed by impact) + (SHORT) trusted news signals, ∩ Nifty 500. */
async function gatherCatalysts(horizon: 'SHORT' | 'LONG', impactMin: number, today: string): Promise<Catalyst[]> {
  const bySymbol = new Map<string, Catalyst>();
  const brief = await getTodayBrief().catch(() => []);
  for (const b of brief) {
    if (b.bias === 'NEUTRAL' || !NIFTY500.has(b.symbol)) continue;
    const impact = b.impact ?? 0;
    if (impact < impactMin) continue;
    const isLong = impact >= HORIZON.LONG.impactMin;        // ≥0.6 → LONG bucket, else SHORT
    if ((horizon === 'LONG') !== isLong) continue;
    if (!bySymbol.has(b.symbol)) bySymbol.set(b.symbol, { symbol: b.symbol, direction: b.bias, source: 'brief' });
  }
  if (horizon === 'SHORT') {
    const trusted = await getTrustedPhrases();
    if (trusted.length) {
      const tags = await db.select({ symbol: agentNewsSignalTags.symbol, direction: agentNewsSignalTags.direction })
        .from(agentNewsSignalTags)
        .where(and(eq(agentNewsSignalTags.taggedDate, today), inArray(agentNewsSignalTags.phraseId, trusted.map((t) => t.id))));
      for (const t of tags) if (NIFTY500.has(t.symbol) && !bySymbol.has(t.symbol)) bySymbol.set(t.symbol, { symbol: t.symbol, direction: t.direction, source: 'signal' });
    }
  }
  return [...bySymbol.values()].slice(0, 10);
}
