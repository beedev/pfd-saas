/** DELETE /api/agent/watchlist/[id] — remove an instrument from the watchlist. */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, agentWatchlist } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await db.delete(agentWatchlist).where(and(eq(agentWatchlist.id, numericId), eq(agentWatchlist.userId, userId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE agent/watchlist:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
