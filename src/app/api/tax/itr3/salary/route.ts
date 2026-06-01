import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db, salaryIncome } from '@/db';
import { auth } from '@/auth';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');

    const rows = fy
      ? await db.select().from(salaryIncome).where(and(eq(salaryIncome.financialYear, fy), eq(salaryIncome.userId, session.user.id))).orderBy(desc(salaryIncome.id))
      : await db.select().from(salaryIncome).where(eq(salaryIncome.userId, session.user.id)).orderBy(desc(salaryIncome.id));

    return NextResponse.json({ entries: rows });
  } catch (err) {
    console.error('Failed to list salary income:', err);
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const {
      financialYear,
      employerName,
      employerTan,
      grossSalaryRupees,
      exemptionsRupees,
      section16Rupees,
      taxableSalaryRupees,
      tdsRupees,
      notes,
      // Sprint 5.1a — salary components (all optional, default to 0).
      basicRupees,
      daRupees,
      hraReceivedRupees,
      ltaRupees,
      conveyanceRupees,
      childrenEdAllowanceRupees,
      medicalRupees,
      otherAllowancesRupees,
      rentPaidMonthlyRupees,
    } = body;

    if (!financialYear || !employerName || !employerTan) {
      return NextResponse.json({ error: 'financialYear, employerName, employerTan required' }, { status: 400 });
    }
    if (typeof grossSalaryRupees !== 'number' || typeof taxableSalaryRupees !== 'number') {
      return NextResponse.json({ error: 'grossSalaryRupees, taxableSalaryRupees must be numbers' }, { status: 400 });
    }

    const toPaisa = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) : 0);

    const result = await db
      .insert(salaryIncome)
      .values({
        userId: session.user.id,
        financialYear,
        employerName,
        employerTan: String(employerTan).trim().toUpperCase(),
        grossSalaryPaisa: Math.round(grossSalaryRupees * 100),
        exemptionsPaisa: Math.round((exemptionsRupees ?? 0) * 100),
        section16Paisa: Math.round((section16Rupees ?? 0) * 100),
        taxableSalaryPaisa: Math.round(taxableSalaryRupees * 100),
        tdsPaisa: Math.round((tdsRupees ?? 0) * 100),
        basicPaisa: toPaisa(basicRupees),
        daPaisa: toPaisa(daRupees),
        hraReceivedPaisa: toPaisa(hraReceivedRupees),
        ltaPaisa: toPaisa(ltaRupees),
        conveyancePaisa: toPaisa(conveyanceRupees),
        childrenEdAllowancePaisa: toPaisa(childrenEdAllowanceRupees),
        medicalPaisa: toPaisa(medicalRupees),
        otherAllowancesPaisa: toPaisa(otherAllowancesRupees),
        rentPaidMonthlyPaisa: toPaisa(rentPaidMonthlyRupees),
        notes: notes ?? null,
      })
      .returning();

    return NextResponse.json({ entry: result[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create salary income:', err);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
