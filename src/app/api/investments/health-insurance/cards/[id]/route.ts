/**
 * Update or delete a single health-insurance card.
 *
 * DELETE also unlinks the uploaded card image from disk (if any),
 * so we don't leave orphan blobs in uploads/<userId>/health-cards/. The DB row
 * delete will null the FK on any claims (cardId is ON DELETE SET NULL),
 * so claim history survives even after a card is removed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, healthInsuranceCards, type FamilyRelationship } from '@/db';
import { auth } from '@/auth';

const VALID_RELATIONSHIPS: FamilyRelationship[] = [
  'SELF',
  'SPOUSE',
  'SON',
  'DAUGHTER',
  'FATHER',
  'MOTHER',
  'FATHER_IN_LAW',
  'MOTHER_IN_LAW',
  'OTHER',
];

interface Params {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  memberName?: string;
  memberId?: string | null;
  relationship?: FamilyRelationship;
  dateOfBirth?: string | null;
  gender?: string | null;
  eCardUrl?: string | null;
  validUntil?: string | null;
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
      .from(healthInsuranceCards)
      .where(
        and(eq(healthInsuranceCards.id, numericId), eq(healthInsuranceCards.userId, session.user.id)),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;
    if (body.relationship !== undefined && !VALID_RELATIONSHIPS.includes(body.relationship)) {
      return NextResponse.json({ error: 'Invalid relationship' }, { status: 400 });
    }

    const update: Partial<typeof healthInsuranceCards.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.memberName === 'string' && body.memberName.trim()) {
      update.memberName = body.memberName.trim();
    }
    if (body.memberId !== undefined) update.memberId = body.memberId;
    if (body.relationship !== undefined) update.relationship = body.relationship;
    if (body.dateOfBirth !== undefined) update.dateOfBirth = body.dateOfBirth;
    if (body.gender !== undefined) update.gender = body.gender;
    if (body.eCardUrl !== undefined) update.eCardUrl = body.eCardUrl;
    if (body.validUntil !== undefined) update.validUntil = body.validUntil;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(healthInsuranceCards)
      .set(update)
      .where(
        and(eq(healthInsuranceCards.id, numericId), eq(healthInsuranceCards.userId, session.user.id)),
      )
      .returning();
    return NextResponse.json({ card: result[0] });
  } catch (err) {
    console.error('[health-insurance/cards/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update card' }, { status: 500 });
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

    // Fetch first so we can clean up the uploaded image (if any).
    const existing = await db
      .select()
      .from(healthInsuranceCards)
      .where(
        and(eq(healthInsuranceCards.id, numericId), eq(healthInsuranceCards.userId, session.user.id)),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const imagePath = existing[0].cardImagePath;
    if (imagePath) {
      // Best-effort cleanup. Missing file is fine — we just don't want
      // a failed unlink to abort the DB delete.
      try {
        const abs = path.resolve(process.cwd(), imagePath);
        if (fs.existsSync(abs)) await fs.promises.unlink(abs);
      } catch (cleanupErr) {
        console.warn('[health-insurance/cards/:id DELETE] image cleanup failed', cleanupErr);
      }
    }

    await db
      .delete(healthInsuranceCards)
      .where(
        and(eq(healthInsuranceCards.id, numericId), eq(healthInsuranceCards.userId, session.user.id)),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[health-insurance/cards/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete card' }, { status: 500 });
  }
}
