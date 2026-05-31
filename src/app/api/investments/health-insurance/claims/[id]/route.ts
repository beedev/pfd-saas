/**
 * Update or delete a single health-insurance claim.
 *
 * Typical usage is to record the insurer's settlement decision — set
 * status to APPROVED/PARTIAL/SETTLED/REJECTED, fill in
 * approvedAmountPaisa + settlementDate, optionally rejectionReason.
 *
 * Lives at /api/investments/health-insurance/claims/[id] rather than
 * nested under /policies/[id]/claims/[id] because the claim has its
 * own stable id and the parent policy is recoverable via the
 * claim.policyId column — keeps URL/grant patterns simple.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, healthInsuranceClaims, type ClaimStatus } from '@/db';
import { auth } from '@/auth';

const VALID_STATUSES: ClaimStatus[] = [
  'INTIMATED',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'PARTIAL',
  'REJECTED',
  'SETTLED',
];

interface Params {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  status?: ClaimStatus;
  approvedAmountRupees?: number | null;
  settlementDate?: string | null;
  rejectionReason?: string | null;
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
      .from(healthInsuranceClaims)
      .where(
        and(eq(healthInsuranceClaims.id, numericId), eq(healthInsuranceClaims.userId, session.user.id)),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;
    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const update: Partial<typeof healthInsuranceClaims.$inferInsert> = { updatedAt: new Date() };
    if (body.status !== undefined) update.status = body.status;
    if (body.approvedAmountRupees === null) {
      update.approvedAmountPaisa = null;
    } else if (typeof body.approvedAmountRupees === 'number' && Number.isFinite(body.approvedAmountRupees)) {
      update.approvedAmountPaisa = Math.round(body.approvedAmountRupees * 100);
    }
    if (body.settlementDate !== undefined) update.settlementDate = body.settlementDate;
    if (body.rejectionReason !== undefined) update.rejectionReason = body.rejectionReason;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(healthInsuranceClaims)
      .set(update)
      .where(
        and(eq(healthInsuranceClaims.id, numericId), eq(healthInsuranceClaims.userId, session.user.id)),
      )
      .returning();
    return NextResponse.json({ claim: result[0] });
  } catch (err) {
    console.error('[health-insurance/claims/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update claim' }, { status: 500 });
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
      .delete(healthInsuranceClaims)
      .where(
        and(eq(healthInsuranceClaims.id, numericId), eq(healthInsuranceClaims.userId, session.user.id)),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[health-insurance/claims/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete claim' }, { status: 500 });
  }
}
