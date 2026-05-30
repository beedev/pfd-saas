import { NextRequest, NextResponse } from 'next/server';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { db, liabilities, creditCardExpenses } from '@/db';
import { recomputeCreditCardBudgetForPeriod } from '@/lib/finance/budget-sync';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const cardRows = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.id, numericId))
      .limit(1);
    if (!cardRows.length) {
      return NextResponse.json({ error: 'Liability not found' }, { status: 404 });
    }
    if (cardRows[0].type !== 'CREDIT_CARD') {
      return NextResponse.json({ error: 'Not a credit card liability' }, { status: 400 });
    }
    const card = cardRows[0];

    const body = await request.json();
    const { amountRupees, settledOn, period } = body as {
      amountRupees?: number;
      settledOn?: string;
      period?: string;
    };

    if (typeof amountRupees !== 'number' || amountRupees <= 0) {
      return NextResponse.json(
        { error: 'amountRupees is required and must be positive' },
        { status: 400 },
      );
    }
    if (typeof settledOn !== 'string' || !settledOn) {
      return NextResponse.json(
        { error: 'settledOn (ISO date) is required' },
        { status: 400 },
      );
    }

    const paidPaisa = Math.round(amountRupees * 100);

    // Find the statement to settle:
    // - If period provided, use that exact row
    // - Otherwise, latest unpaid statement (paidAmount IS NULL)
    let target;
    if (period) {
      const rows = await db
        .select()
        .from(creditCardExpenses)
        .where(
          and(
            eq(creditCardExpenses.liabilityId, numericId),
            eq(creditCardExpenses.period, period),
          ),
        )
        .limit(1);
      target = rows[0];
    } else {
      const rows = await db
        .select()
        .from(creditCardExpenses)
        .where(
          and(
            eq(creditCardExpenses.liabilityId, numericId),
            isNull(creditCardExpenses.paidAmount),
          ),
        )
        .orderBy(desc(creditCardExpenses.period))
        .limit(1);
      target = rows[0];
    }

    if (!target) {
      return NextResponse.json(
        { error: 'No outstanding statement to mark paid' },
        { status: 404 },
      );
    }

    const updated = await db
      .update(creditCardExpenses)
      .set({
        paidAmount: paidPaisa,
        settledOn,
      })
      .where(eq(creditCardExpenses.id, target.id))
      .returning();

    // Reduce the liability's outstanding balance (floor at 0).
    const newBalance = Math.max(0, card.currentBalance - paidPaisa);

    await db
      .update(liabilities)
      .set({
        currentBalance: newBalance,
        lastPaymentDate: settledOn,
        updatedAt: new Date(),
      })
      .where(eq(liabilities.id, numericId));

    // Sync budget — replaces forecasted statement total with actual paid amount.
    await recomputeCreditCardBudgetForPeriod(numericId, target.period);

    return NextResponse.json({
      expense: updated[0],
      newBalance,
    });
  } catch (err) {
    console.error('Failed to mark statement paid:', err);
    return NextResponse.json(
      { error: 'Failed to mark statement paid' },
      { status: 500 },
    );
  }
}
