/**
 * Claims for a specific health-insurance policy.
 *
 *   GET   list claims (most recent first by claimDate)
 *   POST  create a claim row
 *
 * Both endpoints scope by BOTH policyId AND userId — the userId
 * predicate is technically redundant (the policy's userId already
 * gates access) but it lets the index pick the user-scoped path and
 * is a defence-in-depth check against a stale FK after a delete race.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  healthInsurancePolicies,
  healthInsuranceClaims,
  type ClaimStatus,
} from '@/db';
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

/** Verify the policy exists and belongs to the caller. Returns the
 * numeric id or a NextResponse error to return verbatim. */
async function ensurePolicy(idRaw: string, userId: string) {
  const numericId = Number(idRaw);
  if (!Number.isFinite(numericId)) {
    return { error: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) };
  }
  const rows = await db
    .select({ id: healthInsurancePolicies.id })
    .from(healthInsurancePolicies)
    .where(
      and(eq(healthInsurancePolicies.id, numericId), eq(healthInsurancePolicies.userId, userId)),
    )
    .limit(1);
  if (!rows.length) {
    return { error: NextResponse.json({ error: 'Policy not found' }, { status: 404 }) };
  }
  return { policyId: numericId };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensurePolicy(id, session.user.id);
    if ('error' in guard) return guard.error;

    const rows = await db
      .select()
      .from(healthInsuranceClaims)
      .where(
        and(
          eq(healthInsuranceClaims.policyId, guard.policyId),
          eq(healthInsuranceClaims.userId, session.user.id),
        ),
      )
      .orderBy(desc(healthInsuranceClaims.claimDate));
    return NextResponse.json({ claims: rows });
  } catch (err) {
    console.error('[health-insurance/:id/claims GET]', err);
    return NextResponse.json({ error: 'Failed to fetch claims' }, { status: 500 });
  }
}

interface CreateClaimBody {
  memberName?: string;
  cardId?: number;
  claimDate?: string;
  hospital?: string;
  diagnosis?: string;
  claimAmountRupees?: number;
  cashless?: boolean;
  status?: ClaimStatus;
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensurePolicy(id, session.user.id);
    if ('error' in guard) return guard.error;

    const body = (await request.json()) as CreateClaimBody;
    if (!body.memberName || !body.memberName.trim()) {
      return NextResponse.json({ error: 'memberName is required' }, { status: 400 });
    }
    if (!body.claimDate) {
      return NextResponse.json({ error: 'claimDate is required' }, { status: 400 });
    }
    if (typeof body.claimAmountRupees !== 'number' || !Number.isFinite(body.claimAmountRupees)) {
      return NextResponse.json({ error: 'claimAmountRupees is required' }, { status: 400 });
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const claimAmountPaisa = Math.round(body.claimAmountRupees * 100);

    const result = await db
      .insert(healthInsuranceClaims)
      .values({
        userId: session.user.id,
        policyId: guard.policyId,
        memberName: body.memberName.trim(),
        cardId: typeof body.cardId === 'number' ? body.cardId : null,
        claimDate: body.claimDate,
        hospital: body.hospital || null,
        diagnosis: body.diagnosis || null,
        claimAmountPaisa,
        cashless: body.cashless ?? true,
        status: body.status ?? 'INTIMATED',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ claim: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[health-insurance/:id/claims POST]', err);
    return NextResponse.json({ error: 'Failed to create claim' }, { status: 500 });
  }
}
