/**
 * Generic runner for price-scan intraday baskets (VWAP-reversion, gap-and-go).
 * Loads the sleeve's positions, scans a shared liquid universe, and delegates:
 *   • decisions → the strategy's pure entry() (strategies/intraday-scan.ts)
 *   • sizing + exits + persistence → the shared intraday core.
 * Never overnight; force square-off by 15:15. ORB has its own runner. Paisa.
 */

import { and, eq } from 'drizzle-orm';
import { db, agentTrades, agentPositions, type AgentSleeve } from '@/db';
import { getIntradayBars, getQuotes } from '@/lib/services/yahoo-finance';
import { minOfDay, hhmm, OR_START, OR_END, LAST_ENTRY, SESSION_END } from './orb-step';
import { sizeQty, manageExit, persistOpen, persistClose, saveCash, type OpenPositionLite } from './intraday-core';
import type { ScanStrategy } from '../strategies/intraday-scan';
import type { SleeveRunResult } from './run-sleeve';

export interface ScanUniverseItem { symbol: string; name: string; watchlistId?: number }

export async function runIntradayScan(
  userId: string, sleeve: AgentSleeve, strat: ScanStrategy, runId: number, runDate: string,
  opts: { marketOpen: boolean; universe: ScanUniverseItem[] },
): Promise<SleeveRunResult> {
  const params = { ...strat.defaults, ...((sleeve.paramsJson as Record<string, number>) ?? {}) };
  const riskPctPerTrade = params.riskPctPerTrade ?? 0.75;
  const maxConcurrent = params.maxConcurrent ?? 5;
  const now = minOfDay(Math.floor(Date.now() / 1000));

  const positions = await db.select().from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));
  const posBySymbol = new Map(positions.map((p) => [p.symbol, p]));
  const tradedRows = await db.select({ symbol: agentTrades.symbol }).from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.tradeDate, runDate)));
  const tradedToday = new Set(tradedRows.map((r) => r.symbol));

  // Batched quotes for previousClose (gap) — one call for the whole universe.
  const quotes = await getQuotes(opts.universe.map((u) => u.symbol)).catch(() => []);
  const prevCloseP = new Map(quotes.filter((q) => Number.isFinite(q.previousClose)).map((q) => [q.symbol, Math.round(q.previousClose * 100)]));

  let cash = sleeve.cashBalancePaisa;
  let openCount = positions.length;
  let grossDeployed = positions.reduce((a, p) => a + Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier), 0);
  let quotesFetched = 0, decisions = 0, trades = 0;

  for (const w of opts.universe) {
    if (!w.symbol) continue;
    const bars = (await getIntradayBars(w.symbol))
      .filter((b) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) <= SESSION_END);
    if (!bars.length) continue;
    quotesFetched++;
    const last = bars[bars.length - 1];
    const lastPx = Math.round(last.close * 100);
    const asOf = hhmm(last.epoch);
    const existing = posBySymbol.get(w.symbol);

    // ---- Manage an open position ----
    if (existing) {
      const pos: OpenPositionLite = {
        id: existing.id, symbol: existing.symbol, side: existing.side, quantity: existing.quantity,
        contractMultiplier: existing.contractMultiplier, avgPricePaisa: existing.avgPricePaisa,
        stopPaisa: existing.stopPaisa, targetPaisa: existing.targetPaisa, openedDate: existing.openedDate,
      };
      const { exit, reason } = manageExit(pos, lastPx, now, opts.marketOpen, runDate);
      if (exit) {
        cash = await persistClose(userId, sleeve, runId, runDate, pos, existing.name, lastPx, reason, asOf, cash);
        openCount--; grossDeployed -= Math.round(existing.avgPricePaisa * existing.quantity * existing.contractMultiplier);
        decisions++; trades++;
      }
      continue;
    }

    // ---- Consider a new entry ----
    if (!opts.marketOpen || now < OR_END || now >= LAST_ENTRY || openCount >= maxConcurrent || tradedToday.has(w.symbol)) continue;
    const sig = strat.entry({ bars, prevClosePaisa: prevCloseP.get(w.symbol), nowIstMin: now, params });
    if (!sig) continue;
    const qty = sizeQty(sig.entryPaisa, sig.stopPaisa, sig.side, { allocationPaisa: sleeve.allocationPaisa, cashBalancePaisa: cash, grossDeployedPaisa: grossDeployed, riskPctPerTrade });
    if (qty < 1) continue;

    const rationale = `${sig.rule} — ${sig.side} ${w.symbol} @ ₹${(sig.entryPaisa / 100).toFixed(2)} (${asOf}); stop ₹${(sig.stopPaisa / 100).toFixed(2)}, target ₹${(sig.targetPaisa / 100).toFixed(2)}.`;
    cash = await persistOpen(userId, sleeve, runId, runDate, {
      symbol: w.symbol, name: w.name, watchlistId: w.watchlistId, side: sig.side,
      entryPaisa: sig.entryPaisa, stopPaisa: sig.stopPaisa, targetPaisa: sig.targetPaisa, qty,
      rationale, evidence: { ...sig.evidence, dataAsOf: asOf },
    }, cash);
    grossDeployed += sig.entryPaisa * qty;
    openCount++; decisions++; trades++;
  }

  await saveCash(sleeve.id, cash);
  return { sleeveKey: sleeve.key, quotesFetched, decisions, tradesExecuted: trades, cashBalancePaisa: cash };
}
