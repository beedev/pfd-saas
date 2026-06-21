/**
 * GET /api/daily-digest — returns the current user's portfolio digest
 * as structured JSON. Consumed by the /daily-digest page in the UI.
 *
 * The cron-driven version of this (push to Telegram) runs from
 * /api/cron/tick via runDailyDigestJob — same builder, different
 * dispatch. This endpoint is for interactive viewing.
 */
import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { buildDailyDigest } from '@/lib/cron/daily-digest';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const digest = await buildDailyDigest(userId);
    return NextResponse.json(digest);
  } catch (err) {
    console.error('[daily-digest]', err);
    return NextResponse.json({ error: 'Failed to build digest' }, { status: 500 });
  }
}
