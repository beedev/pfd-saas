/** GET /api/agent/trades — paper-trade ledger (newest first). */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, agentTrades } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select()
      .from(agentTrades)
      .where(eq(agentTrades.userId, userId))
      .orderBy(desc(agentTrades.id))
      .limit(200);
    return NextResponse.json({ trades: rows });
  } catch (err) {
    console.error('GET agent/trades:', err);
    return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });
  }
}
