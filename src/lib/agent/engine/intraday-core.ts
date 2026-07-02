/**
 * Shared intraday engine for the price-scan strategy baskets (VWAP-reversion,
 * gap-and-go) and the event-driven news-signal bucket. Each strategy supplies
 * only an entry signal; this core owns the parts every same-day strategy shares:
 * risk-based sizing (+ min-notional gate + per-name/gross/cash caps), generic
 * stop/target/15:15-square-off exit, and DB persistence. ORB keeps its own
 * bespoke runner (untouched); the timing/threshold constants are reused from
 * orb-step so behaviour stays consistent. Never overnight. Money in paisa.
 */

import { eq } from 'drizzle-orm';
import {
  db, agentSignals, agentDecisions, agentTrades, agentPositions,
  agentSleeves, type AgentSleeve, type AgentDecisionEvidence, type AgentSide,
} from '@/db';
import { DEFAULT_COST_MODEL, tradeCostPaisa, cgTaxPaisa } from '../backtest/costs';
import { SQUARE_OFF, MIN_NOTIONAL_PCT } from './orb-step';

export interface SizingCtx {
  allocationPaisa: number;
  cashBalancePaisa: number;
  grossDeployedPaisa: number;
  riskPctPerTrade: number;
}

/**
 * Whole-unit qty risking `riskPct` of the sleeve over the stop distance, capped
 * by per-name (30%), gross-exposure, cash (longs), and rejected if the resulting
 * notional is below the min-viable position (5% of the sleeve — no cost-only scraps).
 */
export function sizeQty(entryPaisa: number, stopPaisa: number, side: AgentSide, ctx: SizingCtx): number {
  const riskUnit = Math.abs(entryPaisa - stopPaisa);
  if (riskUnit <= 0 || entryPaisa <= 0) return 0;
  const perNameCap = Math.round(ctx.allocationPaisa * 0.30);
  const room = Math.min(perNameCap, ctx.allocationPaisa - ctx.grossDeployedPaisa);
  if (room < entryPaisa) return 0;
  const riskBudget = Math.round((ctx.allocationPaisa * ctx.riskPctPerTrade) / 100);
  let qty = Math.floor(riskBudget / riskUnit);
  qty = Math.min(qty, Math.floor(room / entryPaisa));
  if (side === 'LONG') qty = Math.min(qty, Math.floor(ctx.cashBalancePaisa / entryPaisa));
  if (qty < 1) return 0;
  const minNotional = Math.round((ctx.allocationPaisa * MIN_NOTIONAL_PCT) / 100);
  if (entryPaisa * qty < minNotional) return 0;
  return qty;
}

export interface OpenPositionLite {
  id: number; symbol: string; side: AgentSide; quantity: number; contractMultiplier: number;
  avgPricePaisa: number; stopPaisa: number | null; targetPaisa: number | null; openedDate: string;
}

/** Generic exit decision from the position's stored stop/target + square-off rules. */
export function manageExit(
  pos: OpenPositionLite, lastPx: number, nowIstMin: number, marketOpen: boolean, runDate: string,
): { exit: boolean; reason: string } {
  const long = pos.side === 'LONG';
  const stale = pos.openedDate !== runDate;
  const forceOut = nowIstMin >= SQUARE_OFF || !marketOpen || stale;
  const hitStop = pos.stopPaisa != null && (long ? lastPx <= pos.stopPaisa : lastPx >= pos.stopPaisa);
  const hitTarget = pos.targetPaisa != null && (long ? lastPx >= pos.targetPaisa : lastPx <= pos.targetPaisa);
  if (!forceOut && !hitStop && !hitTarget) return { exit: false, reason: '' };
  const reason = stale ? 'overnight safety square-off' : !marketOpen ? 'market closed — square-off'
    : nowIstMin >= SQUARE_OFF ? '15:15 square-off' : hitStop ? 'stop hit' : 'target hit';
  return { exit: true, reason };
}

export interface OpenIntent {
  symbol: string; name: string; watchlistId?: number; side: AgentSide;
  entryPaisa: number; stopPaisa: number | null; targetPaisa: number | null; qty: number;
  rationale: string; evidence: AgentDecisionEvidence;
}

