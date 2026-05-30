import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, insurancePolicies, type PolicyType, type PolicyStatus } from '@/db';

const VALID_POLICY_TYPES: PolicyType[] = [
  'TERM_LIFE',
  'WHOLE_LIFE',
  'ENDOWMENT',
  'ULIP',
  'HEALTH',
  'CRITICAL_ILLNESS',
  'DISABILITY',
  'ACCIDENT',
];

const VALID_STATUSES: PolicyStatus[] = ['ACTIVE', 'LAPSED', 'SURRENDERED', 'MATURED', 'CLAIMED'];

const VALID_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'SINGLE'] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(insurancePolicies)
      .where(eq(insurancePolicies.id, numericId))
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ policy: rows[0] });
  } catch (err) {
    console.error('Failed to fetch policy:', err);
    return NextResponse.json({ error: 'Failed to fetch policy' }, { status: 500 });
  }
}

interface PatchBody {
  policyType?: PolicyType;
  status?: PolicyStatus;
  policyHolder?: string;
  insurer?: string;
  sumAssuredRupees?: number;
  premiumAmountRupees?: number;
  premiumFrequency?: string;
  policyStartDate?: string;
  maturityDate?: string | null;
  policyTerm?: number | null;
  premiumPaymentTerm?: number | null;
  investmentValueRupees?: number;
  maturityBenefitRupees?: number;
  annuityAmountRupees?: number | null;
  annuityFrequency?: string | null;
  annuityStartDate?: string | null;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  notes?: string | null;
}

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db
      .select()
      .from(insurancePolicies)
      .where(eq(insurancePolicies.id, numericId))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = (await request.json()) as PatchBody;

    // Validate enums when provided
    if (body.policyType !== undefined && !VALID_POLICY_TYPES.includes(body.policyType)) {
      return NextResponse.json({ error: 'Invalid policyType' }, { status: 400 });
    }
    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (
      body.premiumFrequency !== undefined &&
      !VALID_FREQUENCIES.includes(body.premiumFrequency as (typeof VALID_FREQUENCIES)[number])
    ) {
      return NextResponse.json({ error: 'Invalid premiumFrequency' }, { status: 400 });
    }

    // Build a partial update — only include fields the body supplied so we
    // never accidentally clear something the caller didn't intend to touch.
    const update: Partial<typeof insurancePolicies.$inferInsert> = { updatedAt: new Date() };
    if (body.policyType !== undefined) update.policyType = body.policyType;
    if (body.status !== undefined) update.status = body.status;
    if (typeof body.policyHolder === 'string' && body.policyHolder.trim()) {
      update.policyHolder = body.policyHolder.trim();
    }
    if (typeof body.insurer === 'string' && body.insurer.trim()) {
      update.insurer = body.insurer.trim();
    }
    const sumAssured = rupeesToPaisa(body.sumAssuredRupees);
    if (sumAssured !== undefined) update.sumAssured = sumAssured;
    const premiumAmount = rupeesToPaisa(body.premiumAmountRupees);
    if (premiumAmount !== undefined) update.premiumAmount = premiumAmount;
    if (body.premiumFrequency !== undefined) update.premiumFrequency = body.premiumFrequency;
    if (typeof body.policyStartDate === 'string' && body.policyStartDate) {
      update.policyStartDate = body.policyStartDate;
    }
    if (body.maturityDate !== undefined) update.maturityDate = body.maturityDate;
    if (body.policyTerm !== undefined) update.policyTerm = body.policyTerm;
    if (body.premiumPaymentTerm !== undefined) update.premiumPaymentTerm = body.premiumPaymentTerm;
    const investmentValue = rupeesToPaisa(body.investmentValueRupees);
    if (investmentValue !== undefined) update.investmentValue = investmentValue;
    const maturityBenefit = rupeesToPaisa(body.maturityBenefitRupees);
    if (maturityBenefit !== undefined) update.maturityBenefit = maturityBenefit;
    const annuityAmount = rupeesToPaisa(body.annuityAmountRupees);
    if (annuityAmount !== undefined) update.annuityAmount = annuityAmount;
    if (body.annuityAmountRupees === null || body.annuityAmountRupees === 0) update.annuityAmount = null;
    if (body.annuityFrequency !== undefined) update.annuityFrequency = body.annuityFrequency;
    if (body.annuityStartDate !== undefined) update.annuityStartDate = body.annuityStartDate;
    if (body.nomineeName !== undefined) update.nomineeName = body.nomineeName;
    if (body.nomineeRelation !== undefined) update.nomineeRelation = body.nomineeRelation;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(insurancePolicies)
      .set(update)
      .where(eq(insurancePolicies.id, numericId))
      .returning();
    return NextResponse.json({ policy: result[0] });
  } catch (err) {
    console.error('Failed to update policy:', err);
    return NextResponse.json({ error: 'Failed to update policy' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(insurancePolicies).where(eq(insurancePolicies.id, numericId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete policy:', err);
    return NextResponse.json({ error: 'Failed to delete policy' }, { status: 500 });
  }
}
