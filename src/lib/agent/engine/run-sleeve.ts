/**
 * Per-sleeve runner: build the strategy context from REAL market data, run the
 * sleeve's strategy, then persist signals + decisions (each with its real-data
 * evidence + plain-language rationale) and execute the paper trades against the
 * sleeve's own cash. Sleeve-scoped; the orchestrator (step 4) loops sleeves.
 *
 * SAFETY: touches only agent_* tables. Paper money only. Money in paisa.
 */

import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  agentWatchlist,
  agentSignals,
  agentDecisions,
  agentTrades,
  agentPositions,
  agentSleeves,
  priceSnapshots,
  type AgentSleeve,
} from '@/db';
import { getInstrumentQuote, getInstrumentHistory, type InstrumentRef } from '../market-data';
import { getDailyCloses } from '@/lib/services/yahoo-finance';
import { sma } from '../signals/indicators';
import { getStrategy } from '../strategies/registry';
import { buildRationale } from './rationale';
import { applyRiskControls } from './risk';
import { hasFreshNegativeNews } from '../news/ingest';
import { agentSleeveEquitySymbol } from './equity-curve';
import { DEFAULT_COST_MODEL, tradeCostPaisa, cgTaxPaisa } from '../backtest/costs';
import { daysBetween } from '../strategies/types';
import type { InstrumentInput, OpenPositionLite, SleeveContext } from '../strategies/types';

export interface SleeveRunResult {
  sleeveKey: string;
  quotesFetched: number;
  decisions: number;
  tradesExecuted: number;
  cashBalancePaisa: number;
}

