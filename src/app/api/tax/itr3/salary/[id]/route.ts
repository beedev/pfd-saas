import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, salaryIncome } from '@/db';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db.select().from(salaryIncome).where(eq(salaryIncome.id, numericId)).limit(1);
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

    const result = await db.update(salaryIncome).set(update).where(eq(salaryIncome.id, numericId)).returning();
    return NextResponse.json({ entry: result[0] });
  } catch (err) {
    console.error('Failed to update salary income:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(salaryIncome).where(eq(salaryIncome.id, numericId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete salary income:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
