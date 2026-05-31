import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, chitFunds } from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

// POST — close out a chit fund (status = COMPLETED)
export async function POST(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(chitFunds)
      .where(and(eq(chitFunds.id, numericId), eq(chitFunds.userId, session.user.id)))
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Chit fund not found' }, { status: 404 });

    const updated = await db
      .update(chitFunds)
      .set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(and(eq(chitFunds.id, numericId), eq(chitFunds.userId, session.user.id)))
      .returning();

    return NextResponse.json({ chitFund: updated[0] });
  } catch (error) {
    console.error('Error closing chit fund:', error);
    return NextResponse.json({ error: 'Failed to close chit fund' }, { status: 500 });
  }
}
