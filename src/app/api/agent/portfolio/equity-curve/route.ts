/**
 * GET /api/agent/portfolio/equity-curve — daily equity vs benchmark series for
 * the user's portfolio (from price_snapshots, AGENT_EQUITY / AGENT_BENCHMARK).
 */

import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db, agentPortfolios, priceSnapshots } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { agentEquitySymbol, agentBenchmarkSymbol } from '@/lib/agent/engine/equity-curve';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const portfolio = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
    if (!portfolio) return NextResponse.json({ equity: [], benchmark: [] });

    const series = async (symbol: string) =>
      db
        .select({ date: priceSnapshots.priceDate, price: priceSnapshots.price })
        .from(priceSnapshots)
        .where(and(eq(priceSnapshots.userId, userId), eq(priceSnapshots.assetSymbol, symbol)))
        .orderBy(asc(priceSnapshots.priceDate));

    const [equity, benchmark] = await Promise.all([
      series(agentEquitySymbol(portfolio.id)),
      series(agentBenchmarkSymbol(portfolio.id)),
    ]);
    return NextResponse.json({ equity, benchmark, startingCapitalPaisa: portfolio.startingCapitalPaisa });
  } catch (err) {
    console.error('GET agent/equity-curve:', err);
    return NextResponse.json({ error: 'Failed to load equity curve' }, { status: 500 });
  }
}
