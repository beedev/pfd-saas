/**
 * Form 26AS reconciliation index — Sprint 4 Phase 2.
 *
 * GET /api/tax/form-26as?fy=2026-27
 *
 * Returns:
 *   {
 *     fy,
 *     uploads: [ { id, filePath, uploadedAt, parsedTotalTdsPaisa, parsedTotalIncomePaisa, parsedAt, parseNotes } ],
 *     tdsCredits: [ { id, deductorName, deductorTan, section, incomePaisa, tdsPaisa, isReconciled, reconciledViaUploadId } ],
 *     totals: { booksTdsPaisa, books26asPaisaSum }
 *   }
 *
 * The page composes the discrepancy delta on the client because it
 * needs to react to user-selected uploads (one user may have multiple
 * Form 26AS PDFs for the same FY — e.g. mid-year correction).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db, form26asUploads, tdsCredits } from '@/db';
import { auth } from '@/auth';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const userId = session.user.id;

    const [uploads, credits] = await Promise.all([
      db
        .select()
        .from(form26asUploads)
        .where(and(eq(form26asUploads.userId, userId), eq(form26asUploads.fy, fy)))
        .orderBy(desc(form26asUploads.uploadedAt)),
      db
        .select()
        .from(tdsCredits)
        .where(
          and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy)),
        )
        .orderBy(desc(tdsCredits.tdsPaisa)),
    ]);

    const booksTdsPaisa = credits.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);
    const books26asPaisaSum = uploads.reduce(
      (s, u) => s + (u.parsedTotalTdsPaisa ?? 0),
      0,
    );

    return NextResponse.json({
      fy,
      uploads,
      tdsCredits: credits,
      totals: { booksTdsPaisa, books26asPaisaSum },
    });
  } catch (err) {
    console.error('[tax/form-26as GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
