/** POST /api/agent/news/ingest — manually poll the RSS feeds now (for testing). */
import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { runNewsIngest } from '@/lib/agent/news/ingest';

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const result = await runNewsIngest();
    return NextResponse.json(result);
  } catch (err) {
    console.error('POST agent/news/ingest:', err);
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 });
  }
}
