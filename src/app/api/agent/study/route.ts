import { NextResponse } from 'next/server';
import { asc, desc, eq } from 'drizzle-orm';
import { db, agentDailySnapshots, agentRunHealth } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

/** Forward-test study data — the equity time series + the run-health log. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const snaps = await db.select().from(agentDailySnapshots).where(eq(agentDailySnapshots.userId, userId)).orderBy(asc(agentDailySnapshots.snapshotDate));
  const curve = snaps.map((s) => ({
    date: s.snapshotDate,
    equity: Math.round(s.equityPaisa / 100),
    unrealized: Math.round((s.unrealizedPaisa ?? 0) / 100),
    realized: Math.round((s.realizedCumPaisa ?? 0) / 100),
    openPositions: s.openPositions ?? 0,
    closedTrades: s.closedTrades ?? 0,
    winRatePct: s.winRatePct ?? 0,
    drawdownPct: s.drawdownPct ?? 0,
  }));
  const first = curve[0], last = curve[curve.length - 1];
  const summary = last ? {
    days: curve.length,
    equity: last.equity,
    totalReturnPct: first && first.equity > 0 ? +(((last.equity - first.equity) / first.equity) * 100).toFixed(2) : 0,
    maxDrawdownPct: Math.min(0, ...curve.map((c) => c.drawdownPct)),
    winRatePct: last.winRatePct,
    closedTrades: last.closedTrades,
    openPositions: last.openPositions,
  } : null;

  const health = (await db.select().from(agentRunHealth).where(eq(agentRunHealth.userId, userId)).orderBy(desc(agentRunHealth.runDate)).limit(30))
    .map((h) => ({ date: h.runDate, status: h.status, considered: h.considered ?? 0, picked: h.picked ?? 0, bhavRows: h.bhavRows ?? 0, screenCount: h.screenCount ?? 0, quotesOk: h.quotesOk ?? false, note: h.note ?? '' }));

  return NextResponse.json({ summary, curve, health });
}
