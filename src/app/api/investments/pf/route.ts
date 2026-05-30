import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db, providentFund, type PFAccountType } from '@/db';

const VALID_TYPES: PFAccountType[] = ['EPF', 'PPF', 'VPF'];

export async function GET() {
  try {
    const rows = await db.select().from(providentFund).orderBy(desc(providentFund.createdAt));
    return NextResponse.json({ accounts: rows });
  } catch (err) {
    console.error('Failed to fetch PF accounts:', err);
    return NextResponse.json({ error: 'Failed to fetch PF accounts' }, { status: 500 });
  }
}

interface CreateBody {
  accountType?: PFAccountType;
  accountNumber?: string;
  accountHolder?: string;
  pan?: string;
  uan?: string;
  employeeBalanceRupees?: number;
  employerBalanceRupees?: number;
  interestBalanceRupees?: number;
  totalBalanceRupees?: number;
  totalContributedRupees?: number;
  interestEarnedRupees?: number;
  ppfMaturityDate?: string;
  openingDate?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody;
    if (!body.accountType || !VALID_TYPES.includes(body.accountType)) {
      return NextResponse.json({ error: 'accountType is required (EPF|PPF|VPF)' }, { status: 400 });
    }
    if (!body.accountHolder) {
      return NextResponse.json({ error: 'accountHolder is required' }, { status: 400 });
    }
    if (!body.openingDate) {
      return NextResponse.json({ error: 'openingDate is required' }, { status: 400 });
    }

    const employee = Math.round((body.employeeBalanceRupees ?? 0) * 100);
    const employer = Math.round((body.employerBalanceRupees ?? 0) * 100);
    const interest = Math.round((body.interestBalanceRupees ?? 0) * 100);
    const total =
      typeof body.totalBalanceRupees === 'number'
        ? Math.round(body.totalBalanceRupees * 100)
        : employee + employer + interest;
    const totalContributed =
      typeof body.totalContributedRupees === 'number'
        ? Math.round(body.totalContributedRupees * 100)
        : employee + employer;
    const interestEarned = Math.round((body.interestEarnedRupees ?? 0) * 100);

    let ppfMaturityDate: string | null = null;
    if (body.accountType === 'PPF') {
      if (body.ppfMaturityDate) {
        ppfMaturityDate = body.ppfMaturityDate;
      } else if (body.openingDate) {
        const d = new Date(body.openingDate);
        if (!Number.isNaN(d.getTime())) {
          d.setFullYear(d.getFullYear() + 15);
          ppfMaturityDate = d.toISOString().slice(0, 10);
        }
      }
    }

    const result = await db
      .insert(providentFund)
      .values({
        accountType: body.accountType,
        accountNumber: body.accountNumber || null,
        accountHolder: body.accountHolder.trim(),
        pan: body.pan || null,
        universalAccountNumber: body.uan || null,
        employeeBalance: employee,
        employerBalance: employer,
        interestBalance: interest,
        totalBalance: total,
        totalContributed,
        interestEarned,
        ppfMaturityDate,
        isActive: true,
        openingDate: body.openingDate,
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ account: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create PF account';
    console.error('Failed to create PF account:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
