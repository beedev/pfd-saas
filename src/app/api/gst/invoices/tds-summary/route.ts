/**
 * Sprint A.3 (saas back-port) — TDS summary for the Sales Invoices
 * page tile.
 *
 * Returns the total auto-derived TDS for a given FY (defaults to
 * current), and the count of source invoices contributing to it.
 * Scoped to the active user — multi-tenant — and to tds_credits rows
 * with source_kind='GST_INVOICE' (the auto-derived ones from Phase 2).
 *
 *   GET /api/gst/invoices/tds-summary?fy=YYYY-YY
 *     → { fy, totalTdsPaisa, totalIncomePaisa, invoiceCount }
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, tdsCredits } from '@/db';
import { auth } from '@/auth';

function getCurrentFy(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const fy = new URL(request.url).searchParams.get('fy') || getCurrentFy();

    const rows = await db
      .select()
      .from(tdsCredits)
      .where(
        and(
          eq(tdsCredits.userId, session.user.id),
          eq(tdsCredits.financialYear, fy),
          eq(tdsCredits.sourceKind, 'GST_INVOICE'),
        ),
      );

    const totalTdsPaisa = rows.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);
    const totalIncomePaisa = rows.reduce((s, r) => s + (r.incomePaisa ?? 0), 0);

    return NextResponse.json({
      fy,
      totalTdsPaisa,
      totalIncomePaisa,
      invoiceCount: rows.length,
    });
  } catch (err) {
    console.error('[gst/invoices/tds-summary GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
