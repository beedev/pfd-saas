import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, taxDeductions } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const { id } = await params;
  const row = await db
    .select()
    .from(taxDeductions)
    .where(and(eq(taxDeductions.id, Number(id)), eq(taxDeductions.userId, userId)))
    .limit(1);
  if (row.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deduction: row[0] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const { id } = await params;
  const body = await request.json();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.amountRupees === 'number') {
    update.amountPaisa = Math.round(body.amountRupees * 100);
    update.deductibleAmount = update.amountPaisa;
    update.utilizableAmount = update.amountPaisa;
  }
  for (const k of [
    'section',
    'subType',
    'description',
    'paymentDate',
    'paymentMethod',
    'recipientName',
    'recipientPan',
    'recipient80gNumber',
    'qualifyingPercent',
    'hasUpperLimit',
    'linkedAssetType',
    'linkedAssetId',
    'notes',
    'financialYear',
  ]) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  const result = await db
    .update(taxDeductions)
    .set(update)
    .where(and(eq(taxDeductions.id, Number(id)), eq(taxDeductions.userId, userId)))
    .returning();
  if (result.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deduction: result[0] });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const { id } = await params;
  await db.delete(taxDeductions).where(and(eq(taxDeductions.id, Number(id)), eq(taxDeductions.userId, userId)));
  return NextResponse.json({ ok: true });
}
