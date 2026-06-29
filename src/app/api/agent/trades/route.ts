/** GET /api/agent/trades — paper-trade ledger (newest first), with bucket name. */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, agentTrades, agentSleeves } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select({
        id: agentTrades.id, sleeveId: agentTrades.sleeveId,
        sleeveName: agentSleeves.name, sleeveKey: agentSleeves.key,
        type: agentTrades.type, side: agentTrades.side, assetClass: agentTrades.assetClass,
        symbol: agentTrades.symbol, schemeCode: agentTrades.schemeCode, name: agentTrades.name,
        quantity: agentTrades.quantity, pricePerUnitPaisa: agentTrades.pricePerUnitPaisa,
        grossAmountPaisa: agentTrades.grossAmountPaisa, netAmountPaisa: agentTrades.netAmountPaisa,
        realizedPnlPaisa: agentTrades.realizedPnlPaisa, tradeDate: agentTrades.tradeDate, createdAt: agentTrades.createdAt,
      })
      .from(agentTrades)
      .leftJoin(agentSleeves, eq(agentSleeves.id, agentTrades.sleeveId))
      .where(eq(agentTrades.userId, userId))
      .orderBy(desc(agentTrades.id))
      .limit(300);
    return NextResponse.json({ trades: rows });
  } catch (err) {
    console.error('GET agent/trades:', err);
    return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });
  }
}
