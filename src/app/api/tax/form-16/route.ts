/**
 * Form 16 index — Sprint B (saas back-port).
 *
 * GET /api/tax/form-16?fy=YYYY-YY (fy optional → returns all)
 * Returns uploads ordered newest-first along with reconciliation
 * totals — total TDS across uploads for the FY (or all FYs).
 *
 * Multi-tenant: all queries scoped by userId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, form16Uploads, form16aUploads } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    const userScope = eq(form16Uploads.userId, userId);

    const uploads = fy
      ? await db
          .select()
          .from(form16Uploads)
          .where(and(userScope, eq(form16Uploads.fy, fy)))
          .orderBy(desc(form16Uploads.uploadedAt))
      : await db
          .select()
          .from(form16Uploads)
          .where(userScope)
          .orderBy(desc(form16Uploads.uploadedAt));

    const totals = {
      grossSalaryPaisa: uploads.reduce((s, u) => s + (u.grossSalaryPaisa ?? 0), 0),
      taxableSalaryPaisa: uploads.reduce((s, u) => s + (u.taxableSalaryPaisa ?? 0), 0),
      totalTdsPaisa: uploads.reduce((s, u) => s + (u.totalTdsPaisa ?? 0), 0),
    };

    // Form 16A (non-salary TDS certificates) for the same scope.
    const aScope = eq(form16aUploads.userId, userId);
    const form16a = fy
      ? await db.select().from(form16aUploads)
          .where(and(aScope, eq(form16aUploads.fy, fy)))
          .orderBy(desc(form16aUploads.uploadedAt))
      : await db.select().from(form16aUploads)
          .where(aScope)
          .orderBy(desc(form16aUploads.uploadedAt));

    return NextResponse.json({ uploads, totals, form16a });
  } catch (err) {
    console.error('[tax/form-16 GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
