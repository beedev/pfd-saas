import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db, incomeTaxPaid } from '@/db';
import { auth } from '@/auth';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const rows = await db
      .select()
      .from(incomeTaxPaid)
      .where(and(eq(incomeTaxPaid.financialYear, fy), eq(incomeTaxPaid.userId, session.user.id)))
      .orderBy(desc(incomeTaxPaid.paymentDate));

    const total = rows.reduce((s, r) => s + r.amount, 0);

    return NextResponse.json({ payments: rows, totalPaisa: total });
  } catch (err) {
    console.error('[tax-paid GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { financialYear, paymentType, amount, paymentDate, referenceNumber, notes } = body;

    if (!financialYear || !paymentType || !amount || !paymentDate) {
      return NextResponse.json({ error: 'financialYear, paymentType, amount, paymentDate required' }, { status: 400 });
    }

    const result = await db.insert(incomeTaxPaid).values({
      userId: session.user.id,
      financialYear,
      paymentType,
      amount: Math.round(amount * 100),
      paymentDate,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
    }).returning();

    return NextResponse.json({ payment: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[tax-paid POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await db.delete(incomeTaxPaid).where(and(eq(incomeTaxPaid.id, id), eq(incomeTaxPaid.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[tax-paid DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
