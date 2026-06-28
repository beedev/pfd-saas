/** GET /api/agent/positions — open paper positions for the user's portfolio. */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, agentPositions } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select()
      .from(agentPositions)
      .where(eq(agentPositions.userId, userId))
      .orderBy(desc(agentPositions.marketValuePaisa));
    return NextResponse.json({ positions: rows });
  } catch (err) {
    console.error('GET agent/positions:', err);
    return NextResponse.json({ error: 'Failed to load positions' }, { status: 500 });
  }
}
