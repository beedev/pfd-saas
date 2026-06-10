import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, incomeTaxPaid, type TaxPaymentType } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const rows = await db
      .select()
      .from(incomeTaxPaid)
      .where(and(eq(incomeTaxPaid.financialYear, fy), eq(incomeTaxPaid.userId, userId)))
      .orderBy(desc(incomeTaxPaid.paymentDate));

    const total = rows.reduce((s, r) => s + r.amount, 0);

    return NextResponse.json({ payments: rows, totalPaisa: total });
  } catch (err) {
    console.error('[tax-paid GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

const createSchema = z.object({
  financialYear: z.string().min(1),
  paymentType: z.string().min(1),
  // Pre-zod check was truthiness, which rejected amount === 0 — preserved.
  amount: z.number().finite().refine((v) => v !== 0, 'amount is required'),
  paymentDate: z.string().min(1),
  referenceNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const parsed = await parseBody(request, createSchema);
    if (parsed.error) return parsed.error;
    const { financialYear, paymentType, amount, paymentDate, referenceNumber, notes } = parsed.data;

    const result = await db.insert(incomeTaxPaid).values({
      userId,
      financialYear,
      // Cast preserves pre-zod behaviour: TS-only enum hint, never validated.
      paymentType: paymentType as TaxPaymentType,
      amount: Math.round(amount * 100),
      paymentDate,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
    }).returning();

    return NextResponse.json({ payment: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[tax-paid POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await db.delete(incomeTaxPaid).where(and(eq(incomeTaxPaid.id, id), eq(incomeTaxPaid.userId, userId)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[tax-paid DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
