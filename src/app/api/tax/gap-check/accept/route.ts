/**
 * POST /api/tax/gap-check/accept   { fy, family: 'interest' | 'dividend' }
 *
 * Accepts the residual income the Income-Tax department (AIS/TIS) reports beyond
 * what our records already account for, booking it into other-sources income
 * tagged AIS_ACCEPTED. This is the "I trust the department's figure for the bit
 * I didn't track" action — e.g. small savings-bank interest below the TDS
 * threshold that never produces a Form 16A.
 *
 * Idempotent: it deletes any prior AIS_ACCEPTED row for the family+FY, recomputes
 * the residual from the NON-accepted books (manual entries + auto-derived FD
 * interest), and books exactly that delta — so re-accepting never double-counts,
 * and recording the income manually later shrinks the residual to zero.
 *
 * All money in paisa.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, aisImports, otherSourcesIncome, type OtherIncomeSource } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { syncFdInterest } from '@/lib/finance/fd-interest';
import { syncRdInterest } from '@/lib/finance/rd-interest';

export const runtime = 'nodejs';

const TOLERANCE_PAISA = 10_000; // ₹100 — don't bother booking sub-₹100 residuals.

// Books that count toward each family (must mirror it-gap-check.ts).
const INTEREST_SRC = new Set<OtherIncomeSource>(['BANK_INTEREST', 'FD_INTEREST', 'RD_INTEREST', 'PF_INTEREST']);

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  let body: { fy?: string; family?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const fy = body.fy;
  const family = body.family;
  if (!fy || !/^\d{4}-\d{2}$/.test(fy)) {
    return NextResponse.json({ error: 'fy required (YYYY-YY)' }, { status: 400 });
  }
  if (family !== 'interest' && family !== 'dividend') {
    return NextResponse.json({ error: "family must be 'interest' or 'dividend'" }, { status: 400 });
  }

  // Keep auto-derived FD + RD interest current so the residual is computed against it.
  await syncFdInterest(userId);
  await syncRdInterest(userId);

  // Department total for this family from the stored TIS categories.
  const tisRow = (
    await db
      .select()
      .from(aisImports)
      .where(and(eq(aisImports.userId, userId), eq(aisImports.fy, fy), eq(aisImports.kind, 'TIS')))
      .limit(1)
  )[0];
  const tisCat = (key: string): number =>
    tisRow?.categoriesJson?.find((c) => c.key === key)?.amountPaisa ?? 0;
  const deptTotal =
    family === 'interest'
      ? tisCat('interest_savings') + tisCat('interest_deposit')
      : tisCat('dividend');
  if (deptTotal <= 0) {
    return NextResponse.json({ error: 'Nothing to accept — AIS/TIS reports no such income.' }, { status: 400 });
  }

  // Current books for this family, EXCLUDING any prior AIS_ACCEPTED row.
  const rows = await db
    .select()
    .from(otherSourcesIncome)
    .where(and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy)));
  const inFamily = (src: OtherIncomeSource) =>
    family === 'interest' ? INTEREST_SRC.has(src) : src === 'DIVIDEND';
  const booksExclAccepted = rows
    .filter((r) => r.sourceKind !== 'AIS_ACCEPTED' && inFamily(r.source))
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);

  const residual = Math.max(0, deptTotal - booksExclAccepted);
  const acceptedSource: OtherIncomeSource = family === 'interest' ? 'BANK_INTEREST' : 'DIVIDEND';

  // Replace any prior accepted residual for this family+FY (idempotent).
  await db
    .delete(otherSourcesIncome)
    .where(
      and(
        eq(otherSourcesIncome.userId, userId),
        eq(otherSourcesIncome.financialYear, fy),
        eq(otherSourcesIncome.sourceKind, 'AIS_ACCEPTED'),
        eq(otherSourcesIncome.source, acceptedSource),
      ),
    );

  let created = 0;
  if (residual > TOLERANCE_PAISA) {
    await db.insert(otherSourcesIncome).values({
      userId,
      financialYear: fy,
      source: acceptedSource,
      description:
        family === 'interest'
          ? 'Interest accepted from AIS (residual not separately recorded)'
          : 'Dividend accepted from AIS (residual not separately recorded)',
      amountPaisa: residual,
      isTaxExempt: false,
      sourceKind: 'AIS_ACCEPTED',
      sourceRefId: null,
    });
    created = 1;
  }

  return NextResponse.json({ ok: true, family, fy, residualPaisa: residual, created });
}
