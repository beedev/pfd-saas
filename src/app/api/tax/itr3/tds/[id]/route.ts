import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, tdsCredits } from '@/db';
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
    const existing = await db.select().from(tdsCredits).where(and(eq(tdsCredits.id, numericId), eq(tdsCredits.userId, session.user.id))).limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.financialYear === 'string') update.financialYear = body.financialYear;
    if (typeof body.category === 'string') update.category = body.category;
    if (typeof body.deductorName === 'string') update.deductorName = body.deductorName;
    if (body.deductorTan !== undefined) update.deductorTan = body.deductorTan ? String(body.deductorTan).trim().toUpperCase() : null;
    if (body.deductorPan !== undefined) update.deductorPan = body.deductorPan ? String(body.deductorPan).trim().toUpperCase() : null;
    if (typeof body.section === 'string') update.section = body.section;
    if (typeof body.incomeRupees === 'number') update.incomePaisa = Math.round(body.incomeRupees * 100);
    if (typeof body.tdsRupees === 'number') update.tdsPaisa = Math.round(body.tdsRupees * 100);
    if (typeof body.notes === 'string') update.notes = body.notes || null;

    const result = await db.update(tdsCredits).set(update).where(and(eq(tdsCredits.id, numericId), eq(tdsCredits.userId, session.user.id))).returning();
    return NextResponse.json({ entry: result[0] });
  } catch (err) {
    console.error('Failed to update TDS credit:', err);
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
    await db.delete(tdsCredits).where(and(eq(tdsCredits.id, numericId), eq(tdsCredits.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete TDS credit:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
