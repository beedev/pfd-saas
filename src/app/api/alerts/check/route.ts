/**
 * POST /api/alerts/check — manually trigger the current user's alert
 * rule evaluation. Useful from the /alerts UI ("Check now" button).
 *
 * The cron-driven version of this runs from /api/cron/tick — same
 * runAlertsCheck() function, different dispatch.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { runAlertsCheck } from '@/lib/cron/alerts-check';

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const result = await runAlertsCheck(session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[alerts/check]', err);
    return NextResponse.json({ error: 'Check failed' }, { status: 500 });
  }
}
