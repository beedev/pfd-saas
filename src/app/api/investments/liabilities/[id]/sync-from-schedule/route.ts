/**
 * POST /api/investments/liabilities/[id]/sync-from-schedule
 *
 * Reconcile a loan's liability row against the bank's uploaded amortization
 * schedule. Useful after importing a fresh schedule PDF — the editable
 * liability fields (rate, EMI, outstanding, maturity) often drift from what
 * the bank actually computes, and this endpoint pulls them back into sync.
 *
 * Operation (transactional in spirit — done in sequence, side-effects only on
 * success):
 *   1. Mark every row with dueDate < today and status != 'PAID' as PAID, with
 *      paidOn = that row's dueDate. (Past months are assumed paid; the user
 *      can manually un-paid via the existing PATCH row endpoint if needed.)
 *   2. Derive header meta from the schedule:
 *        originalAmount = row[0].openingBalance
 *        monthlyEmi     = row[0].emi
 *        interestRate   = row[0].interest / row[0].openingBalance × 12 × 100
 *        maturityDate   = last row's dueDate
 *   3. currentBalance = latest PAID row's closing (else originalAmount).
 *   4. nextPaymentDate = next UPCOMING row's dueDate.
 *   5. remainingTenor  = count of non-PAID rows.
 *
 * Returns the row-level deltas + the updated liability for the UI to confirm.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, lt, ne } from 'drizzle-orm';
import { db, liabilities, loanAmortization } from '@/db';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const liaRows = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.id, numericId))
      .limit(1);
    if (!liaRows.length) {
      return NextResponse.json({ error: 'Liability not found' }, { status: 404 });
    }
    if (liaRows[0].type === 'CREDIT_CARD') {
      return NextResponse.json(
        { error: 'Credit cards have no amortization schedule' },
        { status: 400 },
      );
    }

    const rows = await db
      .select()
      .from(loanAmortization)
      .where(eq(loanAmortization.liabilityId, numericId))
      .orderBy(asc(loanAmortization.monthNumber));

    if (!rows.length) {
      return NextResponse.json(
        { error: 'No uploaded schedule for this loan. Upload a CSV/PDF first.' },
        { status: 400 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    // 1. Mark past-due rows as PAID.
    const pastDue = rows.filter(
      (r) => r.dueDate && r.dueDate < today && r.status !== 'PAID',
    );
    for (const r of pastDue) {
      await db
        .update(loanAmortization)
        .set({ status: 'PAID', paidOn: r.dueDate })
        .where(eq(loanAmortization.id, r.id));
    }

    // Reload after status update so currentBalance derivation reads fresh data.
    const reloaded = await db
      .select()
      .from(loanAmortization)
      .where(eq(loanAmortization.liabilityId, numericId))
      .orderBy(asc(loanAmortization.monthNumber));

    // 2. Header meta from row[0].
    const first = reloaded[0];
    const last = reloaded[reloaded.length - 1];
    const originalAmount = first.openingBalance;
    const monthlyEmi = first.emi;
    const annualRate =
      first.openingBalance > 0
        ? Math.round((first.interest / first.openingBalance) * 12 * 100 * 100) / 100
        : liaRows[0].interestRate;
    const maturityDate = last.dueDate ?? null;

    // 3. Current balance = latest PAID row's closing (else original).
    const paidRows = reloaded.filter((r) => r.status === 'PAID');
    const currentBalance = paidRows.length
      ? paidRows[paidRows.length - 1].closingBalance
      : originalAmount;

    // 4. Next upcoming row.
    const nextUpcoming = reloaded.find((r) => r.status !== 'PAID');
    const nextPaymentDate = nextUpcoming?.dueDate ?? null;

    // 5. Remaining tenor.
    const remainingTenor = reloaded.filter((r) => r.status !== 'PAID').length;

    const updated = await db
      .update(liabilities)
      .set({
        originalAmount,
        currentBalance,
        monthlyEmi,
        interestRate: annualRate,
        maturityDate,
        nextPaymentDate,
        remainingTenor,
        updatedAt: new Date(),
      })
      .where(eq(liabilities.id, numericId))
      .returning();

    return NextResponse.json({
      rowsMarkedPaid: pastDue.length,
      changes: {
        originalAmount,
        currentBalance,
        monthlyEmi,
        interestRate: annualRate,
        maturityDate,
        nextPaymentDate,
        remainingTenor,
      },
      liability: updated[0],
    });
  } catch (err) {
    console.error('sync-from-schedule failed:', err);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}

// silence unused imports if drizzle helpers shift later
void and;
void lt;
void ne;
