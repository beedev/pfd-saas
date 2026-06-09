/**
 * Accept a per-TAN match — Sprint 5.14 Phase 2.
 *
 * POST /api/tax/reconciliation/per-tan/accept
 *   body: { fy: string, tan: string, uploadId: number }
 *
 * Persists the user's "yes, this TAN's books rows reconcile against
 * this 26AS upload" decision by setting `is_reconciled = true` and
 * `reconciled_via_upload_id = uploadId` on every `tds_credits` row for
 * the given (user, FY, TAN). The reconciliation lib (Phase 1) then
 * surfaces a ✓ Reconciled badge that survives page reloads.
 *
 * Idempotent — re-clicking returns the same matchedCount with no DB
 * side effects beyond `updated_at` bumps.
 *
 * Boundary notes:
 *   - `(no TAN)` is allowed and matches rows where deductor_tan is
 *     NULL or empty.
 *   - When the upload doesn't belong to the caller (or doesn't exist)
 *     we return 404 to avoid leaking other-tenant data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db, form26asUploads, tdsCredits } from '@/db';
import { auth } from '@/auth';
import { NO_TAN_BUCKET } from '@/lib/finance/form-26as-recon';

const FY_RE = /^\d{4}-\d{2}$/;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      fy?: unknown;
      tan?: unknown;
      uploadId?: unknown;
    };
    const fy = typeof body.fy === 'string' ? body.fy : '';
    const tan = typeof body.tan === 'string' ? body.tan.trim() : '';
    const uploadId = Number(body.uploadId);

    if (!FY_RE.test(fy)) {
      return NextResponse.json({ error: 'fy must look like YYYY-YY' }, { status: 400 });
    }
    if (!tan) {
      return NextResponse.json({ error: 'tan required' }, { status: 400 });
    }
    if (!Number.isFinite(uploadId)) {
      return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    }

    const userId = session.user.id;

    // Confirm the upload exists for this user (and matches the FY — we
    // don't want a TAN match wired to an upload from a different year).
    const [upload] = await db
      .select()
      .from(form26asUploads)
      .where(
        and(
          eq(form26asUploads.id, uploadId),
          eq(form26asUploads.userId, userId),
          eq(form26asUploads.fy, fy),
        ),
      )
      .limit(1);
    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    // Match the TAN. '(no TAN)' is the sentinel for rows where
    // deductor_tan is NULL or empty — translate to the appropriate
    // WHERE clause.
    const tanClause =
      tan === NO_TAN_BUCKET
        ? or(isNull(tdsCredits.deductorTan), eq(tdsCredits.deductorTan, ''))
        : eq(tdsCredits.deductorTan, tan);

    const updated = await db
      .update(tdsCredits)
      .set({
        isReconciled: true,
        reconciledViaUploadId: uploadId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tdsCredits.userId, userId),
          eq(tdsCredits.financialYear, fy),
          tanClause,
        ),
      )
      .returning({ id: tdsCredits.id });

    return NextResponse.json({
      matchedCount: updated.length,
      matchedIds: updated.map((r) => r.id),
      tan,
      uploadId,
    });
  } catch (err) {
    console.error('[tax/reconciliation/per-tan/accept POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

/**
 * DELETE /api/tax/reconciliation/per-tan/accept?fy=...&tan=...
 *
 * Clears reconciliation for every books row in the given (user, FY,
 * TAN) bucket — used by the UI when the user wants to undo a previously
 * accepted match.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const fy = params.get('fy') ?? '';
    const tan = (params.get('tan') ?? '').trim();
    if (!FY_RE.test(fy)) {
      return NextResponse.json({ error: 'fy must look like YYYY-YY' }, { status: 400 });
    }
    if (!tan) {
      return NextResponse.json({ error: 'tan required' }, { status: 400 });
    }

    const userId = session.user.id;
    const tanClause =
      tan === NO_TAN_BUCKET
        ? or(isNull(tdsCredits.deductorTan), eq(tdsCredits.deductorTan, ''))
        : eq(tdsCredits.deductorTan, tan);

    const updated = await db
      .update(tdsCredits)
      .set({
        isReconciled: false,
        reconciledViaUploadId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tdsCredits.userId, userId),
          eq(tdsCredits.financialYear, fy),
          tanClause,
        ),
      )
      .returning({ id: tdsCredits.id });

    return NextResponse.json({
      clearedCount: updated.length,
      clearedIds: updated.map((r) => r.id),
      tan,
    });
  } catch (err) {
    console.error('[tax/reconciliation/per-tan/accept DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
