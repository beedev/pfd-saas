/** GET /api/agent/news — recent news for the user's tracked instruments + "in-play". */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, agentWatchlist } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getRecentNews, getInPlay } from '@/lib/agent/news/ingest';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const wl = await db.select({ symbol: agentWatchlist.symbol }).from(agentWatchlist).where(eq(agentWatchlist.userId, userId));
    const symbols = wl.map((w) => w.symbol).filter(Boolean);
    const [recent, inPlay] = await Promise.all([getRecentNews(symbols.length ? symbols : undefined, 50), getInPlay()]);
    return NextResponse.json({ recent, inPlay });
  } catch (err) {
    console.error('GET agent/news:', err);
    return NextResponse.json({ error: 'Failed to load news' }, { status: 500 });
  }
}
