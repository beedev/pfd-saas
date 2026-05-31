import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db, otherSourcesIncome } from '@/db';
import { auth } from '@/auth';

const VALID_SOURCES = ['BANK_INTEREST', 'FD_INTEREST', 'PF_INTEREST', 'DIVIDEND', 'OTHER'] as const;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    const rows = fy
      ? await db.select().from(otherSourcesIncome).where(and(eq(otherSourcesIncome.financialYear, fy), eq(otherSourcesIncome.userId, session.user.id))).orderBy(desc(otherSourcesIncome.id))
      : await db.select().from(otherSourcesIncome).where(eq(otherSourcesIncome.userId, session.user.id)).orderBy(desc(otherSourcesIncome.id));
    return NextResponse.json({ entries: rows });
  } catch (err) {
    console.error('Failed to list other income:', err);
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { financialYear, source, description, amountRupees, notes } = body;
    if (!financialYear || !source || !description) {
      return NextResponse.json({ error: 'financialYear, source, description required' }, { status: 400 });
    }
    if (!VALID_SOURCES.includes(source)) {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
    }
    if (typeof amountRupees !== 'number') {
      return NextResponse.json({ error: 'amountRupees required' }, { status: 400 });
    }
    const result = await db
      .insert(otherSourcesIncome)
      .values({
        userId: session.user.id,
        financialYear,
        source,
        description,
        amountPaisa: Math.round(amountRupees * 100),
        notes: notes ?? null,
      })
      .returning();
    return NextResponse.json({ entry: result[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create other income:', err);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
