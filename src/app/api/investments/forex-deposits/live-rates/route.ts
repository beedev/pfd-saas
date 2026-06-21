/**
 * GET /api/investments/forex-deposits/live-rates
 *
 * Returns live INR conversion rates for the union of currencies the
 * authenticated user holds in forex_deposits. Cached upstream (5-min
 * TTL in the Yahoo Finance service); this endpoint is auth-gated so
 * unauth'd callers can't piggy-back on the cache.
 *
 * Response shape: { rates: { USD: 83.45, … }, asOf: '<ISO timestamp>' }
 *
 * Returns an empty rates object (200, not 404) when the user has no
 * forex deposits — that's a legitimate state, not an error.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, forexDeposits } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getFxRatesToInr } from '@/lib/services/yahoo-finance';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select({ currencyCode: forexDeposits.currencyCode })
      .from(forexDeposits)
      .where(eq(forexDeposits.userId, userId));
    const codes = Array.from(new Set(rows.map((r) => r.currencyCode).filter(Boolean)));
    const rates = codes.length > 0 ? await getFxRatesToInr(codes) : {};
    return NextResponse.json({ rates, asOf: new Date().toISOString() });
  } catch (err) {
    console.error('GET forex-deposits/live-rates:', err);
    return NextResponse.json({ error: 'Failed to load FX rates' }, { status: 500 });
  }
}
