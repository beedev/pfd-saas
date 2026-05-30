import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, chitFunds } from '@/db';

interface Params {
  params: Promise<{ id: string }>;
}

// POST — close out a chit fund (status = COMPLETED)
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db.select().from(chitFunds).where(eq(chitFunds.id, numericId)).limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Chit fund not found' }, { status: 404 });

    const updated = await db
      .update(chitFunds)
      .set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(eq(chitFunds.id, numericId))
      .returning();

    return NextResponse.json({ chitFund: updated[0] });
  } catch (error) {
    console.error('Error closing chit fund:', error);
    return NextResponse.json({ error: 'Failed to close chit fund' }, { status: 500 });
  }
}
