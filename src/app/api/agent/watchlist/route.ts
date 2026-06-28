/**
 * GET  /api/agent/watchlist — instruments the agent monitors
 * POST /api/agent/watchlist — add an instrument (auto-creates a default
 *                             paper portfolio on first add)
 */

import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, agentPortfolios, agentWatchlist, type AgentAssetClass } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

const CLASSES: AgentAssetClass[] = ['STOCK', 'MF', 'FUTURE'];

async function ensurePortfolio(userId: string) {
  const existing = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (existing) return existing;
  const [created] = await db.insert(agentPortfolios).values({ userId }).returning();
  return created;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select()
      .from(agentWatchlist)
      .where(eq(agentWatchlist.userId, userId))
      .orderBy(desc(agentWatchlist.id));
    return NextResponse.json({ watchlist: rows });
  } catch (err) {
    console.error('GET agent/watchlist:', err);
    return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const assetClass = body.assetClass as AgentAssetClass;
    if (!CLASSES.includes(assetClass)) {
      return NextResponse.json({ error: 'assetClass must be STOCK | MF | FUTURE' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
    const schemeCode = typeof body.schemeCode === 'string' ? body.schemeCode.trim() : '';
    if (assetClass === 'MF' && !schemeCode) {
      return NextResponse.json({ error: 'schemeCode required for MF' }, { status: 400 });
    }
    if (assetClass !== 'MF' && !symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }
    if (!Number.isInteger(body.sleeveId)) {
      return NextResponse.json({ error: 'sleeveId required' }, { status: 400 });
    }

    const portfolio = await ensurePortfolio(userId);
    const [created] = await db
      .insert(agentWatchlist)
      .values({
        userId,
        portfolioId: portfolio.id,
        sleeveId: body.sleeveId,
        assetClass,
        symbol,
        schemeCode,
        isin: typeof body.isin === 'string' ? body.isin.trim() || null : null,
        name,
        contractMultiplier: typeof body.contractMultiplier === 'number' && body.contractMultiplier > 0 ? body.contractMultiplier : 1,
      })
      .onConflictDoNothing({ target: [agentWatchlist.userId, agentWatchlist.sleeveId, agentWatchlist.assetClass, agentWatchlist.symbol, agentWatchlist.schemeCode] })
      .returning();
    if (!created) return NextResponse.json({ error: 'Already in watchlist' }, { status: 409 });
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (err) {
    console.error('POST agent/watchlist:', err);
    return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 });
  }
}
