/**
 * Record a payment against an advance-tax installment.
 * Sprint 4 Phase 3.
 *
 * PATCH /api/tax/advance-tax/:id
 *   body: { paidAmountPaisa: number, paidDate: 'YYYY-MM-DD', notes?: string }
 *
 * Overwrites the paid amount + date on the row. The user is allowed
 * to enter a paid amount that doesn't match the expected due (e.g.
 * they paid all 4 installments at once on 15 Mar) — we don't enforce
 * a relationship between the value and the slot's due_pct here. The
 * GET endpoint will surface the discrepancy via the 234B/234C flag.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, advanceTaxInstallments } from '@/db';
import { auth } from '@/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const { paidAmountPaisa, paidDate, notes } = body ?? {};

    if (paidAmountPaisa == null || !Number.isFinite(Number(paidAmountPaisa))) {
      return NextResponse.json(
        { error: 'paidAmountPaisa (number) required' },
        { status: 400 },
      );
    }
    if (!paidDate || typeof paidDate !== 'string') {
      return NextResponse.json({ error: 'paidDate required' }, { status: 400 });
    }

    const userId = session.user.id;

    const updated = await db
      .update(advanceTaxInstallments)
      .set({
        paidAmountPaisa: Math.round(Number(paidAmountPaisa)),
        paidDate,
        notes: typeof notes === 'string' ? notes : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(advanceTaxInstallments.id, numericId),
          eq(advanceTaxInstallments.userId, userId),
        ),
      )
      .returning();

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ installment: updated[0] });
  } catch (err) {
    console.error('[tax/advance-tax/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
