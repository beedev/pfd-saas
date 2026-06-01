/**
 * Transformation tracker — sections CRUD.
 *
 * POST   create a section under the user's plan.
 * PATCH  rename or reorder a section.
 * DELETE soft-delete (sets deletedAt; checks history stays intact).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, transformationPlans, transformationSections } from '@/db';
import { auth } from '@/auth';

// POST /api/health/transformation/sections
// Body: { name, sortOrder? }
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const body = await request.json();
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    const planRows = await db
      .select()
      .from(transformationPlans)
      .where(eq(transformationPlans.userId, session.user.id))
      .limit(1);
    if (!planRows.length) {
      return NextResponse.json({ error: 'No plan found' }, { status: 404 });
    }
    const inserted = await db
      .insert(transformationSections)
      .values({
        userId: session.user.id,
        planId: planRows[0].id,
        name: body.name.trim(),
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 999,
        createdAt: new Date(),
      })
      .returning();
    return NextResponse.json({ section: inserted[0] });
  } catch (err) {
    console.error('[transformation sections POST]', err);
    return NextResponse.json({ error: 'Failed to create section' }, { status: 500 });
  }
}

// PATCH — rename or reorder
// Body: { id, name?, sortOrder? }
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const body = await request.json();
    if (typeof body.id !== 'number') {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const update: Partial<typeof transformationSections.$inferInsert> = {};
    if (typeof body.name === 'string') update.name = body.name.trim();
    if (typeof body.sortOrder === 'number') update.sortOrder = body.sortOrder;
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }
    const result = await db
      .update(transformationSections)
      .set(update)
      .where(
        and(
          eq(transformationSections.userId, session.user.id),
          eq(transformationSections.id, body.id),
        ),
      )
      .returning();
    return NextResponse.json({ section: result[0] });
  } catch (err) {
    console.error('[transformation sections PATCH]', err);
    return NextResponse.json({ error: 'Failed to update section' }, { status: 500 });
  }
}

// DELETE — soft delete
// Body: { id }
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const body = await request.json();
    if (typeof body.id !== 'number') {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    await db
      .update(transformationSections)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(transformationSections.userId, session.user.id),
          eq(transformationSections.id, body.id),
        ),
      );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[transformation sections DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete section' }, { status: 500 });
  }
}
