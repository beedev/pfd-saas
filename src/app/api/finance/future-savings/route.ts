/**
 * GET    /api/finance/future-savings  — current plan { lumpSumPaisa, monthlyPaisa }
 * PATCH  /api/finance/future-savings  — body: { lumpSumPaisa?, monthlyPaisa? }
 *
 * Singleton row per user. Both fields default to 0 on first load. Either field
 * may be PATCHed independently; null/undefined values leave that field as-is.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, futureSavingsPlan } from '@/db';
import { auth } from '@/auth';

async function ensureRow(userId: string) {
  const rows = await db
    .select()
    .from(futureSavingsPlan)
    .where(eq(futureSavingsPlan.userId, userId))
    .limit(1);
  if (rows.length) return rows[0];
  const [inserted] = await db
    .insert(futureSavingsPlan)
    .values({ userId, lumpSumPaisa: 0, monthlyPaisa: 0 })
    .returning();
  return inserted;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const plan = await ensureRow(session.user.id);
    return NextResponse.json({
      lumpSumPaisa: plan.lumpSumPaisa,
      monthlyPaisa: plan.monthlyPaisa,
      updatedAt: plan.updatedAt,
    });
  } catch (err) {
    console.error('GET future-savings:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const update: Partial<typeof futureSavingsPlan.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.lumpSumPaisa === 'number' && body.lumpSumPaisa >= 0) {
      update.lumpSumPaisa = Math.round(body.lumpSumPaisa);
    }
    if (typeof body.monthlyPaisa === 'number' && body.monthlyPaisa >= 0) {
      update.monthlyPaisa = Math.round(body.monthlyPaisa);
    }
    if (Object.keys(update).length === 1) {
      // Only updatedAt was set — nothing meaningful changed.
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const existing = await ensureRow(session.user.id);
    const [updated] = await db
      .update(futureSavingsPlan)
      .set(update)
      .where(and(eq(futureSavingsPlan.id, existing.id), eq(futureSavingsPlan.userId, session.user.id)))
      .returning();

    return NextResponse.json({
      lumpSumPaisa: updated.lumpSumPaisa,
      monthlyPaisa: updated.monthlyPaisa,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    console.error('PATCH future-savings:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