/** Persist an OPEN: signal + decision + trade + position. Returns new cash. */
export async function persistOpen(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string, it: OpenIntent, cash: number,
): Promise<number> {
  const notional = it.entryPaisa * it.qty;
  const action = it.side === 'LONG' ? 'BUY' : 'SELL';
  const sig = await upsertSignal(userId, sleeve, runId, runDate, it.symbol, it.name, it.entryPaisa, action, it.evidence);
  const [dec] = await db.insert(agentDecisions).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, signalId: sig?.id,
    action, assetClass: 'STOCK', symbol: it.symbol, name: it.name, quantity: it.qty, pricePaisa: it.entryPaisa,
    amountPaisa: notional, confidence: '0.6', rationale: it.rationale, evidenceJson: it.evidence, executed: true,
  }).returning();
  const [trade] = await db.insert(agentTrades).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: dec.id, runId,
    type: action, assetClass: 'STOCK', symbol: it.symbol, schemeCode: '', name: it.name, side: it.side,
    quantity: it.qty, contractMultiplier: 1, pricePerUnitPaisa: it.entryPaisa,
    grossAmountPaisa: notional, netAmountPaisa: notional, status: 'FILLED', tradeDate: runDate, fillDate: runDate,
  }).returning();
  await db.insert(agentPositions).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, watchlistId: it.watchlistId,
    assetClass: 'STOCK', symbol: it.symbol, schemeCode: '', name: it.name, side: it.side,
    quantity: it.qty, contractMultiplier: 1, avgPricePaisa: it.entryPaisa, lastPricePaisa: it.entryPaisa,
    stopPaisa: it.stopPaisa, targetPaisa: it.targetPaisa, openedDate: runDate,
  });
  await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, dec.id));
  return it.side === 'LONG' ? cash - notional : cash; // shorts tie up margin, not cash
}

/** Persist a CLOSE: settle cost+tax at exit, delete the position. Returns new cash. */
export async function persistClose(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string,
  pos: OpenPositionLite, name: string, exitPaisa: number, reason: string, asOf: string, cash: number,
  holdingDays = 0, // 0 = intraday (default); ≥1 = delivery (swing) → delivery costs + STCG/LTCG
): Promise<number> {
  const long = pos.side === 'LONG';
  const qty = pos.quantity;
  const notional = Math.round(exitPaisa * qty * pos.contractMultiplier);
  const grossPnl = Math.round((long ? exitPaisa - pos.avgPricePaisa : pos.avgPricePaisa - exitPaisa) * qty * pos.contractMultiplier);
  const cost = tradeCostPaisa(notional, 'STOCK', true, holdingDays, DEFAULT_COST_MODEL);
  const tax = cgTaxPaisa(grossPnl, holdingDays, DEFAULT_COST_MODEL);
  const realized = grossPnl - cost - tax;
  const action = long ? 'SELL' : 'BUY';
  const ev: AgentDecisionEvidence = {
    rule: `exit: ${reason}`,
    inputs: { entryPaisa: pos.avgPricePaisa, exitPaisa, side: pos.side },
    sizing: { qty, stopPaisa: pos.stopPaisa ?? 0, targetPaisa: pos.targetPaisa ?? 0, costPaisa: cost, taxPaisa: tax, realizedPnlPaisa: realized },
    source: 'YAHOO', dataAsOf: asOf,
  };
  const rationale = `${reason}: ${pos.side} ${pos.symbol} exit @ ₹${(exitPaisa / 100).toFixed(2)} (${asOf}) → ${realized >= 0 ? 'profit' : 'loss'} ₹${Math.round(realized / 100)}.`;
  const sig = await upsertSignal(userId, sleeve, runId, runDate, pos.symbol, name, exitPaisa, action, ev);
  const [dec] = await db.insert(agentDecisions).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, signalId: sig?.id,
    action, assetClass: 'STOCK', symbol: pos.symbol, name, quantity: qty, pricePaisa: exitPaisa,
    amountPaisa: notional, confidence: '0.6', rationale, evidenceJson: ev, executed: true,
  }).returning();
  const [trade] = await db.insert(agentTrades).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, decisionId: dec.id, runId,
    type: action, assetClass: 'STOCK', symbol: pos.symbol, schemeCode: '', name, side: pos.side,
    quantity: qty, contractMultiplier: pos.contractMultiplier, pricePerUnitPaisa: exitPaisa,
    grossAmountPaisa: notional, netAmountPaisa: notional - cost - tax, status: 'FILLED',
    tradeDate: runDate, fillDate: runDate, realizedPnlPaisa: realized,
  }).returning();
  await db.delete(agentPositions).where(eq(agentPositions.id, pos.id));
  await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, dec.id));
  return long ? cash + notional - cost - tax : cash + realized;
}

/** Persist the sleeve's cash after a run. */
export async function saveCash(sleeveId: number, cashPaisa: number): Promise<void> {
  await db.update(agentSleeves).set({ cashBalancePaisa: cashPaisa, lastRunAt: new Date() }).where(eq(agentSleeves.id, sleeveId));
}

async function upsertSignal(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string,
  symbol: string, name: string, pricePaisa: number, action: string, ev: AgentDecisionEvidence,
) {
  const rec = action === 'BUY' ? 'BUY' : action === 'SELL' ? 'SELL' : 'HOLD';
  const [sig] = await db.insert(agentSignals).values({
    userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, runId, runDate,
    assetClass: 'STOCK', symbol, name, lastPricePaisa: pricePaisa, score: 0,
    recommendation: rec, signalsJson: {}, source: ev.source, dataAsOf: undefined,
  }).onConflictDoUpdate({
    target: [agentSignals.runId, agentSignals.sleeveId, agentSignals.symbol],
    set: { recommendation: rec, lastPricePaisa: pricePaisa },
  }).returning();
  return sig;
}
