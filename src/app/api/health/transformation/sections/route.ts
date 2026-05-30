import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, transformationPlans, transformationSections } from '@/db';

// POST /api/health/transformation/sections — create a new section
// Body: { name, sortOrder? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    const planRows = await db.select().from(transformationPlans).limit(1);
    if (!planRows.length) {
      return NextResponse.json({ error: 'No plan found' }, { status: 404 });
    }
    const planId = planRows[0].id;
    const inserted = await db
      .insert(transformationSections)
      .values({
        planId,
        name: body.name.trim(),
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 999,
      })
      .returning();
    return NextResponse.json({ section: inserted[0] });
  } catch (err) {
    console.error('POST section failed:', err);
    return NextResponse.json({ error: 'Failed to create section' }, { status: 500 });
  }
}

// PATCH — rename or reorder
// Body: { id, name?, sortOrder? }
export async function PATCH(request: NextRequest) {
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
      .where(eq(transformationSections.id, body.id))
      .returning();
    return NextResponse.json({ section: result[0] });
  } catch (err) {
    console.error('PATCH section failed:', err);
    return NextResponse.json({ error: 'Failed to update section' }, { status: 500 });
  }
}

// DELETE — soft delete
// Body: { id }
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.id !== 'number') {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    await db
      .update(transformationSections)
      .set({ deletedAt: Math.floor(Date.now() / 1000) })
      .where(eq(transformationSections.id, body.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE section failed:', err);
    return NextResponse.json({ error: 'Failed to delete section' }, { status: 500 });
  }
}
