import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, alertRules } from '@/db';
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

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.category !== undefined) updates.category = body.category;
    if (body.ruleType !== undefined) updates.ruleType = body.ruleType;
    if (body.symbol !== undefined) updates.symbol = body.symbol;
    if (body.assetId !== undefined) updates.assetId = body.assetId;
    if (body.operator !== undefined) updates.operator = body.operator;
    if (body.threshold !== undefined) updates.threshold = body.threshold;
    if (body.isEnabled !== undefined) updates.isEnabled = body.isEnabled;
    if (body.cooldownHours !== undefined) updates.cooldownHours = body.cooldownHours;

    const result = await db
      .update(alertRules)
      .set(updates)
      .where(and(eq(alertRules.id, numericId), eq(alertRules.userId, session.user.id)))
      .returning();

    if (!result.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ rule: result[0] });
  } catch (err) {
    console.error('Failed to update alert rule:', err);
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
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
    await db
      .delete(alertRules)
      .where(and(eq(alertRules.id, numericId), eq(alertRules.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete alert rule:', err);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
