import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, alertRules } from '@/db';
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.userId, session.user.id))
      .orderBy(desc(alertRules.createdAt));
    return NextResponse.json({ rules });
  } catch (err) {
    console.error('Failed to fetch alert rules:', err);
    return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { name, category, ruleType, symbol, assetId, operator, threshold, cooldownHours } = body;

    if (!name || !category || !ruleType || threshold === undefined) {
      return NextResponse.json(
        { error: 'name, category, ruleType, and threshold are required' },
        { status: 400 },
      );
    }

    const result = await db
      .insert(alertRules)
      .values({
        userId: session.user.id,
        name,
        category,
        ruleType,
        symbol: symbol ?? null,
        assetId: assetId ?? null,
        operator: operator ?? null,
        threshold,
        cooldownHours: cooldownHours ?? 24,
        isEnabled: true,
      })
      .returning();

    return NextResponse.json({ rule: result[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create alert rule:', err);
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}
