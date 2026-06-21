import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, budgetCarryForward } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const periods = new URL(request.url).searchParams.get('periods');
    if (!periods) {
      const all = await db
        .select()
        .from(budgetCarryForward)
        .where(eq(budgetCarryForward.userId, userId));
      return NextResponse.json({ carryForward: all });
    }
    const periodList = periods.split(',');
    const all = await db
      .select()
      .from(budgetCarryForward)
      .where(eq(budgetCarryForward.userId, userId));
    const filtered = all.filter((r) => periodList.includes(r.period));
    return NextResponse.json({ carryForward: filtered });
  } catch (err) {
    console.error('[carry-forward GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const { period, amount } = body;
    if (!period || amount === undefined) {
      return NextResponse.json({ error: 'period and amount required' }, { status: 400 });
    }

    const amountPaisa = Math.round(amount * 100);
    const existing = await db
      .select()
      .from(budgetCarryForward)
      .where(and(eq(budgetCarryForward.period, period), eq(budgetCarryForward.userId, userId)));

    if (existing.length > 0) {
      await db
        .update(budgetCarryForward)
        .set({ amount: amountPaisa, updatedAt: new Date() })
        .where(and(eq(budgetCarryForward.id, existing[0].id), eq(budgetCarryForward.userId, userId)));
    } else {
      await db.insert(budgetCarryForward).values({ userId: userId, period, amount: amountPaisa });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[carry-forward POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
