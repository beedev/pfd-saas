/** GET /api/agent/runs — daily run history (newest first). */
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, agentRuns } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.userId, userId))
      .orderBy(desc(agentRuns.runDate))
      .limit(60);
    return NextResponse.json({ runs: rows });
  } catch (err) {
    console.error('GET agent/runs:', err);
    return NextResponse.json({ error: 'Failed to load runs' }, { status: 500 });
  }
}
