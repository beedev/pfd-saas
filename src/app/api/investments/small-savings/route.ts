/**
 * Small Savings — list + create.
 *
 * Manages PPF / VPF / NSC / KVP / SSY / SCSS accounts. Each scheme has
 * its own lock-in, interest treatment, and maturity rules; this endpoint
 * is generic and the lib at `@/lib/finance/small-savings` fills in the
 * scheme-specific defaults at create time.
 *
 * Money in body: RUPEES (number). Stored: PAISA (integer).
 * Dates: ISO YYYY-MM-DD strings.
 */

import { NextRequest, NextResponse } from 'next/server';
import { asc, desc, eq } from 'drizzle-orm';
import {
  db,
  smallSavingsAccounts,
  type SmallSavingsScheme,
  type SmallSavingsStatus,
  type InterestCompounding,
} from '@/db';
import { auth } from '@/auth';
import {
  defaultInterestRate,
  maturityDate as computeMaturityDate,
} from '@/lib/finance/small-savings';

const VALID_SCHEMES: SmallSavingsScheme[] = ['PPF', 'VPF', 'NSC', 'KVP', 'SSY', 'SCSS'];
const VALID_STATUSES: SmallSavingsStatus[] = ['ACTIVE', 'MATURED', 'CLOSED', 'EXTENDED'];
const VALID_COMPOUNDING: InterestCompounding[] = ['YEARLY', 'HALF_YEARLY', 'QUARTERLY'];

/**
 * Drizzle wraps the underlying PostgresError as `cause`. Walk the
 * cause chain to find the SQLSTATE code — needed so we can map
 * unique-violation (23505) into a friendly 409 instead of a 500.
 */
function findPgError(err: unknown): { code?: string; detail?: string } {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const c = cur as { code?: unknown; detail?: unknown; cause?: unknown };
      if (typeof c.code === 'string') {
        return {
          code: c.code,
          detail: typeof c.detail === 'string' ? c.detail : '',
        };
      }
      cur = c.cause;
    } else {
      break;
    }
  }
  return {};
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const accounts = await db
      .select()
      .from(smallSavingsAccounts)
      .where(eq(smallSavingsAccounts.userId, session.user.id))
      .orderBy(asc(smallSavingsAccounts.schemeType), desc(smallSavingsAccounts.openingDate));
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error('[small-savings GET]', err);
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
}

interface CreateBody {
  schemeType?: SmallSavingsScheme;
  accountNumber?: string;
  holderName?: string;
  holderDob?: string;
  pan?: string;
  institution?: string;
  openingDate?: string;
  maturityDate?: string;
  depositAmountRupees?: number;
  currentBalanceRupees?: number;
  interestRatePercent?: number;
  interestCompounding?: InterestCompounding;
  lockInEndDate?: string;
  totalDepositedRupees?: number;
  totalInterestRupees?: number;
  status?: SmallSavingsStatus;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as CreateBody;

    if (!body.schemeType || !VALID_SCHEMES.includes(body.schemeType)) {
      return NextResponse.json({ error: 'schemeType is required' }, { status: 400 });
    }
    if (!body.accountNumber || !body.accountNumber.trim()) {
      return NextResponse.json({ error: 'accountNumber is required' }, { status: 400 });
    }
    if (!body.holderName || !body.holderName.trim()) {
      return NextResponse.json({ error: 'holderName is required' }, { status: 400 });
    }
    if (!body.openingDate) {
      return NextResponse.json({ error: 'openingDate is required' }, { status: 400 });
    }
    if (body.schemeType === 'SSY' && !body.holderDob) {
      return NextResponse.json(
        { error: "holderDob (child's DOB) is required for SSY" },
        { status: 400 },
      );
    }
    if (typeof body.currentBalanceRupees !== 'number' || !Number.isFinite(body.currentBalanceRupees)) {
      return NextResponse.json({ error: 'currentBalanceRupees is required' }, { status: 400 });
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Fill scheme-driven defaults: maturity, rate, compounding. The lib
    // owns the per-scheme rules so this handler stays generic.
    const maturity = body.maturityDate || computeMaturityDate(
      body.schemeType,
      body.openingDate,
      body.holderDob,
    );
    const rate =
      typeof body.interestRatePercent === 'number' && Number.isFinite(body.interestRatePercent)
        ? body.interestRatePercent
        : defaultInterestRate(body.schemeType);
    // SCSS pays quarterly; everything else compounds yearly by default.
    const compounding: InterestCompounding =
      body.interestCompounding && VALID_COMPOUNDING.includes(body.interestCompounding)
        ? body.interestCompounding
        : body.schemeType === 'SCSS'
        ? 'QUARTERLY'
        : 'YEARLY';

    const currentBalancePaisa = Math.round(body.currentBalanceRupees * 100);
    const depositAmountPaisa =
      typeof body.depositAmountRupees === 'number'
        ? Math.round(body.depositAmountRupees * 100)
        : 0;
    // Default totalDeposited to current balance — user is registering
    // an account that already exists, so what they've put in so far is
    // a reasonable starting estimate. They can refine later.
    const totalDepositedPaisa =
      typeof body.totalDepositedRupees === 'number'
        ? Math.round(body.totalDepositedRupees * 100)
        : currentBalancePaisa;
    const totalInterestPaisa =
      typeof body.totalInterestRupees === 'number'
        ? Math.round(body.totalInterestRupees * 100)
        : 0;

    const result = await db
      .insert(smallSavingsAccounts)
      .values({
        userId: session.user.id,
        schemeType: body.schemeType,
        accountNumber: body.accountNumber.trim(),
        holderName: body.holderName.trim(),
        holderDob: body.holderDob || null,
        pan: body.pan || null,
        institution: body.institution || null,
        openingDate: body.openingDate,
        maturityDate: maturity,
        extensionBlocksUsed: 0,
        depositAmountPaisa,
        currentBalancePaisa,
        interestRatePercent: rate,
        interestCompounding: compounding,
        lockInEndDate: body.lockInEndDate || maturity,
        totalDepositedPaisa,
        totalInterestPaisa,
        status: body.status ?? 'ACTIVE',
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ account: result[0] }, { status: 201 });
  } catch (err) {
    const { code } = findPgError(err);
    if (code === '23505') {
      return NextResponse.json(
        { error: 'An account with this scheme + number is already registered.' },
        { status: 409 },
      );
    }
    console.error('[small-savings POST]', err);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
