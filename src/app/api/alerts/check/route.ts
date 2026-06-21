/**
 * POST /api/alerts/check — manually trigger the current user's alert
 * rule evaluation. Useful from the /alerts UI ("Check now" button).
 *
 * The cron-driven version of this runs from /api/cron/tick — same
 * runAlertsCheck() function, different dispatch.
 */
import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { runAlertsCheck } from '@/lib/cron/alerts-check';

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const result = await runAlertsCheck(userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[alerts/check]', err);
    return NextResponse.json({ error: 'Check failed' }, { status: 500 });
  }
}