export async function runSleeve(
  userId: string,
  sleeve: AgentSleeve,
  runId: number,
  runDate: string,
  opts: { execute?: boolean } = {},
): Promise<SleeveRunResult> {
  const execute = opts.execute !== false; // when false (market closed), record decisions but don't fill
  // 1. Watchlist for this sleeve.
  const wl = await db
    .select()
    .from(agentWatchlist)
    .where(and(eq(agentWatchlist.userId, userId), eq(agentWatchlist.sleeveId, sleeve.id), eq(agentWatchlist.enabled, true)));

  // 2. Real quotes + history per instrument (skip those without a fresh quote).
  const instruments: InstrumentInput[] = [];
  for (const w of wl) {
    const ref: InstrumentRef = {
      assetClass: w.assetClass,
      symbol: w.symbol || undefined,
      schemeCode: w.schemeCode || undefined,
      isin: w.isin || undefined,
      contractMultiplier: w.contractMultiplier,
    };
    const quote = await getInstrumentQuote(ref);
    if (!quote) continue;
    // 2y of history so 12-1 momentum (needs ~252+21 bars) has enough data.
    const history = await getInstrumentHistory(ref, '2y');
    instruments.push({
      watchlistId: w.id,
      assetClass: w.assetClass,
      symbol: w.symbol,
      schemeCode: w.schemeCode,
      name: w.name,
      contractMultiplier: w.contractMultiplier,
      quote,
      history,
      source: quote.source ?? (w.assetClass === 'MF' ? 'AMFI' : 'YAHOO'),
    });
  }

  // 3. Current positions for this sleeve.
  const posRows = await db.select().from(agentPositions).where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));
  const positions: OpenPositionLite[] = posRows.map((p) => ({
    id: p.id, assetClass: p.assetClass, symbol: p.symbol, schemeCode: p.schemeCode,
    side: p.side, quantity: p.quantity, avgPricePaisa: p.avgPricePaisa, contractMultiplier: p.contractMultiplier, openedDate: p.openedDate,
  }));

  // #5 regime gate: risk-on when Nifty 50 is above its 200-DMA.
  let regimeRiskOn = true;
  try {
    const idx = (await getDailyCloses('^NSEI', '1y')).map((x) => x.close);
    const s200 = sma(idx, 200);
    regimeRiskOn = s200 == null || (idx.at(-1) ?? 0) > s200;
  } catch { /* default risk-on if index unavailable */ }

  // #1 kill-switch inputs: current sleeve equity + historical peak.
  const positionsValue = posRows.reduce((s, p) => s + (p.marketValuePaisa ?? Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier)), 0);
  const currentEquity = sleeve.cashBalancePaisa + positionsValue;
  const peakRow = (await db.select({ price: priceSnapshots.price }).from(priceSnapshots)
    .where(and(eq(priceSnapshots.userId, userId), eq(priceSnapshots.assetSymbol, agentSleeveEquitySymbol(sleeve.id))))
    .orderBy(desc(priceSnapshots.price)).limit(1))[0];
  const peakEquity = Math.max(currentEquity, peakRow?.price ?? sleeve.allocationPaisa);

  // 4. Run the strategy, then apply portfolio-level risk controls.
  const ctx: SleeveContext = {
    sleeve,
    cashPaisa: sleeve.cashBalancePaisa,
    positions,
    instruments,
    params: (sleeve.paramsJson as Record<string, number>) ?? {},
    runDate,
    regimeRiskOn,
    currentEquityPaisa: currentEquity,
    peakEquityPaisa: peakEquity,
  };
  const intents = applyRiskControls(ctx, getStrategy(sleeve.strategy).run(ctx));
  // #5 live news guard — never buy into a fresh, material negative headline.
  for (let k = 0; k < intents.length; k++) {
    const it = intents[k];
    if (it.action === 'BUY' && it.symbol && (await hasFreshNegativeNews(it.symbol))) {
      intents[k] = { ...it, action: 'WATCH', quantity: 0, amountPaisa: 0,
        evidence: { ...it.evidence, rule: 'news guard: fresh material negative headline' } };
    }
  }

  // 5. Persist signals + decisions (+evidence/rationale) and execute trades.
  let cash = sleeve.cashBalancePaisa;
  let trades = 0;
  for (const it of intents) {
    const sigSymbol = it.symbol || it.schemeCode || it.name;
    const [sig] = await db
      .insert(agentSignals)
      .values({
        userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, runDate,
        assetClass: it.assetClass, symbol: sigSymbol, name: it.name,
        lastPricePaisa: it.pricePaisa, score: it.score, recommendation: it.recommendation,
        signalsJson: it.signals, source: it.evidence.source,
        dataAsOf: it.evidence.dataAsOf ? new Date(it.evidence.dataAsOf) : undefined,
      })
      .onConflictDoUpdate({
        target: [agentSignals.runId, agentSignals.sleeveId, agentSignals.symbol],
        set: { score: it.score, recommendation: it.recommendation, lastPricePaisa: it.pricePaisa, signalsJson: it.signals },
      })
      .returning();

    const executed = (it.action === 'BUY' || it.action === 'SELL') && execute;
    const [decision] = await db
      .insert(agentDecisions)
      .values({
        userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, signalId: sig?.id,
        action: it.action, assetClass: it.assetClass, symbol: it.symbol, name: it.name,
        quantity: it.quantity || undefined, pricePaisa: it.pricePaisa, amountPaisa: it.amountPaisa || undefined,
        confidence: it.confidence, rationale: buildRationale(it.action, it.name, it.evidence),
        evidenceJson: it.evidence, executed,
      })
      .returning();

    if (!executed) continue;

    const net = it.amountPaisa;
    if (it.action === 'BUY') {
      const [trade] = await db.insert(agentTrades).values({
        userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: decision.id, runId,
        type: 'BUY', assetClass: it.assetClass, symbol: it.symbol, schemeCode: it.schemeCode, name: it.name, side: it.side,
        quantity: it.quantity, contractMultiplier: it.contractMultiplier, pricePerUnitPaisa: it.pricePaisa,
        grossAmountPaisa: net, netAmountPaisa: net, status: 'FILLED', tradeDate: runDate, fillDate: runDate,
      }).returning();
      const existing = posRows.find((p) => p.assetClass === it.assetClass && p.symbol === it.symbol && p.schemeCode === it.schemeCode);
      if (existing) {
        const newQty = existing.quantity + it.quantity;
        const newAvg = Math.round((existing.avgPricePaisa * existing.quantity + it.pricePaisa * it.quantity) / newQty);
        await db.update(agentPositions).set({ quantity: newQty, avgPricePaisa: newAvg, updatedAt: new Date() }).where(eq(agentPositions.id, existing.id));
      } else {
        await db.insert(agentPositions).values({
          userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, watchlistId: it.watchlistId,
          assetClass: it.assetClass, symbol: it.symbol, schemeCode: it.schemeCode, name: it.name, side: it.side,
          quantity: it.quantity, contractMultiplier: it.contractMultiplier, avgPricePaisa: it.pricePaisa,
          lastPricePaisa: it.pricePaisa, openedDate: runDate,
        });
      }
      cash -= net; trades += 1;
      await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, decision.id));
    } else {
      // SELL — close (or reduce) the position, book realized P&L NET of the
      // holding-aware round-trip cost (same-day → intraday rates, overnight →
      // delivery) and capital-gains/slab tax. Honest paper accounting.
      const existing = posRows.find((p) => p.assetClass === it.assetClass && p.symbol === it.symbol && p.schemeCode === it.schemeCode);
      if (!existing) continue;
      const qty = Math.min(it.quantity, existing.quantity);
      const holdDays = daysBetween(existing.openedDate, runDate);
      const sellGross = Math.round(it.pricePaisa * qty * existing.contractMultiplier);
      const grossPnl = Math.round((it.pricePaisa - existing.avgPricePaisa) * qty * existing.contractMultiplier);
      const cost = tradeCostPaisa(sellGross, it.assetClass, true, holdDays, DEFAULT_COST_MODEL);
      const tax = cgTaxPaisa(grossPnl, holdDays, DEFAULT_COST_MODEL);
      const proceeds = sellGross - cost - tax;
      const realized = grossPnl - cost - tax;
      const [trade] = await db.insert(agentTrades).values({
        userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: decision.id, runId,
        type: 'SELL', assetClass: it.assetClass, symbol: it.symbol, schemeCode: it.schemeCode, name: it.name, side: existing.side,
        quantity: qty, contractMultiplier: existing.contractMultiplier, pricePerUnitPaisa: it.pricePaisa,
        grossAmountPaisa: sellGross, netAmountPaisa: proceeds, status: 'FILLED', tradeDate: runDate, fillDate: runDate, realizedPnlPaisa: realized,
      }).returning();
      const remaining = existing.quantity - qty;
      if (remaining <= 0.0000001) await db.delete(agentPositions).where(eq(agentPositions.id, existing.id));
      else await db.update(agentPositions).set({ quantity: remaining, updatedAt: new Date() }).where(eq(agentPositions.id, existing.id));
      cash += proceeds; trades += 1;
      await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, decision.id));
    }
  }

  await db.update(agentSleeves).set({ cashBalancePaisa: cash, lastRunAt: new Date() }).where(eq(agentSleeves.id, sleeve.id));
  return { sleeveKey: sleeve.key, quotesFetched: instruments.length, decisions: intents.length, tradesExecuted: trades, cashBalancePaisa: cash };
}
