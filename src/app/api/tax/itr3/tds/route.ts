import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db, tdsCredits } from '@/db';
import { auth } from '@/auth';

const VALID_CATEGORIES = ['CONSULTING', 'INTEREST', 'RENT', 'PROPERTY', 'OTHER'] as const;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');

    const rows = fy
      ? await db.select().from(tdsCredits).where(and(eq(tdsCredits.financialYear, fy), eq(tdsCredits.userId, session.user.id))).orderBy(desc(tdsCredits.id))
      : await db.select().from(tdsCredits).where(eq(tdsCredits.userId, session.user.id)).orderBy(desc(tdsCredits.id));

    return NextResponse.json({ entries: rows });
  } catch (err) {
    console.error('Failed to list TDS credits:', err);
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const {
      financialYear,
      category,
      deductorName,
      deductorTan,
      deductorPan,
      section,
      incomeRupees,
      tdsRupees,
      notes,
    } = body;

    if (!financialYear || !deductorName || !section) {
      return NextResponse.json({ error: 'financialYear, deductorName, section required' }, { status: 400 });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    if (!deductorTan && !deductorPan) {
      return NextResponse.json({ error: 'Either deductorTan or deductorPan must be provided' }, { status: 400 });
    }
    if (typeof incomeRupees !== 'number' || typeof tdsRupees !== 'number') {
      return NextResponse.json({ error: 'incomeRupees, tdsRupees must be numbers' }, { status: 400 });
    }

    const result = await db
      .insert(tdsCredits)
      .values({
        userId: session.user.id,
        financialYear,
        category,
        deductorName,
        deductorTan: deductorTan ? String(deductorTan).trim().toUpperCase() : null,
        deductorPan: deductorPan ? String(deductorPan).trim().toUpperCase() : null,
        section,
        incomePaisa: Math.round(incomeRupees * 100),
        tdsPaisa: Math.round(tdsRupees * 100),
        notes: notes ?? null,
      })
      .returning();

    return NextResponse.json({ entry: result[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create TDS credit:', err);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
