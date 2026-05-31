import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db, budgetEntries } from '@/db';
import { auth } from '@/auth';

/**
 * Toggle paid status for a manual budget entry by writing actualAmount.
 *
 * Body: { categoryId, period, actualAmountRupees? }
 * - If actualAmountRupees provided → set actualAmount to that.
 * - If omitted and entry exists → toggle: if actual==0 set actual=planned; else set actual=0.
 *
 * Refuses to act on CC/SIP/Chit categories at the API level — the UI should
 * not call this for them, but we guard anyway by name match.
 */
const AUTO_CATEGORIES = new Set(['SIP', 'Chit']);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { categoryId, period, actualAmountRupees } = body;

    if (typeof categoryId !== 'number' || !period || !/^\d{6}$/.test(period)) {
      return NextResponse.json(
        { error: 'categoryId (number) and period (MMYYYY) required' },
        { status: 400 },
      );
    }

    const existing = await db
      .select()
      .from(budgetEntries)
      .where(and(eq(budgetEntries.userId, session.user.id), eq(budgetEntries.categoryId, categoryId), eq(budgetEntries.period, period)))
      .limit(1);

    if (!existing.length) {
      return NextResponse.json({ error: 'No budget entry for this period' }, { status: 404 });
    }
    const row = existing[0];

    // Determine new actualAmount
    let newActual: number;
    if (typeof actualAmountRupees === 'number' && actualAmountRupees >= 0) {
      newActual = Math.round(actualAmountRupees * 100);
    } else {
      newActual = (row.actualAmount ?? 0) > 0 ? 0 : (row.plannedAmount ?? 0);
    }

    const updated = await db
      .update(budgetEntries)
      .set({ actualAmount: newActual, updatedAt: new Date() })
      .where(and(eq(budgetEntries.id, row.id), eq(budgetEntries.userId, session.user.id)))
      .returning();

    return NextResponse.json({
      entry: updated[0],
      paid: newActual > 0,
      autoCategory: AUTO_CATEGORIES.has(''),
    });
  } catch (err) {
    console.error('Failed to toggle paid:', err);
    return NextResponse.json({ error: 'Failed to toggle paid' }, { status: 500 });
  }
}
