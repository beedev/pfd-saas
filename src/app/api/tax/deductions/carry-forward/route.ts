/**
 * Carry-forward deductions from a prior FY — Sprint 5.2 commit 2 (U8).
 *
 * POST /api/tax/deductions/carry-forward
 *   body: { fromFy, toFy, deductionIds? }
 *
 * Copies the requested rows (or all rows for fromFy if deductionIds is
 * omitted) into the target FY. The payment date is shifted by exactly
 * one year (same day-of-year, new FY). Tax-document attachments are
 * NOT copied — those need fresh proof for the new year.
 *
 * Returns the inserted IDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, taxDeductions } from '@/db';
import { auth } from '@/auth';

interface Body {
  fromFy?: string;
  toFy?: string;
  deductionIds?: number[];
}

/** Add exactly one calendar year to a YYYY-MM-DD date string. */
function shiftYear(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const y = Number(m[1]) + 1;
  return `${y}-${m[2]}-${m[3]}`;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Body;
    if (!body.fromFy || !body.toFy) {
      return NextResponse.json(
        { error: 'fromFy and toFy are required' },
        { status: 400 },
      );
    }
    if (body.fromFy === body.toFy) {
      return NextResponse.json(
        { error: 'fromFy and toFy must differ' },
        { status: 400 },
      );
    }

    const userId = session.user.id;
    const conds = [
      eq(taxDeductions.userId, userId),
      eq(taxDeductions.financialYear, body.fromFy),
    ] as ReturnType<typeof eq>[];
    if (body.deductionIds && body.deductionIds.length > 0) {
      conds.push(inArray(taxDeductions.id, body.deductionIds));
    }

    const sourceRows = await db
      .select()
      .from(taxDeductions)
      .where(and(...conds));

    if (sourceRows.length === 0) {
      return NextResponse.json({ insertedIds: [], copiedCount: 0 });
    }

    const now = new Date();
    const inserted = await db
      .insert(taxDeductions)
      .values(
        sourceRows.map((r) => ({
          userId,
          section: r.section,
          description: r.description,
          deductibleAmount: r.deductibleAmount,
          availableLimit: r.availableLimit,
          utilizableAmount: r.utilizableAmount,
          incurredDate: shiftYear(r.incurredDate) ?? r.incurredDate,
          financialYear: body.toFy!,
          subType: r.subType,
          amountPaisa: r.amountPaisa,
          paymentDate: shiftYear(r.paymentDate),
          paymentMethod: r.paymentMethod,
          recipientName: r.recipientName,
          recipientPan: r.recipientPan,
          recipient80gNumber: r.recipient80gNumber,
          qualifyingPercent: r.qualifyingPercent,
          hasUpperLimit: r.hasUpperLimit,
          linkedAssetType: r.linkedAssetType,
          linkedAssetId: r.linkedAssetId,
          notes: r.notes ? `${r.notes} (carried over from ${body.fromFy})` : `Carried over from ${body.fromFy}`,
          eightyGCategory: r.eightyGCategory,
          eightyDBucket: r.eightyDBucket,
          eligibleUnderNew: r.eligibleUnderNew,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning({ id: taxDeductions.id });

    return NextResponse.json({
      insertedIds: inserted.map((i) => i.id),
      copiedCount: inserted.length,
    });
  } catch (err) {
    console.error('[tax/deductions/carry-forward POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Carry-forward failed' },
      { status: 500 },
    );
  }
}
