/**
 * Form 16 index — Sprint B (saas back-port).
 *
 * GET /api/tax/form-16?fy=YYYY-YY (fy optional → returns all)
 * Returns uploads ordered newest-first along with reconciliation
 * totals — total TDS across uploads for the FY (or all FYs).
 *
 * Multi-tenant: all queries scoped by session.user.id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, form16Uploads } from '@/db';
import { auth } from '@/auth';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    const userScope = eq(form16Uploads.userId, session.user.id);

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

    return NextResponse.json({ uploads, totals });
  } catch (err) {
    console.error('[tax/form-16 GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
