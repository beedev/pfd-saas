/**
 * "My Picks" engine — trades the USER-CURATED watchlist. The user picks the
 * stocks (each tagged INTRADAY or MULTIDAY); this engine decides WHEN to buy
 * (the combined market-conditions trigger in strategies/watchlist-pick.ts:
 * regime OK + uptrend + breakout OR pullback) and manages the exit. LONG-ONLY
 * (cash-equity shorts can't be held overnight).
 *
 * One engine, three horizons — same picks list, split by each pick's tag:
 *   • INTRADAY  → INTRADAY-tagged picks; square off same day (like ORB/VWAP).
 *   • SHORT     → MULTIDAY-tagged picks; hold 2-3 days, ATR stop + target.
 *   • LONG      → MULTIDAY-tagged picks; hold up to ~2-3 months, wider stop.
 * Delivery cost + STCG on multi-day exits; intraday cost on same-day exits. Paisa.
 */

import { and, eq } from 'drizzle-orm';
import { db, agentTrades, agentPositions, agentWatchlist, agentDailyPicks, type AgentSleeve, type AgentDecisionEvidence } from '@/db';
import { getQuotes, getDailyOHLC, type DailyBar } from '@/lib/services/yahoo-finance';
import { sizeQty, persistOpen, persistClose, saveCash, type OpenPositionLite } from './intraday-core';
import { minOfDay, LAST_ENTRY, SQUARE_OFF } from './orb-step';
import { watchlistPick, regimeOkFromIndex, PICK_DEFAULTS } from '../strategies/watchlist-pick';
import { isStage2 } from '../workbench/stage';
import { atr } from '../signals/indicators';
import type { SleeveRunResult } from './run-sleeve';

export type SwingHorizon = 'INTRADAY' | 'SHORT' | 'LONG';
const VALIDATION_MIN_QTY = 4;   // paper: bump high-priced picks to ≥4 shares (never drop a leader for price)
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);

interface HorizonParams { maxHoldDays: number; targetPct: number; stopAtr: number; riskPctPerTrade: number; maxPositions: number; watchTag: 'INTRADAY' | 'MULTIDAY'; intraday: boolean }
const HORIZON: Record<SwingHorizon, HorizonParams> = {
  INTRADAY: { maxHoldDays: 1, targetPct: 3, stopAtr: 1.5, riskPctPerTrade: 1.0, maxPositions: 5, watchTag: 'INTRADAY', intraday: true },
  SHORT: { maxHoldDays: 3, targetPct: 4, stopAtr: 2.0, riskPctPerTrade: 1.0, maxPositions: 5, watchTag: 'MULTIDAY', intraday: false },
  LONG: { maxHoldDays: 45, targetPct: 12, stopAtr: 2.5, riskPctPerTrade: 1.0, maxPositions: 6, watchTag: 'MULTIDAY', intraday: false },
};

export interface PickCandidate { symbol: string; name: string }

