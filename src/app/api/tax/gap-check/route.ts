/**
 * GET /api/tax/gap-check?fy=YYYY-YY
 *
 * The unified Income-Tax Gap Check: AIS/TIS (and booked) totals vs what the
 * app has recorded, per category, with the rupee gap + indicative tax impact.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { computeItGapCheck } from '@/lib/finance/it-gap-check';
import { syncFdInterest } from '@/lib/finance/fd-interest';
import { getTaxFilingYear } from '@/lib/finance/tax-filing-year';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const fyParam = new URL(request.url).searchParams.get('fy');
  // Default to the tax filing year (the year you're filing), not the calendar year.
  const fy = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : await getTaxFilingYear(userId);

  // Keep auto-derived FD interest fresh before reconciling (regenerate-from-source).
  await syncFdInterest(userId);

  const result = await computeItGapCheck(userId, fy);
  return NextResponse.json(result);
}
