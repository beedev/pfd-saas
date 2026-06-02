/**
 * Rental History — single-row PATCH / DELETE.
 *
 * Sprint 5.3.
 *
 * PATCH semantics:
 *   • Field-diff: only keys present in the body are touched.
 *   • Cannot change `realEstateId` or `fy` — they're the unique key
 *     of the row. Want a different (property, FY)? DELETE this row and
 *     POST a new one. We reject with 400 to make the contract explicit
 *     instead of letting the unique-index 23505 surface as a 409.
 *   • rentReceivedRupees in rupees, stored as paisa.
 *
 * DELETE: straightforward, scoped by userId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, rentalHistory } from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  realEstateId?: number;
  fy?: string;
  rentReceivedRupees?: number;
  monthsLet?: number;
  notes?: string | null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(rentalHistory)
      .where(and(eq(rentalHistory.id, numericId), eq(rentalHistory.userId, session.user.id)))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    // Immutable fields — make the rejection explicit rather than waiting
    // for the unique-index constraint to surface as a vague 409.
    if (body.realEstateId !== undefined && body.realEstateId !== existing[0].realEstateId) {
      return NextResponse.json(
        { error: 'realEstateId is immutable — delete and re-create to move the entry' },
        { status: 400 },
      );
    }
    if (body.fy !== undefined && body.fy !== existing[0].fy) {
      return NextResponse.json(
        { error: 'fy is immutable — delete and re-create to move the entry' },
        { status: 400 },
      );
    }

    const update: Partial<typeof rentalHistory.$inferInsert> = { updatedAt: new Date() };

    if (body.rentReceivedRupees !== undefined) {
      if (typeof body.rentReceivedRupees !== 'number' || !Number.isFinite(body.rentReceivedRupees) || body.rentReceivedRupees < 0) {
        return NextResponse.json({ error: 'rentReceivedRupees must be a non-negative number' }, { status: 400 });
      }
      update.rentReceivedPaisa = Math.round(body.rentReceivedRupees * 100);
    }
    if (body.monthsLet !== undefined) {
      if (!Number.isInteger(body.monthsLet) || body.monthsLet < 1 || body.monthsLet > 12) {
        return NextResponse.json({ error: 'monthsLet must be an integer 1..12' }, { status: 400 });
      }
      update.monthsLet = body.monthsLet;
    }
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(rentalHistory)
      .set(update)
      .where(and(eq(rentalHistory.id, numericId), eq(rentalHistory.userId, session.user.id)))
      .returning();
    return NextResponse.json({ row: result[0] });
  } catch (err) {
    console.error('[rental-history/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update rental history entry' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db
      .delete(rentalHistory)
      .where(and(eq(rentalHistory.id, numericId), eq(rentalHistory.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[rental-history/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete rental history entry' }, { status: 500 });
  }
}
