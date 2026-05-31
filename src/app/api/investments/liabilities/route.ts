import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, liabilities, type LiabilityType } from '@/db';
import { auth } from '@/auth';

const VALID_TYPES: LiabilityType[] = [
  'HOME_LOAN',
  'AUTO_LOAN',
  'PERSONAL_LOAN',
  'CREDIT_CARD',
  'EDUCATION_LOAN',
  'OTHER',
];

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.userId, session.user.id))
      .orderBy(desc(liabilities.createdAt));
    return NextResponse.json({ liabilities: rows });
  } catch (err) {
    console.error('Failed to fetch liabilities:', err);
    return NextResponse.json({ error: 'Failed to fetch liabilities' }, { status: 500 });
  }
}

interface CreateBody {
  name?: string;
  type?: LiabilityType;
  creditorName?: string;
  productName?: string;
  accountNumber?: string;
  originalAmountRupees?: number;
  currentBalanceRupees?: number;
  interestRate?: number;
  monthlyEmiRupees?: number;
  startDate?: string;
  maturityDate?: string;
  remainingTenor?: number;
  // credit-card specific
  creditLimitRupees?: number;
  minimumDueRupees?: number;
  totalDueRupees?: number;
  statementDate?: string;
  dueDate?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as CreateBody;
    if (!body.type || !VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }
    if (!body.creditorName) {
      return NextResponse.json({ error: 'creditorName is required' }, { status: 400 });
    }
    if (!body.startDate) {
      return NextResponse.json({ error: 'startDate is required' }, { status: 400 });
    }

    const isCard = body.type === 'CREDIT_CARD';
    const original = isCard
      ? Math.round((body.creditLimitRupees ?? 0) * 100)
      : Math.round((body.originalAmountRupees ?? 0) * 100);
    const current = isCard
      ? Math.round((body.totalDueRupees ?? body.currentBalanceRupees ?? 0) * 100)
      : Math.round((body.currentBalanceRupees ?? 0) * 100);
    const monthlyEmi = isCard
      ? Math.round((body.minimumDueRupees ?? 0) * 100)
      : Math.round((body.monthlyEmiRupees ?? 0) * 100);

    const result = await db
      .insert(liabilities)
      .values({
        userId: session.user.id,
        name: (body.name || body.productName || body.creditorName).trim(),
        type: body.type,
        status: 'ACTIVE',
        creditorName: body.creditorName.trim(),
        originalAmount: original,
        currentBalance: current,
        interestRate: body.interestRate ?? 0,
        monthlyEmi,
        startDate: body.startDate,
        maturityDate: body.maturityDate || null,
        remainingTenor: body.remainingTenor || null,
        accountNumber: body.accountNumber || null,
        notes:
          [
            body.notes,
            body.productName ? `Product: ${body.productName}` : '',
            isCard && body.statementDate ? `Statement day: ${body.statementDate}` : '',
            isCard && body.dueDate ? `Due day: ${body.dueDate}` : '',
            isCard && body.minimumDueRupees ? `Min due: ₹${body.minimumDueRupees}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ liability: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create liability';
    console.error('Failed to create liability:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
