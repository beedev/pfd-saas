/**
 * News-signal bucket runner (Phase 3). Event-driven, not a bar-scan: when a
 * TRUSTED dictionary phrase has tagged fresh news for a stock today, enter in the
 * phrase's direction with an ATR stop/target; manage/square-off via the shared
 * core. Dormant until phrases earn trust (≥0.6 hit-rate over ≥5 days). Never
 * overnight. Paisa.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, agentTrades, agentPositions, agentNewsSignalTags, type AgentSleeve } from '@/db';
import { getIntradayBars } from '@/lib/services/yahoo-finance';
import { atr } from '../signals/indicators';
import { minOfDay, hhmm, OR_START, OR_END, LAST_ENTRY, SESSION_END } from './orb-step';
import { sizeQty, manageExit, persistOpen, persistClose, saveCash, type OpenPositionLite } from './intraday-core';
import { getTrustedPhrases } from '../signal/dictionary';
import type { SleeveRunResult } from './run-sleeve';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function runNewsSignal(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string, opts: { marketOpen: boolean },
): Promise<SleeveRunResult> {
  const p = { atrPeriod: 14, stopAtr: 1.0, targetAtr: 2.0, riskPctPerTrade: 0.75, maxConcurrent: 5, ...((sleeve.paramsJson as Record<string, number>) ?? {}) };
  const now = minOfDay(Math.floor(Date.now() / 1000));
  const today = istDate();

  const positions = await db.select().from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));
  const tradedRows = await db.select({ symbol: agentTrades.symbol }).from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.tradeDate, runDate)));
  const tradedToday = new Set(tradedRows.map((r) => r.symbol));

  let cash = sleeve.cashBalancePaisa;
  let openCount = positions.length;
  let grossDeployed = positions.reduce((a, x) => a + Math.round(x.avgPricePaisa * x.quantity * x.contractMultiplier), 0);
  let quotes = 0, decisions = 0, trades = 0;

  // ---- 1. Manage open positions (ATR stop/target + square-off) ----
  for (const existing of positions) {
    const bars = (await getIntradayBars(existing.symbol)).filter((b) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) <= SESSION_END);
    if (!bars.length) continue;
    const last = bars[bars.length - 1];
    const lastPx = Math.round(last.close * 100);
    const pos: OpenPositionLite = {
      id: existing.id, symbol: existing.symbol, side: existing.side, quantity: existing.quantity,
      contractMultiplier: existing.contractMultiplier, avgPricePaisa: existing.avgPricePaisa,
      stopPaisa: existing.stopPaisa, targetPaisa: existing.targetPaisa, openedDate: existing.openedDate,
    };
    const { exit, reason } = manageExit(pos, lastPx, now, opts.marketOpen, runDate);
    if (exit) {
      cash = await persistClose(userId, sleeve, runId, runDate, pos, existing.name, lastPx, reason, hhmm(last.epoch), cash);
      openCount--; grossDeployed -= Math.round(existing.avgPricePaisa * existing.quantity * existing.contractMultiplier);
      decisions++; trades++;
    }
  }

  // ---- 2. Entries from TODAY's trusted-phrase tags ----
  if (opts.marketOpen && now >= OR_END && now < LAST_ENTRY && openCount < p.maxConcurrent) {
    const trusted = await getTrustedPhrases();
    if (trusted.length) {
      const trustedIds = trusted.map((t) => t.id);
      const tags = await db.select({ symbol: agentNewsSignalTags.symbol, direction: agentNewsSignalTags.direction })
        .from(agentNewsSignalTags)
        .where(and(eq(agentNewsSignalTags.taggedDate, today), inArray(agentNewsSignalTags.phraseId, trustedIds)));
      // One entry per symbol per day; first trusted direction wins.
      const bySymbol = new Map<string, 'BULLISH' | 'BEARISH'>();
      for (const t of tags) if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, t.direction as 'BULLISH' | 'BEARISH');

      const held = new Set(positions.map((x) => x.symbol));
      for (const [symbol, dir] of bySymbol) {
        if (openCount >= p.maxConcurrent) break;
        if (!symbol.endsWith('.NS') || tradedToday.has(symbol) || held.has(symbol)) continue;
        const bars = (await getIntradayBars(symbol)).filter((b) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) <= SESSION_END);
        if (bars.length < p.atrPeriod + 2) continue;
        quotes++;
        const a = atr(bars, p.atrPeriod);
        if (a == null || a <= 0) continue;
        const last = bars[bars.length - 1];
        const entry = Math.round(last.close * 100);
        const side = dir === 'BULLISH' ? 'LONG' : 'SHORT';
        const stop = side === 'LONG' ? entry - Math.round(p.stopAtr * a * 100) : entry + Math.round(p.stopAtr * a * 100);
        const target = side === 'LONG' ? entry + Math.round(p.targetAtr * a * 100) : entry - Math.round(p.targetAtr * a * 100);
        const qty = sizeQty(entry, stop, side, { allocationPaisa: sleeve.allocationPaisa, cashBalancePaisa: cash, grossDeployedPaisa: grossDeployed, riskPctPerTrade: p.riskPctPerTrade });
        if (qty < 1) continue;
        const asOf = hhmm(last.epoch);
        const rationale = `Trusted news signal (${dir}) → ${side} ${symbol} @ ₹${(entry / 100).toFixed(2)} (${asOf}); stop ₹${(stop / 100).toFixed(2)}, target ₹${(target / 100).toFixed(2)}.`;
        cash = await persistOpen(userId, sleeve, runId, runDate, {
          symbol, name: symbol, side, entryPaisa: entry, stopPaisa: stop, targetPaisa: target, qty, rationale,
          evidence: { rule: 'trusted news-signal entry', inputs: { direction: dir, entryPaisa: entry, atr: +a.toFixed(2) }, thresholds: { stopPaisa: stop, targetPaisa: target }, source: 'YAHOO', dataAsOf: asOf },
        }, cash);
        grossDeployed += entry * qty; openCount++; decisions++; trades++;
      }
    }
  }

  await saveCash(sleeve.id, cash);
  return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash };
}
