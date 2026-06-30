/**
 * GET  /api/agent/brief — today's pre-market directional brief (buy/short list).
 * POST /api/agent/brief — build it now (manual; normally the 07:30 IST cron).
 */
import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getTodayBrief, runPremarketBrief } from '@/lib/agent/news/brief';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    return NextResponse.json({ brief: await getTodayBrief() });
  } catch (err) {
    console.error('GET agent/brief:', err);
    return NextResponse.json({ error: 'Failed to load brief' }, { status: 500 });
  }
}

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    return NextResponse.json(await runPremarketBrief());
  } catch (err) {
    console.error('POST agent/brief:', err);
    return NextResponse.json({ error: 'Brief failed' }, { status: 500 });
  }
}
