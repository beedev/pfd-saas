import { NextResponse } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, agentPortfolios, agentSleeves, agentTrades, agentPositions } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getQuotes } from '@/lib/services/yahoo-finance';

/**
 * Algorithm scorecard — measures the 2-3-month validation bucket (STK_SHORT,
 * equal-weight ₹10K per pick). Closed round-trips give realized win-rate / avg
 * return / expectancy; open positions give live unrealized. Equal weight means
 * every pick is directly comparable, so these numbers actually score the algo.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!pf) return NextResponse.json({ closed: null, open: null });
  const sleeve = (await db.select().from(agentSleeves).where(and(eq(agentSleeves.portfolioId, pf.id), eq(agentSleeves.key, 'STK_SHORT'))).limit(1))[0];
  if (!sleeve) return NextResponse.json({ closed: null, open: null });

  // Closed round-trips: SELL trades carry realized P&L; return% ≈ pnl / cost basis.
  const closes = await db.select().from(agentTrades)
    .where(and(eq(agentTrades.sleeveId, sleeve.id), isNotNull(agentTrades.realizedPnlPaisa)));
  const rets = closes.map((t) => {
    const pnl = t.realizedPnlPaisa ?? 0;
    const cost = (t.grossAmountPaisa ?? 0) - pnl;      // sell proceeds − pnl ≈ entry cost
    return { symbol: t.symbol, pnl, retPct: cost > 0 ? (pnl / cost) * 100 : 0 };
  });
  const n = rets.length;
  const wins = rets.filter((r) => r.pnl > 0).length;
  const totalPnl = rets.reduce((a, r) => a + r.pnl, 0);
  const avgRet = n ? rets.reduce((a, r) => a + r.retPct, 0) / n : 0;
  const sorted = [...rets].sort((a, b) => b.retPct - a.retPct);
  const closed = {
    trades: n, winRatePct: n ? (wins / n) * 100 : 0, totalPnlRupees: Math.round(totalPnl / 100),
    avgReturnPct: +avgRet.toFixed(1),
    best: sorted[0] ? { symbol: sorted[0].symbol, retPct: +sorted[0].retPct.toFixed(1) } : null,
    worst: sorted[n - 1] ? { symbol: sorted[n - 1].symbol, retPct: +sorted[n - 1].retPct.toFixed(1) } : null,
  };

  // Open positions: live unrealized via current quotes.
  const positions = await db.select().from(agentPositions).where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id)));
  let unrealized = 0, priced = 0;
  if (positions.length) {
    const qs = await getQuotes(positions.map((p) => p.symbol)).catch(() => []);
    const px = new Map(qs.filter((q) => Number.isFinite(q.regularMarketPrice)).map((q) => [q.symbol, q.regularMarketPrice]));
    for (const p of positions) {
      const cur = px.get(p.symbol);
      if (cur == null) continue;
      unrealized += Math.round((cur * 100 - p.avgPricePaisa) * p.quantity);
      priced++;
    }
  }
  const open = { positions: positions.length, priced, unrealizedRupees: Math.round(unrealized / 100) };

  return NextResponse.json({ closed, open });
}
