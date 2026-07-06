/**
 * Pure ORB decision core — the same-day Opening-Range-Breakout logic with NO
 * database or network I/O. Both the live runner (`run-intraday.ts`) and the
 * tuning replay (`tuning/replay.ts`) call `planIntradayTick()` so a parameter
 * tuned offline behaves byte-identically when it goes live. Mirrors the
 * "same code in live + backtest" pattern already used by `engine/risk.ts`.
 *
 * Given a snapshot (per-symbol session bars + open positions + running capital
 * caps + today's brief bias), it returns the ordered Intents for this tick and
 * the resulting cash. Persistence + fetching stay in the caller. Money in paisa.
 */

import type { IntradayBar } from '@/lib/services/yahoo-finance';
import { DEFAULT_COST_MODEL, tradeCostPaisa, cgTaxPaisa } from '../backtest/costs';
import type { AgentBriefBias, AgentDecisionEvidence } from '@/db';

// IST is a fixed UTC+5:30 offset (no DST) → minutes-of-day from epoch directly.
export const IST_OFFSET = 19800; // 5.5h in seconds
export const minOfDay = (epoch: number) => Math.floor(((epoch + IST_OFFSET) % 86400) / 60);
export const hhmm = (epoch: number) => {
  const m = (epoch + IST_OFFSET) % 86400; // seconds-of-day in IST
  return `${String(Math.floor(m / 3600)).padStart(2, '0')}:${String(Math.floor((m % 3600) / 60)).padStart(2, '0')}`;
};

export const OR_START = 9 * 60 + 15;    // 09:15
export const OR_END = 9 * 60 + 45;      // 09:45 — opening range = [09:15, 09:45)
export const LAST_ENTRY = 14 * 60 + 30; // 14:30 — no new entries after this
export const SQUARE_OFF = 15 * 60 + 15; // 15:15 — force flat
export const SESSION_END = 15 * 60 + 30; // 15:30 — last bar of interest

// Minimum viable position = 5% of the sleeve. Below this a trade just pays the
// round-trip cost for ~zero exposure (the useless 1-2 share scraps), so skip it.
export const MIN_NOTIONAL_PCT = 5;

export interface OrbParams {
  openingRangeMins: number;
  riskPctPerTrade: number;
  targetR: number;
  maxConcurrent: number;
  trailAfterTarget?: boolean;   // once the target is hit, DON'T exit — trail a stop up instead (momentum: ride trend days)
  trailAtrMult?: number;        // trailing distance = N × intraday ATR below the running high (floored at the target)
}
export const ORB_DEFAULTS: OrbParams = { openingRangeMins: 30, riskPctPerTrade: 0.75, targetR: 1.5, maxConcurrent: 5, trailAfterTarget: true, trailAtrMult: 1.5 };

/** Simple intraday ATR proxy (avg high-low over the last ~14 bars), in paisa. */
function intradayAtrPaisa(bars: IntradayBar[]): number {
  const recent = bars.slice(-14);
  if (!recent.length) return 0;
  return Math.round((recent.reduce((a, b) => a + (b.high - b.low), 0) / recent.length) * 100);
}

/** Resolve a sleeve's stored params over the defaults. */
export function resolveOrbParams(paramsJson: Record<string, unknown> | null | undefined): OrbParams {
  return { ...ORB_DEFAULTS, ...((paramsJson as Partial<OrbParams>) ?? {}) };
}

/** Minimal open-position view the planner needs (DB id stays in the caller). */
export interface PositionLite {
  side: 'LONG' | 'SHORT';
  quantity: number;
  contractMultiplier: number;
  avgPricePaisa: number;
  openedDate: string;
}

export interface UniverseEntry {
  symbol: string;
  name: string;
  watchlistId?: number;
  bars: IntradayBar[];      // already filtered to [OR_START, SESSION_END]
  position?: PositionLite;  // existing open position for this symbol, if any
  tradedToday: boolean;     // already opened+closed this name today (no re-entry)
  bias?: AgentBriefBias;    // today's pre-market directional stance
}

export interface TickSnapshot {
  now: number;              // IST minutes-of-day
  runDate: string;          // IST YYYY-MM-DD
  marketOpen: boolean;
  allocationPaisa: number;
  cashBalancePaisa: number;
  grossDeployedPaisa: number;
  openCount: number;
  universe: UniverseEntry[];
  params: OrbParams;
}

export interface CloseIntent {
  kind: 'CLOSE';
  symbol: string; name: string; watchlistId?: number;
  side: 'LONG' | 'SHORT';
  action: 'BUY' | 'SELL';   // long exit = SELL; short cover = BUY
  qty: number;
  entryPaisa: number; exitPaisa: number;
  orHigh: number; orLow: number; stopPaisa: number; targetPaisa: number;
  notionalPaisa: number; grossPnlPaisa: number; costPaisa: number; taxPaisa: number; realizedPnlPaisa: number;
  reason: string; asOf: string;
  rationale: string; evidence: AgentDecisionEvidence;
}

