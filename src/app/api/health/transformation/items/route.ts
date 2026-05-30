import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, transformationItems } from '@/db';

// Normalise a kind value to one of the three supported kinds.
function normalizeKind(k: unknown): 'check' | 'text' | 'multi' {
  return k === 'text' || k === 'multi' ? k : 'check';
}

// Serialise an options payload (array of non-empty strings) to JSON, or null.
function serializeOptions(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const clean = raw
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.trim())
    .filter(Boolean);
  return clean.length ? JSON.stringify(clean) : null;
}

// POST — create item
// Body: { sectionId, label, sortOrder?, kind? ('check'|'text'|'multi'), options?: string[] }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.sectionId !== 'number') {
      return NextResponse.json({ error: 'sectionId required' }, { status: 400 });
    }
    if (typeof body.label !== 'string' || !body.label.trim()) {
      return NextResponse.json({ error: 'label required' }, { status: 400 });
    }
    const kind = normalizeKind(body.kind);
    const inserted = await db
      .insert(transformationItems)
      .values({
        sectionId: body.sectionId,
        label: body.label.trim(),
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 999,
        kind,
        options: kind === 'multi' ? serializeOptions(body.options) : null,
      })
      .returning();
    return NextResponse.json({ item: inserted[0] });
  } catch (err) {
    console.error('POST item failed:', err);
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
  }
}

// PATCH — rename, reorder, move section, toggle kind, or edit options
// Body: { id, label?, sortOrder?, sectionId?, kind?, options?: string[] }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.id !== 'number') {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const update: Partial<typeof transformationItems.$inferInsert> = {};
    if (typeof body.label === 'string') update.label = body.label.trim();
    if (typeof body.sortOrder === 'number') update.sortOrder = body.sortOrder;
    if (typeof body.sectionId === 'number') update.sectionId = body.sectionId;
    if (body.kind === 'check' || body.kind === 'text' || body.kind === 'multi') {
      update.kind = body.kind;
    }
    if (body.options !== undefined) update.options = serializeOptions(body.options);
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }
    const result = await db
      .update(transformationItems)
      .set(update)
      .where(eq(transformationItems.id, body.id))
      .returning();
    return NextResponse.json({ item: result[0] });
  } catch (err) {
    console.error('PATCH item failed:', err);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
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
      .update(transformationItems)
      .set({ deletedAt: Math.floor(Date.now() / 1000) })
      .where(eq(transformationItems.id, body.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE item failed:', err);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
