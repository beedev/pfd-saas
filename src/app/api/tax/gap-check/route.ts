/**
 * GET /api/tax/gap-check?fy=YYYY-YY
 *
 * The unified Income-Tax Gap Check: AIS/TIS (and booked) totals vs what the
 * app has recorded, per category, with the rupee gap + indicative tax impact.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { computeItGapCheck } from '@/lib/finance/it-gap-check';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const fyParam = new URL(request.url).searchParams.get('fy');
  const fy = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : getCurrentFinancialYear();

  const result = await computeItGapCheck(userId, fy);
  return NextResponse.json(result);
}
