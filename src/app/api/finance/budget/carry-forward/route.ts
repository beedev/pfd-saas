import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, budgetCarryForward } from '@/db';

export async function GET(request: NextRequest) {
  try {
    const periods = new URL(request.url).searchParams.get('periods');
    if (!periods) {
      const all = await db.select().from(budgetCarryForward);
      return NextResponse.json({ carryForward: all });
    }
    const periodList = periods.split(',');
    const all = await db.select().from(budgetCarryForward);
    const filtered = all.filter((r) => periodList.includes(r.period));
    return NextResponse.json({ carryForward: filtered });
  } catch (err) {
    console.error('[carry-forward GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
      .where(eq(budgetCarryForward.period, period));

    if (existing.length > 0) {
      await db
        .update(budgetCarryForward)
        .set({ amount: amountPaisa, updatedAt: new Date() })
        .where(eq(budgetCarryForward.id, existing[0].id));
    } else {
      await db.insert(budgetCarryForward).values({ period, amount: amountPaisa });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[carry-forward POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
