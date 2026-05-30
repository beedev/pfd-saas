import { NextRequest, NextResponse } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db, chitFunds, chitFundInstallments, type ChitPaymentMethod } from '@/db';
import { calculateChitXirrFromSummary } from '@/lib/finance/chit-xirr';
import { recomputeChitBudgetForPeriod, dateToPeriod } from '@/lib/finance/budget-sync';

interface Params {
  params: Promise<{ id: string }>;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(chitFundInstallments)
      .where(eq(chitFundInstallments.chitFundId, numericId))
      .orderBy(asc(chitFundInstallments.monthNumber));
    return NextResponse.json({ installments: rows });
  } catch (error) {
    console.error('Error fetching installments:', error);
    return NextResponse.json({ error: 'Failed to fetch installments' }, { status: 500 });
  }
}

// POST — record a new installment (body values in rupees for money fields)
// {
//   monthNumber?, dueDate?, installmentPaid (₹), dividendReceived? (₹),
//   paidOn, paymentMethod?, winnerName?, winnerBidDiscountPct?, notes?
// }
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const {
      monthNumber,
      dueDate,
      installmentPaid,
      dividendReceived = 0,
      paidOn,
      paymentMethod = 'NEFT',
      winnerName,
      winnerBidDiscountPct,
      notes,
    } = body;

    if (typeof installmentPaid !== 'number' || installmentPaid <= 0) {
      return NextResponse.json({ error: 'installmentPaid must be positive' }, { status: 400 });
    }
    if (!paidOn) return NextResponse.json({ error: 'paidOn required' }, { status: 400 });

    const chitRows = await db.select().from(chitFunds).where(eq(chitFunds.id, numericId)).limit(1);
    if (!chitRows.length) return NextResponse.json({ error: 'Chit fund not found' }, { status: 404 });
    const chit = chitRows[0];

    const paidPaisa = Math.round(installmentPaid * 100);        // what left the bank
    const dividendPaisa = Math.round((dividendReceived || 0) * 100); // auction discount
    // Net outgo = amount paid. The dividend was already subtracted before payment.
    // installmentPaid IS the net amount (gross installment − dividend = what you paid).
    const netOutgoPaisa = paidPaisa;
    const nextMonth = (chit.installmentsPaid ?? 0) + 1;
    const resolvedMonth = monthNumber ?? nextMonth;
    const resolvedDueDate = dueDate ?? addMonths(chit.startDate, resolvedMonth - 1);

    const insertedInstallment = await db
      .insert(chitFundInstallments)
      .values({
        chitFundId: numericId,
        monthNumber: resolvedMonth,
        dueDate: resolvedDueDate,
        installmentPaid: paidPaisa,
        dividendReceived: dividendPaisa,
        netOutgo: netOutgoPaisa,
        paidOn,
        paymentMethod: paymentMethod as ChitPaymentMethod,
        winnerName: winnerName || null,
        winnerBidDiscountPct:
          typeof winnerBidDiscountPct === 'number' ? winnerBidDiscountPct : null,
        notes: notes || null,
        createdAt: new Date(),
      })
      .returning();

    // Update running state
    const newInstallmentsPaid = (chit.installmentsPaid ?? 0) + 1;
    const newTotalPaid = (chit.totalPaid ?? 0) + paidPaisa;
    const newTotalDividends = (chit.totalDividends ?? 0) + dividendPaisa;
    // Net contribution = gross notional commitment = cash paid + dividend
    // benefit (both are "contributions" — cheque + the discount the chit
    // gave you). Equals installmentsPaid × monthlyInstallment for a healthy
    // ledger.
    const newNetContribution = newTotalPaid + newTotalDividends;
    const newNextDueDate = addMonths(chit.startDate, newInstallmentsPaid);

    // Recompute XIRR from updated summary state — uses the summary-based
    // calculator which reconstructs a synthetic flow series from totals.
    // This works reliably for both imported chits (no per-row history) and
    // chits with partial installment rows.
    const xirrPct = calculateChitXirrFromSummary({
      startDate: chit.startDate,
      expectedEndDate: chit.expectedEndDate,
      durationMonths: chit.durationMonths,
      installmentsPaid: newInstallmentsPaid,
      monthlyInstallmentPaisa: chit.monthlyInstallment,
      totalPaidPaisa: newTotalPaid,
      chitValuePaisa: chit.chitValue,
      status: chit.status ?? 'ACTIVE',
      winDate: chit.winDate,
      winAmountReceivedPaisa: chit.winAmountReceived,
    });

    const updatedChit = await db
      .update(chitFunds)
      .set({
        installmentsPaid: newInstallmentsPaid,
        totalPaid: newTotalPaid,
        totalDividends: newTotalDividends,
        netContribution: newNetContribution,
        nextDueDate: newNextDueDate,
        xirr: xirrPct,
        updatedAt: new Date(),
      })
      .where(eq(chitFunds.id, numericId))
      .returning();

    // Sync chit outflow to budget
    await recomputeChitBudgetForPeriod(dateToPeriod(paidOn));

    return NextResponse.json({
      chitFund: updatedChit[0],
      installment: insertedInstallment[0],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record installment';
    console.error('Error recording installment:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
