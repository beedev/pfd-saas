import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, taxDeductions } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { auth } from '@/auth';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || searchParams.get('financialYear');
  const section = searchParams.get('section');

  try {
    const conds = [eq(taxDeductions.userId, session.user.id)] as ReturnType<typeof eq>[];
    if (fy) conds.push(eq(taxDeductions.financialYear, fy));
    if (section) conds.push(eq(taxDeductions.section, section));
    const rows = await db
      .select()
      .from(taxDeductions)
      .where(and(...conds))
      .orderBy(desc(taxDeductions.createdAt));
    return NextResponse.json({ deductions: rows });
  } catch (err) {
    console.error('[tax/deductions GET]', err);
    return NextResponse.json({ error: 'Failed to fetch deductions' }, { status: 500 });
  }
}

interface CreateBody {
  financialYear?: string;
  section?: string;
  subType?: string;
  description?: string;
  amountRupees?: number;
  paymentDate?: string;
  paymentMethod?: string;
  recipientName?: string;
  recipientPan?: string;
  recipient80gNumber?: string;
  qualifyingPercent?: number;
  hasUpperLimit?: boolean;
  linkedAssetType?: string;
  linkedAssetId?: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as CreateBody;
    if (!body.section) {
      return NextResponse.json({ error: 'section is required' }, { status: 400 });
    }
    if (typeof body.amountRupees !== 'number' || body.amountRupees < 0) {
      return NextResponse.json({ error: 'amountRupees must be a non-negative number' }, { status: 400 });
    }
    const amountPaisa = Math.round(body.amountRupees * 100);
    const fy = body.financialYear || getCurrentFinancialYear();

    const result = await db
      .insert(taxDeductions)
      .values({
        userId: session.user.id,
        section: body.section,
        description: body.description || body.section,
        deductibleAmount: amountPaisa,
        availableLimit: 0,
        utilizableAmount: amountPaisa,
        incurredDate: body.paymentDate || new Date().toISOString().slice(0, 10),
        financialYear: fy,
        subType: body.subType || null,
        amountPaisa,
        paymentDate: body.paymentDate || null,
        paymentMethod: body.paymentMethod || null,
        recipientName: body.recipientName || null,
        recipientPan: body.recipientPan || null,
        recipient80gNumber: body.recipient80gNumber || null,
        qualifyingPercent: body.qualifyingPercent ?? null,
        hasUpperLimit: body.hasUpperLimit ?? false,
        linkedAssetType: body.linkedAssetType || null,
        linkedAssetId: body.linkedAssetId ?? null,
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ deduction: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create deduction';
    console.error('[tax/deductions POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
