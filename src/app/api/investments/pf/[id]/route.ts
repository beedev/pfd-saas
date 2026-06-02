import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, providentFund } from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
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
    const rows = await db
      .select()
      .from(providentFund)
      .where(and(eq(providentFund.id, numericId), eq(providentFund.userId, session.user.id)))
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ account: rows[0] });
  } catch (err) {
    console.error('Failed to fetch PF account:', err);
    return NextResponse.json({ error: 'Failed to fetch PF account' }, { status: 500 });
  }
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
      .from(providentFund)
      .where(and(eq(providentFund.id, numericId), eq(providentFund.userId, session.user.id)))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const current = existing[0];
    const body = await request.json();

    const employee =
      typeof body.employeeBalanceRupees === 'number'
        ? Math.round(body.employeeBalanceRupees * 100)
        : current.employeeBalance ?? 0;
    const employer =
      typeof body.employerBalanceRupees === 'number'
        ? Math.round(body.employerBalanceRupees * 100)
        : current.employerBalance ?? 0;
    const interest =
      typeof body.interestBalanceRupees === 'number'
        ? Math.round(body.interestBalanceRupees * 100)
        : current.interestBalance ?? 0;
    // Auto-compute total from components; manual override if explicitly sent
    const total =
      typeof body.totalBalanceRupees === 'number'
        ? Math.round(body.totalBalanceRupees * 100)
        : employee + employer + interest;
    // Sprint 5.5e — monthly EPF contribution (paisa). Drives forward
    // projection of corpus on the retirement cashflow timeline.
    const monthlyContributionPaisa =
      typeof body.monthlyContributionRupees === 'number' && body.monthlyContributionRupees >= 0
        ? Math.round(body.monthlyContributionRupees * 100)
        : current.monthlyContributionPaisa;

    const result = await db
      .update(providentFund)
      .set({
        accountHolder: typeof body.accountHolder === 'string' ? body.accountHolder : current.accountHolder,
        accountNumber: typeof body.accountNumber === 'string' ? (body.accountNumber || null) : current.accountNumber,
        universalAccountNumber: typeof body.universalAccountNumber === 'string' ? (body.universalAccountNumber || null) : current.universalAccountNumber,
        employeeBalance: employee,
        employerBalance: employer,
        interestBalance: interest,
        totalBalance: total,
        totalContributed: employee + employer,
        interestEarned: interest,
        monthlyContributionPaisa,
        ppfMaturityDate: typeof body.ppfMaturityDate === 'string' ? (body.ppfMaturityDate || null) : current.ppfMaturityDate,
        notes: typeof body.notes === 'string' ? body.notes : current.notes,
        updatedAt: new Date(),
      })
      .where(and(eq(providentFund.id, numericId), eq(providentFund.userId, session.user.id)))
      .returning();
    return NextResponse.json({ account: result[0] });
  } catch (err) {
    console.error('Failed to update PF account:', err);
    return NextResponse.json({ error: 'Failed to update PF account' }, { status: 500 });
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
    await db.delete(providentFund).where(and(eq(providentFund.id, numericId), eq(providentFund.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete PF account:', err);
    return NextResponse.json({ error: 'Failed to delete PF account' }, { status: 500 });
  }
}
