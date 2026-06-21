/**
 * POST /api/investments/mutual-funds/redemptions/settle — manually settle
 * the current user's PENDING redemptions whose applicable NAV has now
 * published. (The same runs automatically on the daily sip_auto_execute
 * cron pass.)
 */

import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { settlePendingRedemptions } from '@/lib/finance/mf-redeem-worker';

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const result = await settlePendingRedemptions(userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[mutual-funds/redemptions/settle POST]', err);
    return NextResponse.json({ error: 'Failed to settle redemptions' }, { status: 500 });
  }
}
