/**
 * Portability record for a health-insurance policy.
 *
 *   GET  returns the (single) portability row for the policy, or null
 *        if the policy was never ported in. The UI uses null to show
 *        a "this is a fresh policy" badge.
 *   PUT  upsert — if a row exists for this policy, UPDATE; otherwise
 *        INSERT. There is at most one portability record per policy
 *        (a policy is either ported-in once or not at all; subsequent
 *        ports create a new policy entirely).
 *
 * We don't expose POST/PATCH/DELETE separately because the upsert
 * semantics are exactly what callers want — they always have a full
 * portability payload (the port-in event happens once), and clearing
 * it is rare enough to handle via DELETE on the policy itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, healthInsurancePolicies, healthInsurancePortability } from '@/db';
import { auth } from '@/auth';

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

    const rows = await db
      .select()
      .from(healthInsurancePortability)
      .where(
        and(
          eq(healthInsurancePortability.policyId, guard.policyId),
          eq(healthInsurancePortability.userId, session.user.id),
        ),
      )
      .limit(1);
    return NextResponse.json({ portability: rows[0] ?? null });
  } catch (err) {
    console.error('[health-insurance/:id/portability GET]', err);
    return NextResponse.json({ error: 'Failed to fetch portability' }, { status: 500 });
  }
}

interface PutBody {
  previousInsurer?: string;
  previousPolicyNumber?: string | null;
  portedDate?: string;
  portedSumInsuredRupees?: number | null;
  waitingPeriodUsedMonths?: number;
  ncbCarriedPercent?: number;
  notes?: string | null;
}

export async function PUT(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensurePolicy(id, session.user.id);
    if ('error' in guard) return guard.error;

    const body = (await request.json()) as PutBody;
    if (!body.previousInsurer || !body.previousInsurer.trim()) {
      return NextResponse.json({ error: 'previousInsurer is required' }, { status: 400 });
    }
    if (!body.portedDate) {
      return NextResponse.json({ error: 'portedDate is required' }, { status: 400 });
    }
    if (typeof body.waitingPeriodUsedMonths !== 'number' || !Number.isFinite(body.waitingPeriodUsedMonths)) {
      return NextResponse.json({ error: 'waitingPeriodUsedMonths is required' }, { status: 400 });
    }

    const portedSumInsuredPaisa =
      typeof body.portedSumInsuredRupees === 'number' && Number.isFinite(body.portedSumInsuredRupees)
        ? Math.round(body.portedSumInsuredRupees * 100)
        : body.portedSumInsuredRupees === null
          ? null
          : undefined;

    const existing = await db
      .select()
      .from(healthInsurancePortability)
      .where(
        and(
          eq(healthInsurancePortability.policyId, guard.policyId),
          eq(healthInsurancePortability.userId, session.user.id),
        ),
      )
      .limit(1);

    if (existing.length) {
      const update: Partial<typeof healthInsurancePortability.$inferInsert> = {
        previousInsurer: body.previousInsurer.trim(),
        previousPolicyNumber: body.previousPolicyNumber ?? null,
        portedDate: body.portedDate,
        waitingPeriodUsedMonths: body.waitingPeriodUsedMonths,
        ncbCarriedPercent: typeof body.ncbCarriedPercent === 'number' ? body.ncbCarriedPercent : 0,
        notes: body.notes ?? null,
        updatedAt: new Date(),
      };
      if (portedSumInsuredPaisa !== undefined) update.portedSumInsuredPaisa = portedSumInsuredPaisa;

      const result = await db
        .update(healthInsurancePortability)
        .set(update)
        .where(
          and(
            eq(healthInsurancePortability.policyId, guard.policyId),
            eq(healthInsurancePortability.userId, session.user.id),
          ),
        )
        .returning();
      return NextResponse.json({ portability: result[0] });
    }

    const result = await db
      .insert(healthInsurancePortability)
      .values({
        userId: session.user.id,
        policyId: guard.policyId,
        previousInsurer: body.previousInsurer.trim(),
        previousPolicyNumber: body.previousPolicyNumber ?? null,
        portedDate: body.portedDate,
        portedSumInsuredPaisa: portedSumInsuredPaisa ?? null,
        waitingPeriodUsedMonths: body.waitingPeriodUsedMonths,
        ncbCarriedPercent: typeof body.ncbCarriedPercent === 'number' ? body.ncbCarriedPercent : 0,
        notes: body.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return NextResponse.json({ portability: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[health-insurance/:id/portability PUT]', err);
    return NextResponse.json({ error: 'Failed to save portability' }, { status: 500 });
  }
}
