/** GET /api/agent/decisions — agent decisions + rationale (newest first). */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, agentDecisions } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.userId, userId))
      .orderBy(desc(agentDecisions.id))
      .limit(100);
    return NextResponse.json({ decisions: rows });
  } catch (err) {
    console.error('GET agent/decisions:', err);
    return NextResponse.json({ error: 'Failed to load decisions' }, { status: 500 });
  }
}
