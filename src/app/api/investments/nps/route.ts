import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db, npsAccounts, type NPSAccountType } from '@/db';

const VALID_TIERS: NPSAccountType[] = ['TIER1', 'TIER2'];

export async function GET() {
  try {
    const rows = await db.select().from(npsAccounts).orderBy(desc(npsAccounts.createdAt));
    return NextResponse.json({ accounts: rows });
  } catch (err) {
    console.error('Failed to fetch NPS accounts:', err);
    return NextResponse.json({ error: 'Failed to fetch NPS accounts' }, { status: 500 });
  }
}

interface CreateBody {
  accountNumber?: string;
  accountHolder?: string;
  pan?: string;
  tier?: NPSAccountType;
  scheme?: string;
  subscriberId?: string;
  totalValueRupees?: number;
  equityValueRupees?: number;
  debtValueRupees?: number;
  alternativeValueRupees?: number;
  totalContributedRupees?: number;
  employerContributionRupees?: number;
  openingDate?: string;
  expectedMaturityDate?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody;
    if (!body.accountNumber) {
      return NextResponse.json({ error: 'accountNumber is required' }, { status: 400 });
    }
    if (!body.accountHolder) {
      return NextResponse.json({ error: 'accountHolder is required' }, { status: 400 });
    }
    if (!body.pan) {
      return NextResponse.json({ error: 'pan is required' }, { status: 400 });
    }
    if (!body.tier || !VALID_TIERS.includes(body.tier)) {
      return NextResponse.json({ error: 'tier must be TIER1 or TIER2' }, { status: 400 });
    }
    if (!body.openingDate) {
      return NextResponse.json({ error: 'openingDate is required' }, { status: 400 });
    }

    const totalValue = Math.round((body.totalValueRupees ?? 0) * 100);
    const equity = Math.round((body.equityValueRupees ?? 0) * 100);
    const debt = Math.round((body.debtValueRupees ?? 0) * 100);
    const alt = Math.round((body.alternativeValueRupees ?? 0) * 100);
    const totalContributed = Math.round((body.totalContributedRupees ?? 0) * 100);
    const employerContribution = Math.round((body.employerContributionRupees ?? 0) * 100);
    const gainLoss = totalValue - totalContributed;

    const result = await db
      .insert(npsAccounts)
      .values({
        accountNumber: body.accountNumber.trim(),
        accountHolder: body.accountHolder.trim(),
        pan: body.pan.trim().toUpperCase(),
        tier: body.tier,
        status: 'ACTIVE',
        subscriberId: body.subscriberId || null,
        equityFundValue: equity,
        debtFundValue: debt,
        alternativeFundValue: alt,
        totalValue,
        totalContributed,
        employerContribution,
        gainLoss,
        openingDate: body.openingDate,
        expectedMaturityDate: body.expectedMaturityDate || null,
        notes: body.notes ? `${body.scheme ? `Scheme: ${body.scheme}. ` : ''}${body.notes}` : body.scheme ? `Scheme: ${body.scheme}` : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ account: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create NPS account';
    console.error('Failed to create NPS account:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
