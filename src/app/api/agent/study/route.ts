import { NextResponse } from 'next/server';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { db, agentDailySnapshots, agentRunHealth, agentSleeveSnapshots, agentSleeves, agentPortfolios, agentTrades, agentPositions } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

/**
 * Forward-test study data. Returns:
 *  • portfolio: daily equity curve + summary (all sleeves combined) — the headline.
 *  • sleeves:   per-bucket curve + summary + win rate (so the momentum book can be
 *               read on its own, not mixed with the intraday experiments).
 *  • trades:    the closed round-trips behind the win rate (traceable detail).
 *  • health:    the run-health log.
 * Read-only.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  // ── Portfolio daily curve + summary (headline) ──
  const snaps = await db.select().from(agentDailySnapshots).where(eq(agentDailySnapshots.userId, userId)).orderBy(asc(agentDailySnapshots.snapshotDate));
  const curve = snaps.map((s) => ({
    date: s.snapshotDate, equity: Math.round(s.equityPaisa / 100),
    unrealized: Math.round((s.unrealizedPaisa ?? 0) / 100), realized: Math.round((s.realizedCumPaisa ?? 0) / 100),
    openPositions: s.openPositions ?? 0, closedTrades: s.closedTrades ?? 0, winRatePct: s.winRatePct ?? 0, drawdownPct: s.drawdownPct ?? 0,
  }));
  const first = curve[0], last = curve[curve.length - 1];
  const summary = last ? {
    days: curve.length, equity: last.equity,
    totalReturnPct: first && first.equity > 0 ? +(((last.equity - first.equity) / first.equity) * 100).toFixed(2) : 0,
    maxDrawdownPct: Math.min(0, ...curve.map((c) => c.drawdownPct)),
    winRatePct: last.winRatePct, closedTrades: last.closedTrades, openPositions: last.openPositions,
  } : null;

  // ── Per-sleeve (bucket filter) ──
  const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  const sleeveRows = pf ? await db.select().from(agentSleeves).where(eq(agentSleeves.portfolioId, pf.id)) : [];
  const sleeveById = new Map(sleeveRows.map((s) => [s.id, s]));
  const sSnaps = await db.select().from(agentSleeveSnapshots).where(eq(agentSleeveSnapshots.userId, userId)).orderBy(asc(agentSleeveSnapshots.snapshotDate));
  const closedAll = await db.select().from(agentTrades).where(and(eq(agentTrades.userId, userId), isNotNull(agentTrades.realizedPnlPaisa))).orderBy(desc(agentTrades.tradeDate));
  const openPos = await db.select().from(agentPositions).where(eq(agentPositions.userId, userId));

  const sleeves = sleeveRows.filter((s) => s.enabled).map((s) => {
    const scurve = sSnaps.filter((x) => x.sleeveId === s.id).map((x) => ({
      date: x.snapshotDate, equity: Math.round(x.equityPaisa / 100),
      realized: Math.round((x.dailyRealizedPaisa ?? 0) / 100), openPositions: x.openPositions ?? 0, drawdownPct: 0,
    }));
    // per-sleeve drawdown from its equity series
    let peak = -Infinity, dd = 0;
    for (let i = 0; i < scurve.length; i++) { peak = Math.max(peak, scurve[i].equity); if (peak > 0) { scurve[i].drawdownPct = +(((scurve[i].equity - peak) / peak) * 100).toFixed(2); dd = Math.min(dd, scurve[i].drawdownPct); } }
    const st = closedAll.filter((t) => t.sleeveId === s.id);
    const wins = st.filter((t) => (t.realizedPnlPaisa ?? 0) > 0).length;
    const corpus = Math.round(s.allocationPaisa / 100);
    const lastEq = scurve.length ? scurve[scurve.length - 1].equity : corpus;
    return {
      id: s.id, key: s.key, name: s.name, curve: scurve,
      days: scurve.length, equity: lastEq, corpus,
      totalReturnPct: corpus > 0 ? +(((lastEq - corpus) / corpus) * 100).toFixed(2) : 0,
      maxDrawdownPct: +dd.toFixed(2),
      closedTrades: st.length, winRatePct: st.length ? +((wins / st.length) * 100).toFixed(1) : 0,
      openPositions: openPos.filter((p) => p.sleeveId === s.id).length,
    };
  });

  // ── Closed round-trips behind the win rate ──
  const trades = closedAll.slice(0, 120).map((t) => ({
    date: t.tradeDate, sleeveId: t.sleeveId ?? 0, sleeveName: sleeveById.get(t.sleeveId ?? 0)?.name ?? '—',
    symbol: t.symbol, side: t.side, qty: t.quantity, exitPaisa: t.pricePerUnitPaisa, realizedPaisa: t.realizedPnlPaisa ?? 0,
  }));

  const health = (await db.select().from(agentRunHealth).where(eq(agentRunHealth.userId, userId)).orderBy(desc(agentRunHealth.runDate)).limit(30))
    .map((h) => ({ date: h.runDate, status: h.status, considered: h.considered ?? 0, picked: h.picked ?? 0, bhavRows: h.bhavRows ?? 0, screenCount: h.screenCount ?? 0, quotesOk: h.quotesOk ?? false, note: h.note ?? '' }));

  return NextResponse.json({ summary, curve, sleeves, trades, health });
}
