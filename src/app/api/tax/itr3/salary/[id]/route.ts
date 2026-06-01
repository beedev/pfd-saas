import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, salaryIncome } from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
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
    const existing = await db.select().from(salaryIncome).where(and(eq(salaryIncome.id, numericId), eq(salaryIncome.userId, session.user.id))).limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cur = existing[0];

    const body = await request.json();
    const update: Partial<typeof cur> = { updatedAt: new Date() };
    if (typeof body.financialYear === 'string') update.financialYear = body.financialYear;
    if (typeof body.employerName === 'string') update.employerName = body.employerName;
    if (typeof body.employerTan === 'string') update.employerTan = body.employerTan.trim().toUpperCase();
    if (typeof body.grossSalaryRupees === 'number') update.grossSalaryPaisa = Math.round(body.grossSalaryRupees * 100);
    if (typeof body.exemptionsRupees === 'number') update.exemptionsPaisa = Math.round(body.exemptionsRupees * 100);
    if (typeof body.section16Rupees === 'number') update.section16Paisa = Math.round(body.section16Rupees * 100);
    if (typeof body.taxableSalaryRupees === 'number') update.taxableSalaryPaisa = Math.round(body.taxableSalaryRupees * 100);
    if (typeof body.tdsRupees === 'number') update.tdsPaisa = Math.round(body.tdsRupees * 100);
    if (typeof body.notes === 'string') update.notes = body.notes || null;
    // Sprint 5.1a — salary components
    if (typeof body.basicRupees === 'number') update.basicPaisa = Math.round(body.basicRupees * 100);
    if (typeof body.daRupees === 'number') update.daPaisa = Math.round(body.daRupees * 100);
    if (typeof body.hraReceivedRupees === 'number') update.hraReceivedPaisa = Math.round(body.hraReceivedRupees * 100);
    if (typeof body.ltaRupees === 'number') update.ltaPaisa = Math.round(body.ltaRupees * 100);
    if (typeof body.conveyanceRupees === 'number') update.conveyancePaisa = Math.round(body.conveyanceRupees * 100);
    if (typeof body.childrenEdAllowanceRupees === 'number') update.childrenEdAllowancePaisa = Math.round(body.childrenEdAllowanceRupees * 100);
    if (typeof body.medicalRupees === 'number') update.medicalPaisa = Math.round(body.medicalRupees * 100);
    if (typeof body.otherAllowancesRupees === 'number') update.otherAllowancesPaisa = Math.round(body.otherAllowancesRupees * 100);
    if (typeof body.rentPaidMonthlyRupees === 'number') update.rentPaidMonthlyPaisa = Math.round(body.rentPaidMonthlyRupees * 100);

    const result = await db.update(salaryIncome).set(update).where(and(eq(salaryIncome.id, numericId), eq(salaryIncome.userId, session.user.id))).returning();
    return NextResponse.json({ entry: result[0] });
  } catch (err) {
    console.error('Failed to update salary income:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
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
    await db.delete(salaryIncome).where(and(eq(salaryIncome.id, numericId), eq(salaryIncome.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete salary income:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
