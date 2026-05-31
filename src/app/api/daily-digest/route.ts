/**
 * GET /api/daily-digest — returns the current user's portfolio digest
 * as structured JSON. Consumed by the /daily-digest page in the UI.
 *
 * The cron-driven version of this (push to Telegram) runs from
 * /api/cron/tick via runDailyDigestJob — same builder, different
 * dispatch. This endpoint is for interactive viewing.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { buildDailyDigest } from '@/lib/cron/daily-digest';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const digest = await buildDailyDigest(session.user.id);
    return NextResponse.json(digest);
  } catch (err) {
    console.error('[daily-digest]', err);
    return NextResponse.json({ error: 'Failed to build digest' }, { status: 500 });
  }
}