export interface OpenIntent {
  kind: 'OPEN';
  symbol: string; name: string; watchlistId?: number;
  side: 'LONG' | 'SHORT';
  action: 'BUY' | 'SELL';   // long open = BUY; short open = SELL-to-open
  qty: number;
  entryPaisa: number; stopPaisa: number; targetPaisa: number; orHigh: number; orLow: number;
  notionalPaisa: number; asOf: string;
  rationale: string; evidence: AgentDecisionEvidence;
}

export type Intent = CloseIntent | OpenIntent;

export interface TickPlan {
  intents: Intent[];
  finalCashPaisa: number;
  quotes: number;           // symbols with usable bars (the live quotesFetched count)
}

/**
 * Decide this tick's actions. Pure — threads cash / gross-exposure / open-count
 * across the universe exactly as the live loop did, so a CLOSE that frees cash
 * is available to a later symbol's OPEN within the same tick.
 */
export function planIntradayTick(snap: TickSnapshot): TickPlan {
  const p = snap.params;
  const now = snap.now;
  let cash = snap.cashBalancePaisa;
  let openCount = snap.openCount;
  let grossDeployed = snap.grossDeployedPaisa;
  const perNameCapPaisa = Math.round(snap.allocationPaisa * 0.30);
  const minNotionalPaisa = Math.round((snap.allocationPaisa * MIN_NOTIONAL_PCT) / 100);
  const intents: Intent[] = [];
  let quotes = 0;

  for (const w of snap.universe) {
    if (!w.symbol) continue;
    const bars = w.bars;
    if (!bars.length) continue;
    quotes++;

    const orBars = bars.filter((b) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) < OR_END);
    const last = bars[bars.length - 1];
    const lastPx = Math.round(last.close * 100);
    const asOf = hhmm(last.epoch);
    const existing = w.position;

    // ---- Manage an open position --------------------------------------------
    if (existing) {
      const orHigh = orBars.length ? Math.round(Math.max(...orBars.map((b) => b.high)) * 100) : existing.avgPricePaisa;
      const orLow = orBars.length ? Math.round(Math.min(...orBars.map((b) => b.low)) * 100) : existing.avgPricePaisa;
      const long = existing.side === 'LONG';
      const origStop = long ? orLow : orHigh;
      const target = long
        ? existing.avgPricePaisa + Math.round((existing.avgPricePaisa - orLow) * p.targetR)
        : existing.avgPricePaisa - Math.round((orHigh - existing.avgPricePaisa) * p.targetR);
      // Trailing after target (momentum): once the session has REACHED the target, stop
      // exiting at it — trail a stop N×ATR below the running high (above the low for shorts),
      // floored at the target so the gain is locked but trend days can run to square-off.
      const sessHigh = Math.round(Math.max(...bars.map((b) => b.high)) * 100);
      const sessLow = Math.round(Math.min(...bars.map((b) => b.low)) * 100);
      const targetHit = long ? sessHigh >= target : sessLow <= target;
      const trailing = !!p.trailAfterTarget && targetHit;
      const trailStop = trailing
        ? (long ? Math.max(target, sessHigh - Math.round((p.trailAtrMult ?? 1.5) * intradayAtrPaisa(bars)))
                : Math.min(target, sessLow + Math.round((p.trailAtrMult ?? 1.5) * intradayAtrPaisa(bars))))
        : null;
      const stop = trailStop ?? origStop;
      const stale = existing.openedDate !== snap.runDate;
      const forceOut = now >= SQUARE_OFF || !snap.marketOpen || stale;
      const hitStop = long ? lastPx <= stop : lastPx >= stop;
      // With trailing ON the target no longer triggers an exit — it only arms the trail.
      const hitTarget = !p.trailAfterTarget && (long ? lastPx >= target : lastPx <= target);

      if (forceOut || hitStop || hitTarget) {
        const reason = stale ? 'overnight safety square-off' : !snap.marketOpen ? 'market closed — square-off'
          : now >= SQUARE_OFF ? '15:15 square-off'
          : hitTarget ? 'target hit'
          : trailing ? 'trailing stop hit (rode past target)'
          : 'stop hit';
        const qty = existing.quantity;
        const notional = Math.round(lastPx * qty * existing.contractMultiplier);
        const grossPnl = Math.round((long ? lastPx - existing.avgPricePaisa : existing.avgPricePaisa - lastPx) * qty * existing.contractMultiplier);
        const cost = tradeCostPaisa(notional, 'STOCK', true, 0, DEFAULT_COST_MODEL); // holdingDays 0 → intraday rates
        const tax = cgTaxPaisa(grossPnl, 0, DEFAULT_COST_MODEL);
        const realized = grossPnl - cost - tax;
        const action: 'BUY' | 'SELL' = long ? 'SELL' : 'BUY';
        const ev: AgentDecisionEvidence = {
          rule: `ORB exit: ${reason}`,
          inputs: { entryPaisa: existing.avgPricePaisa, exitPaisa: lastPx, orHigh, orLow, side: existing.side },
          sizing: { qty, stopPaisa: stop, targetPaisa: target, costPaisa: cost, taxPaisa: tax, realizedPnlPaisa: realized },
          source: 'YAHOO', dataAsOf: asOf,
        };
        const rationale = `${reason}: ${existing.side} ${w.symbol} exit @ ₹${(lastPx / 100).toFixed(2)} (${asOf}) → ${realized >= 0 ? 'profit' : 'loss'} ₹${Math.round(realized / 100)}.`;
        intents.push({
          kind: 'CLOSE', symbol: w.symbol, name: w.name, watchlistId: w.watchlistId, side: existing.side, action,
          qty, entryPaisa: existing.avgPricePaisa, exitPaisa: lastPx, orHigh, orLow, stopPaisa: stop, targetPaisa: target,
          notionalPaisa: notional, grossPnlPaisa: grossPnl, costPaisa: cost, taxPaisa: tax, realizedPnlPaisa: realized,
          reason, asOf, rationale, evidence: ev,
        });
        // LONG: get sale proceeds back; SHORT: only the realized P&L (no cash moved at entry).
        cash += long ? notional - cost - tax : realized;
        openCount--;
      }
      continue;
    }

    // ---- Consider a new entry ----------------------------------------------
    if (!snap.marketOpen || now < OR_END || now >= LAST_ENTRY || orBars.length < 3 || openCount >= p.maxConcurrent) continue;
    if (w.tradedToday) continue;

    const orHigh = Math.round(Math.max(...orBars.map((b) => b.high)) * 100);
    const orLow = Math.round(Math.min(...orBars.map((b) => b.low)) * 100);
    const long = lastPx > orHigh;
    const short = lastPx < orLow;
    if (!long && !short) continue;
    // Pre-market brief gate: don't fight the news. BULLISH → long breakouts only;
    // BEARISH → shorts only; NEUTRAL / no view → either side.
    const bias = w.bias;
    if (bias === 'BULLISH' && short) continue;
    if (bias === 'BEARISH' && long) continue;

    const entry = lastPx;
    const stop = long ? orLow : orHigh;
    const riskUnit = Math.abs(entry - stop);
    if (riskUnit <= 0) continue;
    // Capital room: never exceed the corpus in total, nor 30% in one name.
    const room = Math.min(perNameCapPaisa, snap.allocationPaisa - grossDeployed);
    if (room < entry) continue; // no room for even one unit
    const riskBudget = Math.round((snap.allocationPaisa * p.riskPctPerTrade) / 100);
    let qty = Math.floor(riskBudget / riskUnit);
    qty = Math.min(qty, Math.floor(room / entry));            // gross + per-name cap
    if (long) qty = Math.min(qty, Math.floor(cash / entry));  // longs also bounded by cash
    if (qty < 1) continue;

    const notional = entry * qty;
    // Minimum-viable-position gate: a position below 5% of the sleeve just pays
    // the round-trip cost for ~zero exposure — skip it rather than take a scrap.
    if (notional < minNotionalPaisa) continue;
    const target = long ? entry + Math.round(riskUnit * p.targetR) : entry - Math.round(riskUnit * p.targetR);
    const action: 'BUY' | 'SELL' = long ? 'BUY' : 'SELL';
    const ev: AgentDecisionEvidence = {
      rule: long ? 'ORB long: price > opening-range high' : 'ORB short: price < opening-range low',
      inputs: { orHigh, orLow, lastPrice: entry, rangePaisa: orHigh - orLow, openingRangeMins: p.openingRangeMins },
      thresholds: { breakoutLevelPaisa: long ? orHigh : orLow },
      sizing: { riskPct: p.riskPctPerTrade, qty, entryPaisa: entry, stopPaisa: stop, targetPaisa: target },
      source: 'YAHOO', dataAsOf: asOf,
    };
    const rationale = `${long ? 'LONG' : 'SHORT'} ${w.symbol} @ ₹${(entry / 100).toFixed(2)} (${asOf}) — broke ${long ? 'above' : 'below'} OR ${long ? 'high' : 'low'} ₹${((long ? orHigh : orLow) / 100).toFixed(2)}; stop ₹${(stop / 100).toFixed(2)}, target ₹${(target / 100).toFixed(2)}.`;
    intents.push({
      kind: 'OPEN', symbol: w.symbol, name: w.name, watchlistId: w.watchlistId, side: long ? 'LONG' : 'SHORT', action,
      qty, entryPaisa: entry, stopPaisa: stop, targetPaisa: target, orHigh, orLow, notionalPaisa: notional, asOf, rationale, evidence: ev,
    });
    if (long) cash -= notional; // shorts tie up paper margin, not cash
    grossDeployed += notional;
    openCount++;
  }

  return { intents, finalCashPaisa: cash, quotes };
}
