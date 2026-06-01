/**
 * Mark TDS-credit rows reconciled against a Form 26AS upload.
 * Sprint 4 Phase 2.
 *
 * POST /api/tax/form-26as/:id/match
 *   body: { tdsCreditIds: number[] }
 *
 * Sets `is_reconciled = true` and stamps `reconciled_via_upload_id`
 * on every passed row that belongs to the caller. Rows for other
 * users are silently skipped (defence-in-depth — the WHERE clause
 * scopes by userId, so they wouldn't be touched anyway).
 *
 * Idempotent: re-running with the same ids is a no-op set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, form26asUploads, tdsCredits } from '@/db';
import { auth } from '@/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const uploadId = Number(id);
    if (!Number.isFinite(uploadId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const tdsCreditIds: unknown = body?.tdsCreditIds;
    if (!Array.isArray(tdsCreditIds) || tdsCreditIds.length === 0) {
      return NextResponse.json(
        { error: 'tdsCreditIds (non-empty array) required' },
        { status: 400 },
      );
    }
    const ids = tdsCreditIds.map(Number).filter((n) => Number.isFinite(n));
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid ids' }, { status: 400 });
    }

    const userId = session.user.id;

    // Confirm upload exists and belongs to caller.
    const [upload] = await db
      .select()
      .from(form26asUploads)
      .where(and(eq(form26asUploads.id, uploadId), eq(form26asUploads.userId, userId)))
      .limit(1);
    if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });

    const updated = await db
      .update(tdsCredits)
      .set({
        isReconciled: true,
        reconciledViaUploadId: uploadId,
        updatedAt: new Date(),
      })
      .where(and(eq(tdsCredits.userId, userId), inArray(tdsCredits.id, ids)))
      .returning({ id: tdsCredits.id });

    return NextResponse.json({
      matchedCount: updated.length,
      matchedIds: updated.map((r) => r.id),
    });
  } catch (err) {
    console.error('[tax/form-26as/:id/match POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

/** Unmatch — clear the reconciliation flag on the given rows. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const uploadId = Number(id);
    if (!Number.isFinite(uploadId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const userId = session.user.id;

    // Clear all rows currently tied to this upload for this user.
    const cleared = await db
      .update(tdsCredits)
      .set({
        isReconciled: false,
        reconciledViaUploadId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tdsCredits.userId, userId),
          eq(tdsCredits.reconciledViaUploadId, uploadId),
        ),
      )
      .returning({ id: tdsCredits.id });

    return NextResponse.json({ clearedCount: cleared.length });
  } catch (err) {
    console.error('[tax/form-26as/:id/match DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
