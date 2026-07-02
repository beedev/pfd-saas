/**
 * Intraday ORB runner — a TRUE same-day sleeve (Opening-Range Breakout, long +
 * short) on liquid F&O names using 5-min bars:
 *   • Opening range = high/low of the first 30 min (09:15–09:45 IST).
 *   • Break above OR-high → go LONG; break below OR-low → go SHORT (one shot/name/day).
 *   • Stop = the opposite side of the range; target = R × the range distance.
 *   • FORCE square-off by 15:15 IST (or if the market has closed) — never holds
 *     overnight, so every trade pays the cheap intraday cost (holdingDays = 0).
 *
 * This file is the I/O shell: it loads state (watchlist, positions, brief, bars),
 * delegates ALL decisions to the pure `planIntradayTick()` core (`orb-step.ts` —
 * shared with the tuning replay), then persists the returned Intents. Stateless
 * per tick; the cron calls it every ~10 min.
 *
 * SAFETY: touches only agent_* tables. Paper money only. Money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import {
  db, agentSignals, agentDecisions, agentTrades, agentPositions,
  agentSleeves, type AgentSleeve, type AgentDecisionEvidence,
} from '@/db';
import { getIntradayBars } from '@/lib/services/yahoo-finance';
import { getBriefBias } from '../news/brief';
import type { AgentBriefBias } from '@/db';
import type { SleeveRunResult } from './run-sleeve';
import {
  planIntradayTick, resolveOrbParams, minOfDay, OR_START, SESSION_END,
  type UniverseEntry, type Intent, type CloseIntent, type OpenIntent,
} from './orb-step';

const nowIstMin = () => minOfDay(Math.floor(Date.now() / 1000));

export async function runIntradayOrb(
  userId: string,
  sleeve: AgentSleeve,
  runId: number,
  runDate: string,
  opts: { marketOpen: boolean; universe?: Array<{ symbol: string; name: string }> },
): Promise<SleeveRunResult> {
  const p = resolveOrbParams(sleeve.paramsJson as Record<string, unknown> | null);
  const positions = await db.select().from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));
  const posBySymbol = new Map(positions.map((x) => [x.symbol, x]));

  // Today's pre-market brief → directional gate (BULLISH = long-only, BEARISH = short-only).
  const briefMap = await getBriefBias().catch(() => new Map<string, { bias: AgentBriefBias; impact: number | null }>());
  // Universe = the shared Nifty-500 in-play movers (injected) ∪ held names, so we
  // trade what's actually moving and can always square off existing positions.
  const refMap = new Map<string, { id: number | undefined; symbol: string; name: string }>();
  for (const u of opts.universe ?? []) if (u.symbol.endsWith('.NS')) refMap.set(u.symbol, { id: undefined, symbol: u.symbol, name: u.name });
  for (const pos of positions) if (!refMap.has(pos.symbol)) refMap.set(pos.symbol, { id: undefined, symbol: pos.symbol, name: pos.name });
  const refs = [...refMap.values()];

  // Names already traded today (no re-entry — one shot per name per day).
  const tradedRows = await db.select({ symbol: agentTrades.symbol }).from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.tradeDate, runDate)));
  const tradedToday = new Set(tradedRows.map((r) => r.symbol));

  // Build the snapshot universe (one Yahoo fetch per symbol, session-filtered).
  const universe: UniverseEntry[] = [];
  for (const w of refs) {
    if (!w.symbol) continue;
    const bars = (await getIntradayBars(w.symbol))
      .filter((b) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) <= SESSION_END);
    const pos = posBySymbol.get(w.symbol);
    universe.push({
      symbol: w.symbol, name: w.name, watchlistId: w.id, bars,
      position: pos ? { side: pos.side, quantity: pos.quantity, contractMultiplier: pos.contractMultiplier, avgPricePaisa: pos.avgPricePaisa, openedDate: pos.openedDate } : undefined,
      tradedToday: tradedToday.has(w.symbol),
      bias: briefMap.get(w.symbol)?.bias,
    });
  }

  const grossDeployed = positions.reduce((a, x) => a + Math.round(x.avgPricePaisa * x.quantity * x.contractMultiplier), 0);
  const plan = planIntradayTick({
    now: nowIstMin(), runDate, marketOpen: opts.marketOpen,
    allocationPaisa: sleeve.allocationPaisa, cashBalancePaisa: sleeve.cashBalancePaisa,
    grossDeployedPaisa: grossDeployed, openCount: positions.length, universe, params: p,
  });

  // ---- Persist the planned Intents ----------------------------------------
  let trades = 0, decisions = 0;
  for (const it of plan.intents) {
    if (it.kind === 'CLOSE') {
      await persistClose(userId, sleeve, runId, runDate, it, posBySymbol.get(it.symbol)?.id);
    } else {
      await persistOpen(userId, sleeve, runId, runDate, it);
    }
    decisions++; trades++;
  }

  await db.update(agentSleeves).set({ cashBalancePaisa: plan.finalCashPaisa, lastRunAt: new Date() }).where(eq(agentSleeves.id, sleeve.id));
  return { sleeveKey: sleeve.key, quotesFetched: plan.quotes, decisions, tradesExecuted: trades, cashBalancePaisa: plan.finalCashPaisa };
}

async function persistClose(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string, it: CloseIntent, positionId: number | undefined,
) {
  const sig = await upsertSignal(userId, sleeve, runId, runDate, it, it.exitPaisa, it.action, it.evidence);
  const [dec] = await db.insert(agentDecisions).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, signalId: sig?.id,
    action: it.action, assetClass: 'STOCK', symbol: it.symbol, name: it.name, quantity: it.qty, pricePaisa: it.exitPaisa,
    amountPaisa: it.notionalPaisa, confidence: '0.6', rationale: it.rationale, evidenceJson: it.evidence, executed: true,
  }).returning();
  const [trade] = await db.insert(agentTrades).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: dec.id, runId,
    type: it.action, assetClass: 'STOCK', symbol: it.symbol, schemeCode: '', name: it.name, side: it.side,
    quantity: it.qty, contractMultiplier: 1, pricePerUnitPaisa: it.exitPaisa,
    grossAmountPaisa: it.notionalPaisa, netAmountPaisa: it.notionalPaisa - it.costPaisa - it.taxPaisa, status: 'FILLED',
    tradeDate: runDate, fillDate: runDate, realizedPnlPaisa: it.realizedPnlPaisa,
  }).returning();
  if (positionId != null) await db.delete(agentPositions).where(eq(agentPositions.id, positionId));
  await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, dec.id));
}

async function persistOpen(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string, it: OpenIntent,
) {
  const sig = await upsertSignal(userId, sleeve, runId, runDate, it, it.entryPaisa, it.action, it.evidence);
  const [dec] = await db.insert(agentDecisions).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, signalId: sig?.id,
    action: it.action, assetClass: 'STOCK', symbol: it.symbol, name: it.name, quantity: it.qty, pricePaisa: it.entryPaisa,
    amountPaisa: it.notionalPaisa, confidence: '0.6', rationale: it.rationale, evidenceJson: it.evidence, executed: true,
  }).returning();
  const [trade] = await db.insert(agentTrades).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: dec.id, runId,
    type: it.action, assetClass: 'STOCK', symbol: it.symbol, schemeCode: '', name: it.name, side: it.side,
    quantity: it.qty, contractMultiplier: 1, pricePerUnitPaisa: it.entryPaisa,
    grossAmountPaisa: it.notionalPaisa, netAmountPaisa: it.notionalPaisa, status: 'FILLED', tradeDate: runDate, fillDate: runDate,
  }).returning();
  await db.insert(agentPositions).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, watchlistId: it.watchlistId,
    assetClass: 'STOCK', symbol: it.symbol, schemeCode: '', name: it.name, side: it.side,
    quantity: it.qty, contractMultiplier: 1, avgPricePaisa: it.entryPaisa, lastPricePaisa: it.entryPaisa, openedDate: runDate,
  });
  await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, dec.id));
}

async function upsertSignal(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string,
  w: { symbol: string; name: string }, pricePaisa: number, action: string, ev: AgentDecisionEvidence,
) {
  const rec = action === 'BUY' ? 'BUY' : action === 'SELL' ? 'SELL' : 'HOLD';
  const [sig] = await db.insert(agentSignals).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, runDate,
    assetClass: 'STOCK', symbol: w.symbol, name: w.name, lastPricePaisa: pricePaisa, score: 0,
    recommendation: rec, signalsJson: {}, source: ev.source, dataAsOf: undefined,
  }).onConflictDoUpdate({
    target: [agentSignals.runId, agentSignals.sleeveId, agentSignals.symbol],
    set: { recommendation: rec, lastPricePaisa: pricePaisa },
  }).returning();
  return sig;
}

export type { Intent };
