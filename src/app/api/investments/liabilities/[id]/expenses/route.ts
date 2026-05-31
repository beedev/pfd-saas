import { NextRequest, NextResponse } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { db, liabilities, creditCardExpenses } from '@/db';
import {
  recomputeCreditCardBudgetForPeriod,
  dateToPeriod,
} from '@/lib/finance/budget-sync';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const expenses = await db
      .select()
      .from(creditCardExpenses)
      .where(and(eq(creditCardExpenses.userId, session.user.id), eq(creditCardExpenses.liabilityId, numericId)))
      .orderBy(desc(creditCardExpenses.period));

    return NextResponse.json({ expenses });
  } catch (err) {
    console.error('Failed to fetch credit card expenses:', err);
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    // Verify liability exists and is a credit card
    const rows = await db
      .select()
      .from(liabilities)
      .where(and(eq(liabilities.id, numericId), eq(liabilities.userId, session.user.id)))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: 'Liability not found' }, { status: 404 });
    }
    if (rows[0].type !== 'CREDIT_CARD') {
      return NextResponse.json({ error: 'Not a credit card liability' }, { status: 400 });
    }

    const body = await request.json();
    const { amount, statementDate, dueDate, notes } = body;

    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount (rupees) is required and must be positive' }, { status: 400 });
    }
    if (typeof statementDate !== 'string' || !statementDate) {
      return NextResponse.json({ error: 'statementDate (ISO date) is required' }, { status: 400 });
    }
    if (typeof dueDate !== 'string' || !dueDate) {
      return NextResponse.json({ error: 'dueDate (ISO date) is required' }, { status: 400 });
    }

    const amountPaisa = Math.round(amount * 100);
    // Budget period = month of due date (when payment actually goes out)
    const period = dateToPeriod(dueDate);

    // Upsert: one record per card per payment month
    const existing = await db
      .select()
      .from(creditCardExpenses)
      .where(
        and(
          eq(creditCardExpenses.userId, session.user.id),
          eq(creditCardExpenses.liabilityId, numericId),
          eq(creditCardExpenses.period, period),
        ),
      );

    let expense;
    if (existing.length > 0) {
      // `'notes' in body` distinguishes "key absent" (preserve existing) from
      // "key present and null/empty" (clear). The old `notes ?? existing` form
      // also fell back when notes was explicitly null, so users couldn't
      // remove notes once set.
      const notesProvided = Object.prototype.hasOwnProperty.call(body, 'notes');
      const result = await db
        .update(creditCardExpenses)
        .set({
          amount: amountPaisa,
          statementDate,
          dueDate,
          paidOn: dueDate, // backward compat
          notes: notesProvided ? (notes ?? null) : existing[0].notes,
        })
        .where(and(eq(creditCardExpenses.id, existing[0].id), eq(creditCardExpenses.userId, session.user.id)))
        .returning();
      expense = result[0];
    } else {
      const result = await db
        .insert(creditCardExpenses)
        .values({
          userId: session.user.id,
          liabilityId: numericId,
          period,
          amount: amountPaisa,
          statementDate,
          dueDate,
          paidOn: dueDate, // backward compat
          notes: notes ?? null,
        })
        .returning();
      expense = result[0];
    }

    // Update liability's balance and payment dates
    await db
      .update(liabilities)
      .set({
        currentBalance: amountPaisa,
        nextPaymentDate: dueDate,
        lastPaymentDate: statementDate,
        updatedAt: new Date(),
      })
      .where(and(eq(liabilities.id, numericId), eq(liabilities.userId, session.user.id)));

    // Sync to budget — period is the due date month
    await recomputeCreditCardBudgetForPeriod(session.user.id, numericId, period);

    return NextResponse.json(
      { expense },
      { status: existing.length > 0 ? 200 : 201 },
    );
  } catch (err) {
    console.error('Failed to record credit card expense:', err);
    return NextResponse.json({ error: 'Failed to record expense' }, { status: 500 });
  }
}
