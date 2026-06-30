/**
 * Session-bar archive — the replay corpus. Once per day (post square-off) the
 * self-tune job snapshots the intraday bars for the sleeve's universe into
 * agent_session_bars, so the tuner has a lengthening window of real sessions to
 * replay candidate params against. loadWindow() reads the last N sessions back
 * as ReplaySession[] for replayWindow().
 *
 * SAFETY: agent_* tables only. Bars stored in native rupees (as fetched).
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  db, agentSessionBars, agentWatchlist, agentTrades, type AgentSleeve, type AgentBriefBias,
} from '@/db';
import { getIntradayBars } from '@/lib/services/yahoo-finance';
import { getTodayBrief } from '../news/brief';
import { minOfDay, OR_START, SESSION_END } from '../engine/orb-step';
import type { ReplaySession, ReplaySymbol } from './replay';

const inSession = (epoch: number) => minOfDay(epoch) >= OR_START && minOfDay(epoch) <= SESSION_END;

/**
 * Snapshot today's session bars for the sleeve's universe (watchlist ∪ names
 * traded today ∪ today's brief names). Idempotent per (sleeve, date, symbol).
 */
export async function archiveSession(
  userId: string, sleeve: AgentSleeve, runDate: string,
): Promise<{ archived: number; symbols: number }> {
  const wl = await db.select({ symbol: agentWatchlist.symbol }).from(agentWatchlist)
    .where(and(eq(agentWatchlist.userId, userId), eq(agentWatchlist.sleeveId, sleeve.id), eq(agentWatchlist.enabled, true)));
  const traded = await db.selectDistinct({ symbol: agentTrades.symbol }).from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), eq(agentTrades.tradeDate, runDate)));
  const brief = await getTodayBrief().catch(() => []);
  const biasBySym = new Map<string, AgentBriefBias>(brief.map((b) => [b.symbol, b.bias]));

  const symbols = [...new Set([
    ...wl.map((w) => w.symbol),
    ...traded.map((t) => t.symbol),
    ...brief.map((b) => b.symbol).filter((s) => s.endsWith('.NS')),
  ])].filter(Boolean);

  let archived = 0;
  for (const symbol of symbols) {
    const bars = (await getIntradayBars(symbol)).filter((b) => inSession(b.epoch));
    if (!bars.length) continue;
    const bias = biasBySym.get(symbol) ?? null;
    await db.insert(agentSessionBars).values({ userId, sleeveId: sleeve.id, runDate, symbol, barsJson: bars, bias })
      .onConflictDoUpdate({
        target: [agentSessionBars.sleeveId, agentSessionBars.runDate, agentSessionBars.symbol],
        set: { barsJson: bars, bias },
      });
    archived++;
  }
  return { archived, symbols: symbols.length };
}

/** Load the last N archived sessions for a sleeve as replay input (oldest → newest). */
export async function loadWindow(sleeveId: number, lastNDays: number): Promise<ReplaySession[]> {
  const dates = await db.selectDistinct({ runDate: agentSessionBars.runDate }).from(agentSessionBars)
    .where(eq(agentSessionBars.sleeveId, sleeveId))
    .orderBy(desc(agentSessionBars.runDate)).limit(lastNDays);
  if (!dates.length) return [];
  const dateList = dates.map((d) => d.runDate);

  const rows = await db.select().from(agentSessionBars)
    .where(and(eq(agentSessionBars.sleeveId, sleeveId), inArray(agentSessionBars.runDate, dateList)));

  const byDate = new Map<string, ReplaySymbol[]>();
  for (const r of rows) {
    const arr = byDate.get(r.runDate) ?? [];
    arr.push({ symbol: r.symbol, name: r.symbol, bars: r.barsJson, bias: r.bias ?? undefined });
    byDate.set(r.runDate, arr);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))         // oldest → newest
    .map(([runDate, symbols]) => ({ runDate, symbols }));
}
