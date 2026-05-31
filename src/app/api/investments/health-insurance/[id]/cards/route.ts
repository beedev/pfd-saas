/**
 * Cards for a specific health-insurance policy.
 *
 *   GET   list cards, with the SELF row always pinned to the top
 *         (family floater UIs almost universally show the primary
 *         insured first; rest follow by insertion order)
 *   POST  create a card row (metadata only — image upload is a
 *         separate endpoint at /cards/[id]/upload)
 *
 * Both endpoints scope by BOTH policyId AND userId for defence in
 * depth — even though policy ownership already gates this resource.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  db,
  healthInsurancePolicies,
  healthInsuranceCards,
  type FamilyRelationship,
} from '@/db';
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

    // `relationship = 'SELF' DESC` puts the primary insured first;
    // rest fall through to id-asc so the order is stable across loads.
    const rows = await db
      .select()
      .from(healthInsuranceCards)
      .where(
        and(
          eq(healthInsuranceCards.policyId, guard.policyId),
          eq(healthInsuranceCards.userId, session.user.id),
        ),
      )
      .orderBy(
        sql`(${healthInsuranceCards.relationship} = 'SELF') DESC`,
        asc(healthInsuranceCards.id),
      );
    return NextResponse.json({ cards: rows });
  } catch (err) {
    console.error('[health-insurance/:id/cards GET]', err);
    return NextResponse.json({ error: 'Failed to fetch cards' }, { status: 500 });
  }
}

interface CreateCardBody {
  memberName?: string;
  memberId?: string;
  relationship?: FamilyRelationship;
  dateOfBirth?: string;
  gender?: string;
  eCardUrl?: string;
  validUntil?: string;
  notes?: string;
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensurePolicy(id, session.user.id);
    if ('error' in guard) return guard.error;

    const body = (await request.json()) as CreateCardBody;
    if (!body.memberName || !body.memberName.trim()) {
      return NextResponse.json({ error: 'memberName is required' }, { status: 400 });
    }
    if (!body.relationship || !VALID_RELATIONSHIPS.includes(body.relationship)) {
      return NextResponse.json({ error: 'relationship is required' }, { status: 400 });
    }

    const result = await db
      .insert(healthInsuranceCards)
      .values({
        userId: session.user.id,
        policyId: guard.policyId,
        memberName: body.memberName.trim(),
        memberId: body.memberId || null,
        relationship: body.relationship,
        dateOfBirth: body.dateOfBirth || null,
        gender: body.gender || null,
        eCardUrl: body.eCardUrl || null,
        validUntil: body.validUntil || null,
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ card: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[health-insurance/:id/cards POST]', err);
    return NextResponse.json({ error: 'Failed to create card' }, { status: 500 });
  }
}
