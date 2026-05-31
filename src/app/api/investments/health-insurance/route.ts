/**
 * Health Insurance Policies — list + create.
 *
 * Separate namespace from /api/investments/insurance/* (which owns
 * life / term / ULIP / endowment / whole-life). Health policies have
 * their own family of tables (policies, cards, claims, portability)
 * because the schema diverges significantly from life policies — there
 * is no maturity benefit, but there is cumulative bonus, waiting
 * period, network hospitals, per-member cards, and claim history.
 *
 * Money values arrive as RUPEES (number) and are stored as PAISA
 * (integer) to avoid floating-point drift. Dates arrive as ISO strings
 * ("2026-05-31") and are stored as text — Postgres will accept either
 * but we keep the column type as text so day-precision dates round-trip
 * losslessly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  db,
  healthInsurancePolicies,
  healthInsuranceCards,
  healthInsuranceClaims,
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

/**
 * Drizzle wraps the underlying PostgresError as `cause`. Walk the
 * cause chain to find the SQLSTATE code — needed so we can map
 * unique-violation (23505) into a friendly 409 instead of a 500.
 */
function findPgError(err: unknown): { code?: string; detail?: string } {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const c = cur as { code?: unknown; detail?: unknown; cause?: unknown };
      if (typeof c.code === 'string') {
        return {
          code: c.code,
          detail: typeof c.detail === 'string' ? c.detail : '',
        };
      }
      cur = c.cause;
    } else {
      break;
    }
  }
  return {};
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    // One round-trip: policy rows with card/claim counts via correlated
    // subqueries. Using correlated COUNTs (rather than LEFT JOIN +
    // GROUP BY) keeps each policy row whole and avoids row-multiplication
    // surprises if a policy has both cards and claims.
    const rows = await db
      .select({
        policy: healthInsurancePolicies,
        cardCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${healthInsuranceCards}
          WHERE ${healthInsuranceCards.policyId} = ${healthInsurancePolicies.id}
        )`,
        claimCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${healthInsuranceClaims}
          WHERE ${healthInsuranceClaims.policyId} = ${healthInsurancePolicies.id}
        )`,
      })
      .from(healthInsurancePolicies)
      .where(eq(healthInsurancePolicies.userId, session.user.id))
      .orderBy(asc(healthInsurancePolicies.renewalDate));

    const policies = rows.map((r) => ({
      ...r.policy,
      cardCount: r.cardCount,
      claimCount: r.claimCount,
    }));
    return NextResponse.json({ policies });
  } catch (err) {
    console.error('[health-insurance GET]', err);
    return NextResponse.json({ error: 'Failed to fetch policies' }, { status: 500 });
  }
}

interface CreateBody {
  insurer?: string;
  policyNumber?: string;
  policyType?: HealthPolicyType;
  status?: HealthPolicyStatus;
  policyHolder?: string;
  sumInsuredRupees?: number;
  premiumRupees?: number;
  premiumFrequency?: PremiumFrequency;
  startDate?: string;
  renewalDate?: string;
  waitingPeriodMonths?: number;
  preExistingDiseases?: string;
  cashlessAvailable?: boolean;
  networkHospitalCount?: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as CreateBody;

    if (!body.insurer || !body.insurer.trim()) {
      return NextResponse.json({ error: 'insurer is required' }, { status: 400 });
    }
    if (!body.policyNumber || !body.policyNumber.trim()) {
      return NextResponse.json({ error: 'policyNumber is required' }, { status: 400 });
    }
    if (!body.policyType || !VALID_POLICY_TYPES.includes(body.policyType)) {
      return NextResponse.json({ error: 'policyType is required' }, { status: 400 });
    }
    if (!body.policyHolder || !body.policyHolder.trim()) {
      return NextResponse.json({ error: 'policyHolder is required' }, { status: 400 });
    }
    if (typeof body.sumInsuredRupees !== 'number' || !Number.isFinite(body.sumInsuredRupees)) {
      return NextResponse.json({ error: 'sumInsuredRupees is required' }, { status: 400 });
    }
    if (typeof body.premiumRupees !== 'number' || !Number.isFinite(body.premiumRupees)) {
      return NextResponse.json({ error: 'premiumRupees is required' }, { status: 400 });
    }
    if (!body.startDate) {
      return NextResponse.json({ error: 'startDate is required' }, { status: 400 });
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    const freq = body.premiumFrequency ?? 'ANNUAL';
    if (!VALID_FREQUENCIES.includes(freq)) {
      return NextResponse.json({ error: 'Invalid premiumFrequency' }, { status: 400 });
    }

    const sumInsuredPaisa = Math.round(body.sumInsuredRupees * 100);
    const premiumPaisa = Math.round(body.premiumRupees * 100);

    const result = await db
      .insert(healthInsurancePolicies)
      .values({
        userId: session.user.id,
        insurer: body.insurer.trim(),
        policyNumber: body.policyNumber.trim(),
        policyType: body.policyType,
        status: body.status ?? 'ACTIVE',
        policyHolder: body.policyHolder.trim(),
        sumInsuredPaisa,
        premiumPaisa,
        premiumFrequency: freq,
        startDate: body.startDate,
        renewalDate: body.renewalDate || null,
        waitingPeriodMonths:
          typeof body.waitingPeriodMonths === 'number' ? body.waitingPeriodMonths : 48,
        preExistingDiseases: body.preExistingDiseases || null,
        cashlessAvailable: body.cashlessAvailable ?? true,
        networkHospitalCount:
          typeof body.networkHospitalCount === 'number' ? body.networkHospitalCount : null,
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ policy: result[0] }, { status: 201 });
  } catch (err) {
    const { code } = findPgError(err);
    if (code === '23505') {
      return NextResponse.json(
        { error: 'This policy number is already registered.' },
        { status: 409 },
      );
    }
    console.error('[health-insurance POST]', err);
    return NextResponse.json({ error: 'Failed to create policy' }, { status: 500 });
  }
}
