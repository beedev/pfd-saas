import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db, insurancePolicies, type PolicyType } from '@/db';

const VALID_TYPES: PolicyType[] = [
  'TERM_LIFE',
  'WHOLE_LIFE',
  'ENDOWMENT',
  'ULIP',
  'HEALTH',
  'CRITICAL_ILLNESS',
  'DISABILITY',
  'ACCIDENT',
];

export async function GET() {
  try {
    const rows = await db.select().from(insurancePolicies).orderBy(desc(insurancePolicies.createdAt));
    return NextResponse.json({ policies: rows });
  } catch (err) {
    console.error('Failed to fetch policies:', err);
    return NextResponse.json({ error: 'Failed to fetch policies' }, { status: 500 });
  }
}

interface CreateBody {
  policyNumber?: string;
  policyType?: PolicyType;
  policyHolder?: string;
  insurer?: string;
  policyName?: string;
  sumAssuredRupees?: number;
  premiumAmountRupees?: number;
  premiumFrequency?: string;
  policyStartDate?: string;
  maturityDate?: string;
  policyTerm?: number;
  premiumPaymentTerm?: number;
  investmentValueRupees?: number;
  maturityBenefitRupees?: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody;
    if (!body.policyNumber) {
      return NextResponse.json({ error: 'policyNumber is required' }, { status: 400 });
    }
    if (!body.policyType || !VALID_TYPES.includes(body.policyType)) {
      return NextResponse.json({ error: 'policyType is required' }, { status: 400 });
    }
    if (!body.policyHolder || !body.insurer || !body.policyStartDate) {
      return NextResponse.json({ error: 'policyHolder, insurer, policyStartDate are required' }, { status: 400 });
    }

    const sumAssured = Math.round((body.sumAssuredRupees ?? 0) * 100);
    const premiumAmount = Math.round((body.premiumAmountRupees ?? 0) * 100);
    const investmentValue = Math.round((body.investmentValueRupees ?? 0) * 100);
    const maturityBenefit = Math.round((body.maturityBenefitRupees ?? 0) * 100);

    const result = await db
      .insert(insurancePolicies)
      .values({
        policyNumber: body.policyNumber.trim(),
        policyType: body.policyType,
        status: 'ACTIVE',
        policyHolder: body.policyHolder.trim(),
        insurer: body.insurer.trim(),
        sumAssured,
        maturityBenefit: maturityBenefit || null,
        premiumAmount,
        premiumFrequency: body.premiumFrequency || 'YEARLY',
        policyTerm: body.policyTerm || null,
        premiumPaymentTerm: body.premiumPaymentTerm || null,
        policyStartDate: body.policyStartDate,
        maturityDate: body.maturityDate || null,
        investmentValue: investmentValue || null,
        notes:
          [body.notes, body.policyName ? `Plan: ${body.policyName}` : '']
            .filter(Boolean)
            .join(' · ') || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ policy: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create policy';
    console.error('Failed to create policy:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
