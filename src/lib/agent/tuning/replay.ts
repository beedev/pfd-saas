/**
 * Deterministic intraday replay — re-runs a trading day's 5-min bars through the
 * SAME pure ORB core the live sleeve uses (`planIntradayTick`), under a candidate
 * parameter set, and returns the net-of-cost edge it WOULD have produced. This is
 * the "challenger" in champion-vs-challenger tuning: no second live sleeve, no
 * extra Yahoo load, no capital fiction — just the champion's own bars scored
 * under different knobs.
 *
 * Because champion and challenger replay through identical bars at identical
 * cadence, any imperfection in reproducing exact live tick prices cancels out of
 * the comparison — the DELTA between two param sets is what the tuner trusts.
 *
 * Pure. Money in paisa.
 */

import type { IntradayBar } from '@/lib/services/yahoo-finance';
import type { AgentBriefBias } from '@/db';
import {
  planIntradayTick, minOfDay, OR_START, OR_END, SESSION_END,
  type OrbParams, type PositionLite, type UniverseEntry,
} from '../engine/orb-step';
import { computeEdge, type ClosedTrade, type EdgeMetrics } from './metrics';

export interface ReplaySymbol {
  symbol: string;
  name: string;
  watchlistId?: number;
  bars: IntradayBar[];        // the day's session bars (unordered ok; filtered here)
  bias?: AgentBriefBias;      // that day's pre-market stance for this symbol
}

export interface ReplayInput {
  runDate: string;            // IST YYYY-MM-DD of the session being replayed
  allocationPaisa: number;
  cadenceMin?: number;        // tick step; default 10 = live cron cadence
  symbols: ReplaySymbol[];
  params: OrbParams;
}

export interface ReplayResult {
  metrics: EdgeMetrics;
  closedTrades: ClosedTrade[];
  finalCashPaisa: number;
}

type SimPosition = PositionLite & { name: string; watchlistId?: number };

/** Replay one session under `params`. Starts flat with full allocation as cash. */
export function replayDay(input: ReplayInput): ReplayResult {
  const cadence = input.cadenceMin ?? 10;
  const positions = new Map<string, SimPosition>();
  const tradedToday = new Set<string>();
  const closed: ClosedTrade[] = [];
  let cash = input.allocationPaisa;

  const inSession = (b: IntradayBar) => minOfDay(b.epoch) >= OR_START && minOfDay(b.epoch) <= SESSION_END;

  const step = (now: number, marketOpen: boolean) => {
    const grossDeployed = [...positions.values()]
      .reduce((a, p) => a + Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier), 0);
    const universe: UniverseEntry[] = input.symbols.map((s) => ({
      symbol: s.symbol, name: s.name, watchlistId: s.watchlistId,
      bars: s.bars.filter((b) => inSession(b) && minOfDay(b.epoch) <= now),
      position: positions.get(s.symbol),
      tradedToday: tradedToday.has(s.symbol),
      bias: s.bias,
    }));
    const plan = planIntradayTick({
      now, runDate: input.runDate, marketOpen, allocationPaisa: input.allocationPaisa,
      cashBalancePaisa: cash, grossDeployedPaisa: grossDeployed, openCount: positions.size, universe, params: input.params,
    });
    for (const it of plan.intents) {
      if (it.kind === 'OPEN') {
        positions.set(it.symbol, {
          side: it.side, quantity: it.qty, contractMultiplier: 1, avgPricePaisa: it.entryPaisa,
          openedDate: input.runDate, name: it.name, watchlistId: it.watchlistId,
        });
        tradedToday.add(it.symbol);
      } else {
        positions.delete(it.symbol);
        closed.push({
          symbol: it.symbol, side: it.side, exitReason: it.reason,
          grossPnlPaisa: it.grossPnlPaisa, costPaisa: it.costPaisa, taxPaisa: it.taxPaisa,
          realizedPnlPaisa: it.realizedPnlPaisa, oneRPaisa: Math.abs(it.entryPaisa - it.stopPaisa) * it.qty,
        });
      }
    }
    cash = plan.finalCashPaisa;
  };

  // Walk ticks from the opening-range close to session end at the live cadence.
  for (let now = OR_END; now <= SESSION_END; now += cadence) step(now, true);
  // Guarantee flat: a final market-closed tick squares off anything left open
  // (planner already squares off at 15:15, but this is robust to any cadence).
  if (positions.size) step(SESSION_END, false);

  return { metrics: computeEdge(closed), closedTrades: closed, finalCashPaisa: cash };
}
