import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, liabilities } from '@/db';

interface Params {
  params: Promise<{ id: string }>;
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
      .from(liabilities)
      .where(eq(liabilities.id, numericId))
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ liability: rows[0] });
  } catch (err) {
    console.error('Failed to fetch liability:', err);
    return NextResponse.json({ error: 'Failed to fetch liability' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.id, numericId))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const current = existing[0];
    const body = await request.json();

    const currentBalance =
      typeof body.currentBalanceRupees === 'number'
        ? Math.round(body.currentBalanceRupees * 100)
        : current.currentBalance;
    const monthlyEmi =
      typeof body.monthlyEmiRupees === 'number'
        ? Math.round(body.monthlyEmiRupees * 100)
        : current.monthlyEmi;

    const result = await db
      .update(liabilities)
      .set({
        name: typeof body.name === 'string' ? body.name : current.name,
        creditorName: typeof body.creditorName === 'string' ? body.creditorName : current.creditorName,
        status: typeof body.status === 'string' ? body.status : current.status,
        currentBalance,
        interestRate: typeof body.interestRate === 'number' ? body.interestRate : current.interestRate,
        monthlyEmi,
        maturityDate: typeof body.maturityDate === 'string' ? (body.maturityDate || null) : current.maturityDate,
        remainingTenor: typeof body.remainingTenor === 'number' ? body.remainingTenor : current.remainingTenor,
        notes: typeof body.notes === 'string' ? body.notes : current.notes,
        updatedAt: new Date(),
      })
      .where(eq(liabilities.id, numericId))
      .returning();
    return NextResponse.json({ liability: result[0] });
  } catch (err) {
    console.error('Failed to update liability:', err);
    return NextResponse.json({ error: 'Failed to update liability' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(liabilities).where(eq(liabilities.id, numericId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete liability:', err);
    return NextResponse.json({ error: 'Failed to delete liability' }, { status: 500 });
  }
}
