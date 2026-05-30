import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, npsAccounts } from '@/db';

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
      .from(npsAccounts)
      .where(eq(npsAccounts.id, numericId))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ account: rows[0] });
  } catch (err) {
    console.error('Failed to fetch NPS account:', err);
    return NextResponse.json({ error: 'Failed to fetch NPS account' }, { status: 500 });
  }
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
      .from(npsAccounts)
      .where(eq(npsAccounts.id, numericId))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const current = existing[0];
    const body = await request.json();

    const totalValue =
      typeof body.totalValueRupees === 'number'
        ? Math.round(body.totalValueRupees * 100)
        : current.totalValue;
    const equity =
      typeof body.equityValueRupees === 'number'
        ? Math.round(body.equityValueRupees * 100)
        : current.equityFundValue ?? 0;
    const debt =
      typeof body.debtValueRupees === 'number'
        ? Math.round(body.debtValueRupees * 100)
        : current.debtFundValue ?? 0;
    const alt =
      typeof body.alternativeValueRupees === 'number'
        ? Math.round(body.alternativeValueRupees * 100)
        : current.alternativeFundValue ?? 0;
    const totalContributed =
      typeof body.totalContributedRupees === 'number'
        ? Math.round(body.totalContributedRupees * 100)
        : current.totalContributed;
    const employerContribution =
      typeof body.employerContributionRupees === 'number'
        ? Math.round(body.employerContributionRupees * 100)
        : current.employerContribution;

    const result = await db
      .update(npsAccounts)
      .set({
        accountHolder: typeof body.accountHolder === 'string' ? body.accountHolder : current.accountHolder,
        pan: typeof body.pan === 'string' ? body.pan : current.pan,
        tier: typeof body.tier === 'string' ? body.tier : current.tier,
        status: typeof body.status === 'string' ? body.status : current.status,
        totalValue,
        equityFundValue: equity,
        debtFundValue: debt,
        alternativeFundValue: alt,
        totalContributed,
        employerContribution,
        gainLoss: totalValue - totalContributed,
        expectedMaturityDate: typeof body.expectedMaturityDate === 'string' ? (body.expectedMaturityDate || null) : current.expectedMaturityDate,
        notes: typeof body.notes === 'string' ? body.notes : current.notes,
        updatedAt: new Date(),
      })
      .where(eq(npsAccounts.id, numericId))
      .returning();

    return NextResponse.json({ account: result[0] });
  } catch (err) {
    console.error('Failed to update NPS account:', err);
    return NextResponse.json({ error: 'Failed to update NPS account' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(npsAccounts).where(eq(npsAccounts.id, numericId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete NPS account:', err);
    return NextResponse.json({ error: 'Failed to delete NPS account' }, { status: 500 });
  }
}