export async function runSwing(
  userId: string, sleeve: AgentSleeve, runId: number, runDate: string,
  opts: { marketOpen: boolean; horizon: SwingHorizon; candidatesOverride?: PickCandidate[] },
): Promise<SleeveRunResult> {
  const p = { ...HORIZON[opts.horizon], ...((sleeve.paramsJson as Record<string, number>) ?? {}) };
  // Validation mode (fixedNotionalPaisa > 0): equal-weight ₹X per name, buy every
  // vetted Stage-2 pick directly (no trigger wait, no regime gate, no position cap)
  // so we accumulate a large sample to SCORE the algorithm. Exit adds a Stage-2 rule.
  const fixedNotional = (p as unknown as Record<string, number>).fixedNotionalPaisa ?? 0;
  const today = istDate();
  const nowMin = minOfDay(Math.floor(Date.now() / 1000));

  const positions = await db.select().from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));
  let cash = sleeve.cashBalancePaisa;
  let openCount = positions.length;
  let grossDeployed = positions.reduce((a, x) => a + Math.round(x.avgPricePaisa * x.quantity * x.contractMultiplier), 0);
  let quotes = 0, decisions = 0, trades = 0;
  const noop = { sleeveKey: sleeve.key, quotesFetched: 0, decisions: 0, tradesExecuted: 0, cashBalancePaisa: cash };

  // Multi-day buckets simply HOLD when the market is closed. The intraday bucket
  // still runs when closed IF it has open positions — to square them off.
  if (!opts.marketOpen && (!p.intraday || openCount === 0)) return noop;

  const ohlcCache = new Map<string, DailyBar[]>();
  const getOhlc = async (sym: string): Promise<DailyBar[]> => {
    if (!ohlcCache.has(sym)) ohlcCache.set(sym, await getDailyOHLC(sym, '1y'));
    return ohlcCache.get(sym)!;
  };

  // ---- 1. Manage holds — target / stop / (intraday square-off | multi-day max-hold) ----
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
    const heldDays = Math.max(p.intraday ? 0 : 1, daysBetween(existing.openedDate, today));
    const hitStop = existing.stopPaisa != null && (long ? lastPx <= existing.stopPaisa : lastPx >= existing.stopPaisa);
    const hitTarget = existing.targetPaisa != null && (long ? lastPx >= existing.targetPaisa : lastPx <= existing.targetPaisa);
    // Intraday: force flat at 15:15 / on close / if held overnight. Multi-day: max-hold.
    const squareOff = p.intraday && (nowMin >= SQUARE_OFF || !opts.marketOpen || existing.openedDate !== today);
    const maxHold = !p.intraday && heldDays >= p.maxHoldDays;
    // Validation holds also exit the moment a name drops out of Stage 2 (trend broke).
    const lostStage2 = fixedNotional > 0 && !p.intraday && !isStage2((await getOhlc(existing.symbol)).map((b) => b.close));
    if (!hitStop && !hitTarget && !squareOff && !maxHold && !lostStage2) continue;
    const reason = hitStop ? 'stop hit' : hitTarget ? 'target hit' : squareOff ? 'square-off' : lostStage2 ? 'lost Stage 2' : `max hold ${p.maxHoldDays}d`;
    const pos: OpenPositionLite = {
      id: existing.id, symbol: existing.symbol, side: existing.side, quantity: existing.quantity,
      contractMultiplier: existing.contractMultiplier, avgPricePaisa: existing.avgPricePaisa,
      stopPaisa: existing.stopPaisa, targetPaisa: existing.targetPaisa, openedDate: existing.openedDate,
    };
    cash = await persistClose(userId, sleeve, runId, runDate, pos, existing.name, lastPx, reason, today, cash, p.intraday ? 0 : heldDays);
    openCount--; grossDeployed -= Math.round(existing.avgPricePaisa * existing.quantity * existing.contractMultiplier);
    decisions++; trades++;
  }

  // ---- 2. Entries — the user's picks for this horizon, timed by the combined trigger ----
  const canEnter = opts.marketOpen && openCount < p.maxPositions && !(p.intraday && nowMin >= LAST_ENTRY);
  if (!canEnter) { await saveCash(sleeve.id, cash); return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash }; }

  // Market regime gate — index (^NSEI) above its 50-day SMA. Fail-closed (no data → no entries).
  const idx = await getOhlc('^NSEI').catch(() => [] as DailyBar[]);
  const regimeOk = idx.length >= 52 && regimeOkFromIndex(idx.map((b) => b.close));
  if (!regimeOk && fixedNotional === 0) { await saveCash(sleeve.id, cash); return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash }; }

  // Candidates = the user's watchlist picks ∪ today's morning-pipeline picks (news-vetted), for this horizon.
  const candidates = opts.candidatesOverride ?? await gatherCandidates(userId, sleeve.portfolioId, p.watchTag, today);
  const held = new Set(heldSymbols);
  const tradedRows = await db.select({ symbol: agentTrades.symbol }).from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.tradeDate, runDate)));
  const tradedToday = new Set(tradedRows.map((r) => r.symbol));

  for (const c of candidates) {
    if (openCount >= p.maxPositions) break;
    if (held.has(c.symbol) || tradedToday.has(c.symbol)) continue;
    const bars = await getOhlc(c.symbol);
    quotes++;
    let entry: number, stopPaisa: number, rule: string, evidence: AgentDecisionEvidence;
    if (fixedNotional > 0) {
      // Validation buy: trust the vetted Stage-2 pick. Stop is VOLATILITY-based
      // (2×ATR), clamped to 4%..10% risk — tight on calm names, room on jumpy ones,
      // NOT a blunt flat %. Requires the name to be Stage 2 right now (safety).
      const closes = bars.map((b) => b.close);
      if (closes.length < 60 || !isStage2(closes)) continue;
      const px = closes[closes.length - 1];
      const a = atr(bars.map((b) => ({ high: b.high, low: b.low, close: b.close })), 14);
      const rawStop = a != null && a > 0 ? px - 2 * a : px * 0.92;
      const stopPx = Math.min(Math.max(rawStop, px * 0.90), px * 0.96);   // clamp: never risk >10% or <4%
      entry = Math.round(px * 100);
      stopPaisa = Math.round(stopPx * 100);
      rule = `validation buy — Stage 2; 2×ATR stop (${((1 - stopPx / px) * 100).toFixed(1)}% risk)`;
      evidence = { rule, inputs: { close: +px.toFixed(2), atr: a != null ? +a.toFixed(2) : 0 }, thresholds: { stopPaisa }, source: 'YAHOO' };
    } else {
      const pick = watchlistPick(bars, regimeOk, { ...PICK_DEFAULTS, stopAtr: p.stopAtr });
      if (!pick) continue;
      entry = pick.entryPaisa; stopPaisa = pick.stopPaisa; rule = pick.rule; evidence = pick.evidence;
    }
    // Validation target = clean 2:1 reward:risk off the actual stop distance; else the horizon %.
    const target = fixedNotional > 0 ? entry + 2 * (entry - stopPaisa) : entry + Math.round((entry * p.targetPct) / 100);
    let qty = fixedNotional > 0
      ? Math.floor(fixedNotional / entry)
      : sizeQty(entry, stopPaisa, 'LONG', { allocationPaisa: sleeve.allocationPaisa, cashBalancePaisa: cash, grossDeployedPaisa: grossDeployed, riskPctPerTrade: p.riskPctPerTrade });
    // Paper money: BUMP high-priced names up to a minimum quantity rather than dropping
    // them — so even a ₹14k share gets a real position. We score by per-pick return %
    // (size-independent), so keeping every leader beats a clean-but-partial book.
    if (fixedNotional > 0) qty = Math.max(qty, VALIDATION_MIN_QTY);
    if (qty < 1 || entry * qty > cash) continue;
    const label = opts.horizon === 'INTRADAY' ? 'intraday pick' : opts.horizon === 'LONG' ? '2-3mo pick' : '2-3d pick';
    const rationale = `${label} → LONG ${c.symbol} @ ₹${(entry / 100).toFixed(2)} — ${rule}; target ₹${(target / 100).toFixed(2)} (+${p.targetPct}%), stop ₹${(stopPaisa / 100).toFixed(2)}.`;
    cash = await persistOpen(userId, sleeve, runId, runDate, {
      symbol: c.symbol, name: c.name, side: 'LONG', entryPaisa: entry, stopPaisa, targetPaisa: target, qty, rationale,
      evidence: { ...evidence, dataAsOf: today, thresholds: { ...evidence.thresholds, targetPaisa: target } },
    }, cash);
    grossDeployed += entry * qty; openCount++; held.add(c.symbol); decisions++; trades++;
  }

  await saveCash(sleeve.id, cash);
  return { sleeveKey: sleeve.key, quotesFetched: quotes, decisions, tradesExecuted: trades, cashBalancePaisa: cash };
}

