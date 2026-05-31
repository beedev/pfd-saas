/**
 * Update or delete a single PUC certificate.
 *
 * Scope is enforced by user_id on every statement — global serial IDs
 * mean userId is the only thing keeping tenants apart.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, vehiclePuc } from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

interface PatchBody {
  certificateNumber?: string;
  issuedDate?: string;
  validUntil?: string;
  issuingAuthority?: string | null;
  costRupees?: number;
  certificatePath?: string | null;
  notes?: string | null;
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
    const existing = await db
      .select()
      .from(vehiclePuc)
      .where(and(eq(vehiclePuc.id, numericId), eq(vehiclePuc.userId, session.user.id)))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    const update: Partial<typeof vehiclePuc.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.certificateNumber === 'string' && body.certificateNumber.trim()) {
      update.certificateNumber = body.certificateNumber.trim();
    }
    if (typeof body.issuedDate === 'string' && body.issuedDate) update.issuedDate = body.issuedDate;
    if (typeof body.validUntil === 'string' && body.validUntil) update.validUntil = body.validUntil;
    if (body.issuingAuthority !== undefined) update.issuingAuthority = body.issuingAuthority;
    const cost = rupeesToPaisa(body.costRupees);
    if (cost !== undefined) update.costPaisa = cost;
    if (body.certificatePath !== undefined) update.certificatePath = body.certificatePath;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(vehiclePuc)
      .set(update)
      .where(and(eq(vehiclePuc.id, numericId), eq(vehiclePuc.userId, session.user.id)))
      .returning();
    return NextResponse.json({ puc: result[0] });
  } catch (err) {
    console.error('[vehicles/puc/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update PUC certificate' }, { status: 500 });
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
      .delete(vehiclePuc)
      .where(and(eq(vehiclePuc.id, numericId), eq(vehiclePuc.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[vehicles/puc/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete PUC certificate' }, { status: 500 });
  }
}
