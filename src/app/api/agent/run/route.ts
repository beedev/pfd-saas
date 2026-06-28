/**
 * POST /api/agent/run — manually trigger the analyst agent's daily run for the
 * current user (bypasses the `enabled` gate; still idempotent per IST day).
 */

import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { runAgentDailyRun } from '@/lib/cron/agent-run';

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const result = await runAgentDailyRun(userId, { manual: true });
    return NextResponse.json(result);
  } catch (err) {
    console.error('POST agent/run:', err);
    return NextResponse.json({ error: 'Run failed' }, { status: 500 });
  }
}
