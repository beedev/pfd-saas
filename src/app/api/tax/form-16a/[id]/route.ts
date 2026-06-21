/**
 * DELETE /api/tax/form-16a/[id] — remove one Form 16A certificate.
 * User-scoped. Mirrors the Form 16 per-row delete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, form16aUploads } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  try {
    const deleted = await db
      .delete(form16aUploads)
      .where(and(eq(form16aUploads.id, numId), eq(form16aUploads.userId, userId)))
      .returning({ id: form16aUploads.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[tax/form-16a/[id] DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