/** The user's picks for a horizon tag — the portfolio's enabled .NS watchlist entries, deduped. */
/** Watchlist picks ∪ today's morning-pipeline (news-vetted) picks, deduped by symbol. */
async function gatherCandidates(userId: string, portfolioId: number, tag: 'INTRADAY' | 'MULTIDAY', today: string): Promise<PickCandidate[]> {
  const wl = await getMyPicks(portfolioId, tag);
  const daily = await db.select({ symbol: agentDailyPicks.symbol, name: agentDailyPicks.name })
    .from(agentDailyPicks)
    .where(and(eq(agentDailyPicks.userId, userId), eq(agentDailyPicks.pickDate, today), eq(agentDailyPicks.horizon, tag)));
  const seen = new Set(wl.map((w) => w.symbol));
  const out = [...wl];
  for (const d of daily) if (d.symbol.endsWith('.NS') && !seen.has(d.symbol)) { seen.add(d.symbol); out.push({ symbol: d.symbol, name: d.name }); }
  return out;
}

async function getMyPicks(portfolioId: number, tag: 'INTRADAY' | 'MULTIDAY'): Promise<PickCandidate[]> {
  const rows = await db.select({ symbol: agentWatchlist.symbol, name: agentWatchlist.name, horizon: agentWatchlist.horizon })
    .from(agentWatchlist)
    .where(and(eq(agentWatchlist.portfolioId, portfolioId), eq(agentWatchlist.enabled, true), eq(agentWatchlist.assetClass, 'STOCK')));
  const seen = new Set<string>();
  const out: PickCandidate[] = [];
  for (const r of rows) {
    if (r.horizon !== tag || !r.symbol.endsWith('.NS') || seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    out.push({ symbol: r.symbol, name: r.name });
  }
  return out;
}
