/**
 * GET /api/finance/loan-tax-deductions?fy=2025-26
 *
 * Returns FY-aggregated 80C principal + 24(b) interest splits across
 * all ACTIVE liabilities for the authenticated user where the
 * tax-qualifying flags are set. Powers:
 *
 *   • The "Auto-counted from loans" surfacing on /tax Section 80 + 24(b)
 *     cards (Sprint 5.9c)
 *   • The "FY 2025-26: ₹X principal · ₹Y interest already counted"
 *     note on the loan detail page (Sprint 5.9e)
 *   • Regime-compare + ITR-form summary aggregation (Sprint 5.9c)
 *
 * Pure compute on top of `aggregateLoanTaxDeductions()` from
 * `@/lib/finance/loan-tax`. Per-row math uses the existing
 * `amortizationSchedule()` helper to keep the split numbers exactly
 * aligned with what the user sees on the loan detail page's schedule
 * table.
 *
 * Auth gate is OUTSIDE the try/catch so an auth failure never gets
 * masked as a generic 500 (project convention).
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, liabilities } from '@/db';
import { auth } from '@/auth';
import { aggregateLoanTaxDeductions } from '@/lib/finance/loan-tax';

/** Default to the current Indian FY (April–March cycle). */
function defaultCurrentFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const fy = new URL(request.url).searchParams.get('fy') ?? defaultCurrentFY();
    const rows = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.userId, session.user.id));

    const result = aggregateLoanTaxDeductions(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        status: r.status,
        currentBalance: r.currentBalance,
        originalAmount: r.originalAmount,
        interestRate: r.interestRate,
        monthlyEmi: r.monthlyEmi,
        startDate: r.startDate,
        maturityDate: r.maturityDate,
        remainingTenor: r.remainingTenor,
        principalQualifies80c: r.principalQualifies80c,
        interestQualifies24b: r.interestQualifies24b,
      })),
      fy,
    );

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ fy, ...result });
  } catch (err) {
    console.error('[finance/loan-tax-deductions GET]', err);
    return NextResponse.json({ error: 'Failed to compute' }, { status: 500 });
  }
}
