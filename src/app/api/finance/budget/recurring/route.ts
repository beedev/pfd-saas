import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db, recurringExpenses, budgetEntries, budgetCategories } from '@/db';
import { expandRecurringPeriods, Recurrence } from '@/lib/finance/recurring-expand';

const VALID_RECURRENCE: Recurrence[] = ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];

export async function GET() {
  try {
    const rows = await db
      .select({
        id: recurringExpenses.id,
        categoryId: recurringExpenses.categoryId,
        categoryName: budgetCategories.name,
        categoryType: budgetCategories.type,
        amount: recurringExpenses.amount,
        recurrence: recurringExpenses.recurrence,
        startPeriod: recurringExpenses.startPeriod,
        endPeriod: recurringExpenses.endPeriod,
        notes: recurringExpenses.notes,
        isActive: recurringExpenses.isActive,
      })
      .from(recurringExpenses)
      .innerJoin(budgetCategories, eq(budgetCategories.id, recurringExpenses.categoryId))
      .where(eq(recurringExpenses.isActive, true));

    return NextResponse.json({ recurring: rows });
  } catch (err) {
    console.error('Failed to list recurring expenses:', err);
    return NextResponse.json({ error: 'Failed to list recurring' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categoryId, amountRupees, recurrence, startPeriod, endPeriod, notes } = body;

    if (!categoryId || typeof categoryId !== 'number') {
      return NextResponse.json({ error: 'categoryId required' }, { status: 400 });
    }
    if (typeof amountRupees !== 'number' || amountRupees <= 0) {
      return NextResponse.json({ error: 'amountRupees must be positive' }, { status: 400 });
    }
    if (!VALID_RECURRENCE.includes(recurrence)) {
      return NextResponse.json({ error: 'invalid recurrence' }, { status: 400 });
    }
    if (typeof startPeriod !== 'string' || !/^\d{6}$/.test(startPeriod)) {
      return NextResponse.json({ error: 'startPeriod must be MMYYYY' }, { status: 400 });
    }
    if (endPeriod && (typeof endPeriod !== 'string' || !/^\d{6}$/.test(endPeriod))) {
      return NextResponse.json({ error: 'endPeriod must be MMYYYY' }, { status: 400 });
    }

    const amountPaisa = Math.round(amountRupees * 100);

    const inserted = await db
      .insert(recurringExpenses)
      .values({
        categoryId,
        amount: amountPaisa,
        recurrence,
        startPeriod,
        endPeriod: endPeriod || null,
        notes: notes || null,
      })
      .returning();

    // Expand into budget_entries (skip if entry already exists for that period)
    const periods = expandRecurringPeriods(recurrence, startPeriod, endPeriod || null);
    let created = 0;
    let skipped = 0;
    for (const period of periods) {
      const existing = await db
        .select()
        .from(budgetEntries)
        .where(and(eq(budgetEntries.categoryId, categoryId), eq(budgetEntries.period, period)));
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }
      await db.insert(budgetEntries).values({
        categoryId,
        period,
        plannedAmount: amountPaisa,
        actualAmount: 0,
      });
      created += 1;
    }

    return NextResponse.json(
      { recurring: inserted[0], periodsTouched: periods.length, created, skipped },
      { status: 201 },
    );
  } catch (err) {
    console.error('Failed to create recurring expense:', err);
    return NextResponse.json({ error: 'Failed to create recurring' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    }
    // Soft delete: mark inactive. Future unpaid entries are left in budget for
    // the user to clean up manually if they want.
    await db
      .update(recurringExpenses)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(recurringExpenses.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete recurring expense:', err);
    return NextResponse.json({ error: 'Failed to delete recurring' }, { status: 500 });
  }
}
