/**
 * Health Insurance Policy — detail (with cards + portability), partial
 * update, delete.
 *
 * GET returns the policy plus all its cards and the (single) portability
 * record. Three separate SELECTs because Drizzle's relational query
 * builder would require a `relations()` declaration we don't have for
 * these tables yet, and three round-trips against a local PG are cheaper
 * than the cognitive cost of GROUP_CONCAT shenanigans.
 *
 * PATCH only touches fields actually present in the body — so callers
 * can ship a single-field diff (e.g. `{status: 'LAPSED'}`) without
 * worrying about clobbering everything else. Money fields arrive as
 * rupees and are converted to paisa via rupeesToPaisa().
 *
 * DELETE relies on FK ON DELETE CASCADE for cards/claims/portability;
 * a single statement collapses the entire subtree.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  healthInsurancePolicies,
  healthInsuranceCards,
  healthInsurancePortability,
  type HealthPolicyType,
  type HealthPolicyStatus,
  type PremiumFrequency,
} from '@/db';
import { auth } from '@/auth';

const VALID_POLICY_TYPES: HealthPolicyType[] = [
  'INDIVIDUAL',
  'FAMILY_FLOATER',
  'TOPUP',
  'SUPER_TOPUP',
  'CRITICAL_ILLNESS',
  'OPD_RIDER',
];

const VALID_STATUSES: HealthPolicyStatus[] = [
  'ACTIVE',
  'LAPSED',
  'PORTED_OUT',
  'CANCELLED',
  'CLAIM_SETTLED',
];

const VALID_FREQUENCIES: PremiumFrequency[] = ['ANNUAL', 'SEMI_ANNUAL', 'QUARTERLY', 'MONTHLY'];

interface Params {
  params: Promise<{ id: string }>;
}

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const policyRows = await db
      .select()
      .from(healthInsurancePolicies)
      .where(
        and(
          eq(healthInsurancePolicies.id, numericId),
          eq(healthInsurancePolicies.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!policyRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Both children scoped by userId in addition to policyId — defence
    // in depth in case a stale FK ever survives a delete race.
    const cards = await db
      .select()
      .from(healthInsuranceCards)
      .where(
        and(
          eq(healthInsuranceCards.policyId, numericId),
          eq(healthInsuranceCards.userId, session.user.id),
        ),
      )
      .orderBy(asc(healthInsuranceCards.id));

    const portabilityRows = await db
      .select()
      .from(healthInsurancePortability)
      .where(
        and(
          eq(healthInsurancePortability.policyId, numericId),
          eq(healthInsurancePortability.userId, session.user.id),
        ),
      )
      .limit(1);

    return NextResponse.json({
      policy: policyRows[0],
      cards,
      portability: portabilityRows[0] ?? null,
    });
  } catch (err) {
    console.error('[health-insurance/:id GET]', err);
    return NextResponse.json({ error: 'Failed to fetch policy' }, { status: 500 });
  }
}

interface PatchBody {
  insurer?: string;
  policyNumber?: string;
  policyType?: HealthPolicyType;
  status?: HealthPolicyStatus;
  policyHolder?: string;
  sumInsuredRupees?: number;
  cumulativeBonusRupees?: number;
  ncbPercent?: number;
  premiumRupees?: number;
  premiumFrequency?: PremiumFrequency;
  startDate?: string;
  renewalDate?: string | null;
  lastRenewedDate?: string | null;
  waitingPeriodMonths?: number;
  servedWaitingMonths?: number;
  preExistingDiseases?: string | null;
  cashlessAvailable?: boolean;
  networkHospitalCount?: number | null;
  policyDocumentPath?: string | null;
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
      .from(healthInsurancePolicies)
      .where(
        and(
          eq(healthInsurancePolicies.id, numericId),
          eq(healthInsurancePolicies.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    if (body.policyType !== undefined && !VALID_POLICY_TYPES.includes(body.policyType)) {
      return NextResponse.json({ error: 'Invalid policyType' }, { status: 400 });
    }
    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (body.premiumFrequency !== undefined && !VALID_FREQUENCIES.includes(body.premiumFrequency)) {
      return NextResponse.json({ error: 'Invalid premiumFrequency' }, { status: 400 });
    }

    const update: Partial<typeof healthInsurancePolicies.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.insurer === 'string' && body.insurer.trim()) update.insurer = body.insurer.trim();
    if (typeof body.policyNumber === 'string' && body.policyNumber.trim()) {
      update.policyNumber = body.policyNumber.trim();
    }
    if (body.policyType !== undefined) update.policyType = body.policyType;
    if (body.status !== undefined) update.status = body.status;
    if (typeof body.policyHolder === 'string' && body.policyHolder.trim()) {
      update.policyHolder = body.policyHolder.trim();
    }
    const sumInsured = rupeesToPaisa(body.sumInsuredRupees);
    if (sumInsured !== undefined) update.sumInsuredPaisa = sumInsured;
    const cumBonus = rupeesToPaisa(body.cumulativeBonusRupees);
    if (cumBonus !== undefined) update.cumulativeBonusPaisa = cumBonus;
    if (typeof body.ncbPercent === 'number') update.ncbPercent = body.ncbPercent;
    const premium = rupeesToPaisa(body.premiumRupees);
    if (premium !== undefined) update.premiumPaisa = premium;
    if (body.premiumFrequency !== undefined) update.premiumFrequency = body.premiumFrequency;
    if (typeof body.startDate === 'string' && body.startDate) update.startDate = body.startDate;
    if (body.renewalDate !== undefined) update.renewalDate = body.renewalDate;
    if (body.lastRenewedDate !== undefined) update.lastRenewedDate = body.lastRenewedDate;
    if (typeof body.waitingPeriodMonths === 'number') {
      update.waitingPeriodMonths = body.waitingPeriodMonths;
    }
    if (typeof body.servedWaitingMonths === 'number') {
      update.servedWaitingMonths = body.servedWaitingMonths;
    }
    if (body.preExistingDiseases !== undefined) update.preExistingDiseases = body.preExistingDiseases;
    if (typeof body.cashlessAvailable === 'boolean') update.cashlessAvailable = body.cashlessAvailable;
    if (body.networkHospitalCount !== undefined) update.networkHospitalCount = body.networkHospitalCount;
    if (body.policyDocumentPath !== undefined) update.policyDocumentPath = body.policyDocumentPath;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(healthInsurancePolicies)
      .set(update)
      .where(
        and(
          eq(healthInsurancePolicies.id, numericId),
          eq(healthInsurancePolicies.userId, session.user.id),
        ),
      )
      .returning();
    return NextResponse.json({ policy: result[0] });
  } catch (err) {
    console.error('[health-insurance/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update policy' }, { status: 500 });
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
    // FK ON DELETE CASCADE handles cards/claims/portability automatically.
    await db
      .delete(healthInsurancePolicies)
      .where(
        and(
          eq(healthInsurancePolicies.id, numericId),
          eq(healthInsurancePolicies.userId, session.user.id),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[health-insurance/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete policy' }, { status: 500 });
  }
}
