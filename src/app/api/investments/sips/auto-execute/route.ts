/**
 * POST /api/investments/sips/auto-execute — manually trigger SIP
 * auto-execution for the current user. Body: { dryRun?: boolean }.
 *
 * The cron-driven version runs from /api/cron/tick — same
 * runSipAutoExecute() function, different dispatch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { runSipAutoExecute } from '@/lib/cron/sip-auto-execute';

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  let dryRun = false;
  try {
    const body = await request.json();
    dryRun = !!body?.dryRun;
  } catch {
    // empty body is fine
  }
  try {
    const result = await runSipAutoExecute(userId, { dryRun });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sips/auto-execute]', err);
    const message = err instanceof Error ? err.message : 'Auto-execute failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
