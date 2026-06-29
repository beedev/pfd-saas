/**
 * Intraday ORB runner — a TRUE same-day sleeve (Opening-Range Breakout, long +
 * short) on liquid F&O names using 5-min bars:
 *   • Opening range = high/low of the first 30 min (09:15–09:45 IST).
 *   • Break above OR-high → go LONG; break below OR-low → go SHORT (one shot/name/day).
 *   • Stop = the opposite side of the range; target = R × the range distance.
 *   • FORCE square-off by 15:15 IST (or if the market has closed) — never holds
 *     overnight, so every trade pays the cheap intraday cost (holdingDays = 0).
 *
 * Stateless per tick: the cron calls this every ~30 min; each call reads today's
 * bars + current positions and acts. Every decision records its real-data
 * evidence + a plain-language rationale, like the daily sleeves.
 *
 * SAFETY: touches only agent_* tables. Paper money only. Money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import {
  db, agentWatchlist, agentSignals, agentDecisions, agentTrades, agentPositions,
  agentSleeves, type AgentSleeve, type AgentDecisionEvidence,
} from '@/db';
import { getIntradayBars, type IntradayBar } from '@/lib/services/yahoo-finance';
import { DEFAULT_COST_MODEL, tradeCostPaisa, cgTaxPaisa } from '../backtest/costs';
import type { SleeveRunResult } from './run-sleeve';

// IST is a fixed UTC+5:30 offset (no DST) → minutes-of-day from epoch directly.
const IST_OFFSET = 19800; // 5.5h in seconds
const minOfDay = (epoch: number) => Math.floor(((epoch + IST_OFFSET) % 86400) / 60);
const nowIstMin = () => minOfDay(Math.floor(Date.now() / 1000));
const hhmm = (epoch: number) => {
  const m = (epoch + IST_OFFSET) % 86400;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const OR_START = 9 * 60 + 15;   // 09:15
const OR_END = 9 * 60 + 45;     // 09:45 — opening range = [09:15, 09:45)
const LAST_ENTRY = 14 * 60 + 30; // 14:30 — no new entries after this
const SQUARE_OFF = 15 * 60 + 15; // 15:15 — force flat

interface Params { openingRangeMins: number; riskPctPerTrade: number; targetR: number; maxConcurrent: number }
const defaults: Params = { openingRangeMins: 30, riskPctPerTrade: 0.75, targetR: 1.5, maxConcurrent: 5 };

export async function runIntradayOrb(
  userId: string,
  sleeve: AgentSleeve,
  runId: number,
  runDate: string,
  opts: { marketOpen: boolean },
): Promise<SleeveRunResult> {
  const p = { ...defaults, ...((sleeve.paramsJson as Partial<Params>) ?? {}) };
  const now = nowIstMin();
  const wl = await db.select().from(agentWatchlist)
    .where(and(eq(agentWatchlist.userId, userId), eq(agentWatchlist.sleeveId, sleeve.id), eq(agentWatchlist.enabled, true)));
  const positions = await db.select().from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));

  let cash = sleeve.cashBalancePaisa;
  let openCount = positions.length;
  let trades = 0, decisions = 0, quotes = 0;
  // Gross exposure already deployed (longs + shorts, by notional). New entries
  // are capped so total gross never exceeds the sleeve corpus, and no single
  // name exceeds 30% of it — paper money has no leverage.
  let grossDeployed = positions.reduce((a, p) => a + Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier), 0);
  const perNameCapPaisa = Math.round(sleeve.allocationPaisa * 0.30);

  for (const w of wl) {
    if (!w.symbol) continue;
    const bars = (await getIntradayBars(w.symbol)).filter((b) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) <= 15 * 60 + 30);
    if (!bars.length) continue;
    quotes++;

    const orBars = bars.filter((b) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) < OR_END);
    const last = bars[bars.length - 1];
    const lastPx = Math.round(last.close * 100);
    const asOf = hhmm(last.epoch);
    const existing = positions.find((x) => x.symbol === w.symbol);

    // ---- Manage an open position --------------------------------------------
    if (existing) {
      const orHigh = orBars.length ? Math.round(Math.max(...orBars.map((b) => b.high)) * 100) : existing.avgPricePaisa;
      const orLow = orBars.length ? Math.round(Math.min(...orBars.map((b) => b.low)) * 100) : existing.avgPricePaisa;
      const long = existing.side === 'LONG';
      const stop = long ? orLow : orHigh;
      const target = long
        ? existing.avgPricePaisa + Math.round((existing.avgPricePaisa - orLow) * p.targetR)
        : existing.avgPricePaisa - Math.round((orHigh - existing.avgPricePaisa) * p.targetR);
      const stale = existing.openedDate !== runDate;
      const forceOut = now >= SQUARE_OFF || !opts.marketOpen || stale;
      const hitStop = long ? lastPx <= stop : lastPx >= stop;
      const hitTarget = long ? lastPx >= target : lastPx <= target;

      if (forceOut || hitStop || hitTarget) {
        const reason = stale ? 'overnight safety square-off' : !opts.marketOpen ? 'market closed — square-off'
          : now >= SQUARE_OFF ? '15:15 square-off' : hitStop ? 'stop hit' : 'target hit';
        const qty = existing.quantity;
        const notional = Math.round(lastPx * qty * existing.contractMultiplier);
        const grossPnl = Math.round((long ? lastPx - existing.avgPricePaisa : existing.avgPricePaisa - lastPx) * qty * existing.contractMultiplier);
        const cost = tradeCostPaisa(notional, 'STOCK', true, 0, DEFAULT_COST_MODEL); // holdingDays 0 → intraday rates
        const tax = cgTaxPaisa(grossPnl, 0, DEFAULT_COST_MODEL);
        const realized = grossPnl - cost - tax;
        const action = long ? 'SELL' : 'BUY'; // long exit = SELL; short cover = BUY
        const ev: AgentDecisionEvidence = {
          rule: `ORB exit: ${reason}`,
          inputs: { entryPaisa: existing.avgPricePaisa, exitPaisa: lastPx, orHigh, orLow, side: existing.side },
          sizing: { qty, stopPaisa: stop, targetPaisa: target, costPaisa: cost, taxPaisa: tax, realizedPnlPaisa: realized },
          source: 'YAHOO', dataAsOf: asOf,
        };
        decisions++;
        if (opts.marketOpen || forceOut) {
          const sig = await upsertSignal(userId, sleeve, runId, runDate, w, lastPx, action, ev);
          const [dec] = await db.insert(agentDecisions).values({
            userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, signalId: sig?.id,
            action, assetClass: 'STOCK', symbol: w.symbol, name: w.name, quantity: qty, pricePaisa: lastPx,
            amountPaisa: notional, confidence: '0.6',
            rationale: `${reason}: ${existing.side} ${w.symbol} exit @ ₹${(lastPx / 100).toFixed(2)} (${asOf}) → ${realized >= 0 ? 'profit' : 'loss'} ₹${Math.round(realized / 100)}.`,
            evidenceJson: ev, executed: true,
          }).returning();
          const [trade] = await db.insert(agentTrades).values({
            userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: dec.id, runId,
            type: action, assetClass: 'STOCK', symbol: w.symbol, schemeCode: '', name: w.name, side: existing.side,
            quantity: qty, contractMultiplier: existing.contractMultiplier, pricePerUnitPaisa: lastPx,
            grossAmountPaisa: notional, netAmountPaisa: notional - cost - tax, status: 'FILLED',
            tradeDate: runDate, fillDate: runDate, realizedPnlPaisa: realized,
          }).returning();
          await db.delete(agentPositions).where(eq(agentPositions.id, existing.id));
          await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, dec.id));
          // LONG: get sale proceeds back; SHORT: only the realized P&L (no cash moved at entry).
          cash += long ? notional - cost - tax : realized;
          openCount--; trades++;
        }
      }
      continue;
    }

    // ---- Consider a new entry ----------------------------------------------
    if (!opts.marketOpen || now < OR_END || now >= LAST_ENTRY || orBars.length < 3 || openCount >= p.maxConcurrent) continue;
    const tradedToday = (await db.select({ id: agentTrades.id }).from(agentTrades)
      .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.symbol, w.symbol), eq(agentTrades.tradeDate, runDate))).limit(1)).length > 0;
    if (tradedToday) continue;

    const orHigh = Math.round(Math.max(...orBars.map((b) => b.high)) * 100);
    const orLow = Math.round(Math.min(...orBars.map((b) => b.low)) * 100);
    const long = lastPx > orHigh;
    const short = lastPx < orLow;
    if (!long && !short) continue;

    const entry = lastPx;
    const stop = long ? orLow : orHigh;
    const riskUnit = Math.abs(entry - stop);
    if (riskUnit <= 0) continue;
    // Capital room: never exceed the corpus in total, nor 30% in one name.
    const room = Math.min(perNameCapPaisa, sleeve.allocationPaisa - grossDeployed);
    if (room < entry) continue; // no room for even one unit
    const riskBudget = Math.round((sleeve.allocationPaisa * p.riskPctPerTrade) / 100);
    let qty = Math.floor(riskBudget / riskUnit);
    qty = Math.min(qty, Math.floor(room / entry));               // gross + per-name cap
    if (long) qty = Math.min(qty, Math.floor(cash / entry));     // longs also bounded by cash
    if (qty < 1) continue;

    const notional = entry * qty;
    const target = long ? entry + Math.round(riskUnit * p.targetR) : entry - Math.round(riskUnit * p.targetR);
    const action = long ? 'BUY' : 'SELL'; // long open = BUY; short open = SELL-to-open
    const ev: AgentDecisionEvidence = {
      rule: long ? 'ORB long: price > opening-range high' : 'ORB short: price < opening-range low',
      inputs: { orHigh, orLow, lastPrice: entry, rangePaisa: orHigh - orLow, openingRangeMins: p.openingRangeMins },
      thresholds: { breakoutLevelPaisa: long ? orHigh : orLow },
      sizing: { riskPct: p.riskPctPerTrade, qty, entryPaisa: entry, stopPaisa: stop, targetPaisa: target },
      source: 'YAHOO', dataAsOf: asOf,
    };
    decisions++;
    const sig = await upsertSignal(userId, sleeve, runId, runDate, w, entry, action, ev);
    const [dec] = await db.insert(agentDecisions).values({
      userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, signalId: sig?.id,
      action, assetClass: 'STOCK', symbol: w.symbol, name: w.name, quantity: qty, pricePaisa: entry,
      amountPaisa: notional, confidence: '0.6',
      rationale: `${long ? 'LONG' : 'SHORT'} ${w.symbol} @ ₹${(entry / 100).toFixed(2)} (${asOf}) — broke ${long ? 'above' : 'below'} OR ${long ? 'high' : 'low'} ₹${((long ? orHigh : orLow) / 100).toFixed(2)}; stop ₹${(stop / 100).toFixed(2)}, target ₹${(target / 100).toFixed(2)}.`,
      evidenceJson: ev, executed: true,
    }).returning();
    const [trade] = await db.insert(agentTrades).values({
      userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: dec.id, runId,
      type: action, assetClass: 'STOCK', symbol: w.symbol, schemeCode: '', name: w.name, side: long ? 'LONG' : 'SHORT',
      quantity: qty, contractMultiplier: 1, pricePerUnitPaisa: entry,
      grossAmountPaisa: notional, netAmountPaisa: notional, status: 'FILLED', tradeDate: runDate, fillDate: runDate,
    }).returning();
    await db.insert(agentPositions).values({
      userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, watchlistId: w.id,
      assetClass: 'STOCK', symbol: w.symbol, schemeCode: '', name: w.name, side: long ? 'LONG' : 'SHORT',
      quantity: qty, contractMultiplier: 1, avgPricePaisa: entry, lastPricePaisa: entry, openedDate: runDate,
    });
    await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, dec.id));
    if (long) cash -= notional; // shorts tie up paper margin, not cash
    grossDeployed += notional;
    openCount++; trades++;
  }

  await db.update(agentSleeves).set({ cashBalancePaisa: cash, lastRunAt: new Date() }).where(eq(agentSleeves.id, sleeve.id));
  return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash };
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
