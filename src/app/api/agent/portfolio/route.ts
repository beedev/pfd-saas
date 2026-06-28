/**
 * GET  /api/agent/portfolio  — portfolio summary (cash, equity, P&L, settings)
 * POST /api/agent/portfolio  — create/update the paper portfolio + agent settings
 *
 * Money in the body is rupees; converted to paisa at the boundary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, agentPortfolios, agentPositions, type AgentRiskProfile } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

const RISK: AgentRiskProfile[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const portfolio = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
    if (!portfolio) return NextResponse.json({ portfolio: null });

    const positions = await db.select().from(agentPositions).where(eq(agentPositions.portfolioId, portfolio.id));
    const positionsValue = positions.reduce(
      (s, p) => s + (p.marketValuePaisa ?? Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier)),
      0,
    );
    const unrealizedPnl = positions.reduce((s, p) => s + (p.unrealizedPnlPaisa ?? 0), 0);
    const equityPaisa = portfolio.cashBalancePaisa + positionsValue;
    const totalPnlPaisa = equityPaisa - portfolio.startingCapitalPaisa;
    const returnPct = portfolio.startingCapitalPaisa > 0
      ? (totalPnlPaisa / portfolio.startingCapitalPaisa) * 100
      : 0;

    return NextResponse.json({
      portfolio,
      summary: {
        equityPaisa,
        cashPaisa: portfolio.cashBalancePaisa,
        positionsValuePaisa: positionsValue,
        totalPnlPaisa,
        unrealizedPnlPaisa: unrealizedPnl,
        returnPct,
        openPositions: positions.length,
      },
    });
  } catch (err) {
    console.error('GET agent/portfolio:', err);
    return NextResponse.json({ error: 'Failed to load portfolio' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const existing = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.benchmarkSymbol === 'string' && body.benchmarkSymbol.trim()) update.benchmarkSymbol = body.benchmarkSymbol.trim();
    if (RISK.includes(body.riskProfile)) update.riskProfile = body.riskProfile;
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;
    if (typeof body.telegramEnabled === 'boolean') update.telegramEnabled = body.telegramEnabled;
    if (Number.isInteger(body.maxPositions) && body.maxPositions > 0) update.maxPositions = body.maxPositions;
    if (typeof body.perPositionPct === 'number' && body.perPositionPct > 0) update.perPositionPct = body.perPositionPct;
    if (typeof body.cashBufferPct === 'number' && body.cashBufferPct >= 0) update.cashBufferPct = body.cashBufferPct;

    if (!existing) {
      // Create: seed cash = starting capital (default ₹10,00,000 unless supplied).
      const startingPaisa = typeof body.startingCapital === 'number' && body.startingCapital > 0
        ? Math.round(body.startingCapital * 100)
        : 100000000;
      const [created] = await db
        .insert(agentPortfolios)
        .values({
          userId,
          name: (update.name as string) ?? 'Paper Portfolio',
          startingCapitalPaisa: startingPaisa,
          cashBalancePaisa: startingPaisa,
          benchmarkSymbol: (update.benchmarkSymbol as string) ?? '^NSEI',
          riskProfile: (update.riskProfile as AgentRiskProfile) ?? 'BALANCED',
          enabled: (update.enabled as boolean) ?? false,
          telegramEnabled: (update.telegramEnabled as boolean) ?? true,
          maxPositions: (update.maxPositions as number) ?? 12,
          perPositionPct: (update.perPositionPct as number) ?? 8,
          cashBufferPct: (update.cashBufferPct as number) ?? 10,
        })
        .returning();
      return NextResponse.json({ portfolio: created }, { status: 201 });
    }

    // Update: allow resetting starting capital ONLY when there are no positions/trades yet.
    if (typeof body.startingCapital === 'number' && body.startingCapital > 0) {
      const positions = await db.select().from(agentPositions).where(eq(agentPositions.portfolioId, existing.id));
      if (positions.length === 0) {
        const startingPaisa = Math.round(body.startingCapital * 100);
        update.startingCapitalPaisa = startingPaisa;
        update.cashBalancePaisa = startingPaisa;
      }
    }
    const [updated] = await db.update(agentPortfolios).set(update).where(eq(agentPortfolios.id, existing.id)).returning();
    return NextResponse.json({ portfolio: updated });
  } catch (err) {
    console.error('POST agent/portfolio:', err);
    return NextResponse.json({ error: 'Failed to save portfolio' }, { status: 500 });
  }
}
