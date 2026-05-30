import { NextRequest, NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { db, salaryIncome } from '@/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');

    const rows = fy
      ? await db.select().from(salaryIncome).where(eq(salaryIncome.financialYear, fy)).orderBy(desc(salaryIncome.id))
      : await db.select().from(salaryIncome).orderBy(desc(salaryIncome.id));

    return NextResponse.json({ entries: rows });
  } catch (err) {
    console.error('Failed to list salary income:', err);
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    } = body;

    if (!financialYear || !employerName || !employerTan) {
      return NextResponse.json({ error: 'financialYear, employerName, employerTan required' }, { status: 400 });
    }
    if (typeof grossSalaryRupees !== 'number' || typeof taxableSalaryRupees !== 'number') {
      return NextResponse.json({ error: 'grossSalaryRupees, taxableSalaryRupees must be numbers' }, { status: 400 });
    }

    const result = await db
      .insert(salaryIncome)
      .values({
        financialYear,
        employerName,
        employerTan: String(employerTan).trim().toUpperCase(),
        grossSalaryPaisa: Math.round(grossSalaryRupees * 100),
        exemptionsPaisa: Math.round((exemptionsRupees ?? 0) * 100),
        section16Paisa: Math.round((section16Rupees ?? 0) * 100),
        taxableSalaryPaisa: Math.round(taxableSalaryRupees * 100),
        tdsPaisa: Math.round((tdsRupees ?? 0) * 100),
        notes: notes ?? null,
      })
      .returning();

    return NextResponse.json({ entry: result[0] }, { status: 201 });
  } catch (err) {
    console.error('Failed to create salary income:', err);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
