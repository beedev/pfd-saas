import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, otherSourcesIncome } from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db.select().from(otherSourcesIncome).where(and(eq(otherSourcesIncome.id, numericId), eq(otherSourcesIncome.userId, session.user.id))).limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.financialYear === 'string') update.financialYear = body.financialYear;
    if (typeof body.source === 'string') update.source = body.source;
    if (typeof body.description === 'string') update.description = body.description;
    if (typeof body.amountRupees === 'number') update.amountPaisa = Math.round(body.amountRupees * 100);
    if (typeof body.notes === 'string') update.notes = body.notes || null;

    const result = await db.update(otherSourcesIncome).set(update).where(and(eq(otherSourcesIncome.id, numericId), eq(otherSourcesIncome.userId, session.user.id))).returning();
    return NextResponse.json({ entry: result[0] });
  } catch (err) {
    console.error('Failed to update other income:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(otherSourcesIncome).where(and(eq(otherSourcesIncome.id, numericId), eq(otherSourcesIncome.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete other income:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
