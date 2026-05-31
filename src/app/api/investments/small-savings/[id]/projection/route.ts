/**
 * Small Savings — interest projection for one account.
 *
 * Delegates the math to `@/lib/finance/small-savings`. Returns yearly
 * checkpoints from today (or account creation, whichever is later) to
 * maturity. Caller may pass `?years=N` to clamp the projection window —
 * useful for VPF (no fixed maturity) and for displaying a near-term
 * preview rather than the full 21-year SSY horizon.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, smallSavingsAccounts } from '@/db';
import { auth } from '@/auth';
import { projectBalance } from '@/lib/finance/small-savings';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
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
      .from(smallSavingsAccounts)
      .where(
        and(
          eq(smallSavingsAccounts.id, numericId),
          eq(smallSavingsAccounts.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const acct = rows[0];

    // Project from today (or opening if account is brand new and
    // hasn't yet reached its first compounding period). Maturity is
    // the column on the account, optionally clamped to `?years=N`.
    const url = new URL(request.url);
    const yearsParam = url.searchParams.get('years');
    const today = new Date().toISOString().slice(0, 10);
    const startDate = today > acct.openingDate ? today : acct.openingDate;

    let endDate = acct.maturityDate;
    if (yearsParam) {
      const years = Number(yearsParam);
      if (Number.isFinite(years) && years > 0) {
        const clamp = new Date(startDate);
        clamp.setFullYear(clamp.getFullYear() + years);
        const clampIso = clamp.toISOString().slice(0, 10);
        // Only clamp if the requested window is shorter than maturity.
        if (clampIso < endDate) endDate = clampIso;
      }
    }

    // SCSS pays interest out quarterly to the depositor's bank — it
    // doesn't accumulate on the account. Flag the lib so the principal
    // line stays flat but the interest column still accrues for display.
    const payoutInterest = acct.schemeType === 'SCSS';

    const points = projectBalance({
      principal: acct.currentBalancePaisa,
      annualRatePct: acct.interestRatePercent,
      compounding: acct.interestCompounding,
      startDate,
      endDate,
      monthlyDepositPaisa: acct.depositAmountPaisa ?? 0,
      payoutInterest,
    });

    const totalProjected = points.length ? points[points.length - 1].balance : acct.currentBalancePaisa;

    return NextResponse.json({
      points,
      maturityDate: acct.maturityDate,
      totalProjected,
      payoutInterest,
    });
  } catch (err) {
    console.error('[small-savings/:id/projection GET]', err);
    return NextResponse.json({ error: 'Failed to project balance' }, { status: 500 });
  }
}
