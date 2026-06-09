/**
 * Per-TAN Form 26AS reconciliation — Sprint 5.14.
 *
 * GET /api/tax/reconciliation/per-tan?fy=YYYY-YY
 *
 * Returns a `ReconResult` (see src/lib/finance/form-26as-recon.ts) that
 * outer-joins books `tds_credits` rows with deductor rows extracted from
 * every uploaded 26AS for the FY, grouped and classified per TAN.
 *
 * Drives the rewritten /tax/form-26as page (Phase 3) — replaces the
 * legacy two-column-with-checkboxes UX whose single "Discrepancy ₹X"
 * headline is meaningless when books and 26AS have disjoint deductors.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { computeReconciliation } from '@/lib/finance/form-26as-recon';

/** Strict FY pattern: 2024-25, 2025-26, etc. */
const FY_RE = /^\d{4}-\d{2}$/;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) {
      return NextResponse.json({ error: 'fy required' }, { status: 400 });
    }
    if (!FY_RE.test(fy)) {
      return NextResponse.json({ error: 'fy must look like YYYY-YY' }, { status: 400 });
    }

    const result = await computeReconciliation(session.user.id, fy);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[tax/reconciliation/per-tan GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
