import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, otherSourcesIncome } from '@/db';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db.select().from(otherSourcesIncome).where(eq(otherSourcesIncome.id, numericId)).limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.financialYear === 'string') update.financialYear = body.financialYear;
    if (typeof body.source === 'string') update.source = body.source;
    if (typeof body.description === 'string') update.description = body.description;
    if (typeof body.amountRupees === 'number') update.amountPaisa = Math.round(body.amountRupees * 100);
    if (typeof body.notes === 'string') update.notes = body.notes || null;

    const result = await db.update(otherSourcesIncome).set(update).where(eq(otherSourcesIncome.id, numericId)).returning();
    return NextResponse.json({ entry: result[0] });
  } catch (err) {
    console.error('Failed to update other income:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(otherSourcesIncome).where(eq(otherSourcesIncome.id, numericId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete other income:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
