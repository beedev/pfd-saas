/**
 * GET /api/tax/regime-compare?fy=2026-27
 *
 * Computes tax under BOTH regimes side-by-side using the user's gross
 * income + deductions for the FY, returns the recommendation + savings
 * delta. The heavy lifting lives in lib/finance/tax-compute
 * (`computeFyTaxComparison`) — THE single source of truth shared with the
 * advance-tax projection so the two can never drift. This route is a thin
 * auth gate + JSON shaper.
 *
 * Income + deduction rules (salary Form-16-authoritative, 44ADA
 * presumptive, HRA, house-property 24(b)/80EEA, shared deduction engine,
 * aggregate capital-gains tax) are all documented in tax-compute.
 *
 * Auth-gated, user-scoped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  computeFyTaxComparison,
  isComputeError,
} from '@/lib/finance/tax-compute';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const fy = new URL(request.url).searchParams.get('fy') ?? defaultCurrentFY();
    const result = await computeFyTaxComparison(session.user.id, fy);
    if (isComputeError(result)) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      fy: result.fy,
      income: result.income,
      deductions: result.deductions,
      loanDeductions: result.loanDeductions,
      comparison: result.comparison,
    });
  } catch (err) {
    console.error('[tax/regime-compare GET]', err);
    return NextResponse.json({ error: 'Failed to compute' }, { status: 500 });
  }
}

/** Returns the current Indian FY as a string. April–March cycle. */
function defaultCurrentFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
