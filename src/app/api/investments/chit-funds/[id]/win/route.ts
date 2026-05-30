import { NextRequest, NextResponse } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db, chitFunds, chitFundInstallments } from '@/db';
import { calculateXirr } from '@/lib/finance/xirr';
import { buildChitCashFlows } from '@/lib/finance/chit-xirr';

interface Params {
  params: Promise<{ id: string }>;
}

// POST — mark a chit fund as won.
//
// Body accepts EITHER (preferred new contract):
//   { winMonth, winDate, winBidPaisa }      // bid amount in paisa
//   { winMonth, winDate, winAmountPaisa }   // cheque actually received
// Legacy (still supported):
//   { winMonth, winDate, winBidDiscountPct }
//
// Mechanics: cheque = chitValue − bid − docCharges. Foreman commission is
// taken FROM the bid (the discount pool), NOT subtracted from the cheque
// separately. The prior formula V × (1−bid%) × (1−foreman%) double-counted
// foreman and is corrected here.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const { winMonth, winDate, winBidPaisa, winAmountPaisa, winBidDiscountPct } = body as {
      winMonth?: number;
      winDate?: string;
      winBidPaisa?: number;
      winAmountPaisa?: number;
      winBidDiscountPct?: number;
    };
    if (typeof winMonth !== 'number' || winMonth <= 0) {
      return NextResponse.json({ error: 'winMonth must be positive' }, { status: 400 });
    }
    if (!winDate) return NextResponse.json({ error: 'winDate required' }, { status: 400 });

    const rows = await db.select().from(chitFunds).where(eq(chitFunds.id, numericId)).limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Chit fund not found' }, { status: 404 });
    const chit = rows[0];

    const commissionPct = chit.foremanCommissionPct ?? 5;
    const docCharges = chit.documentChargesPaisa ?? 0;

    // Resolve bid in paisa from whichever input was provided.
    let bidPaisa: number;
    if (typeof winBidPaisa === 'number' && winBidPaisa >= 0) {
      bidPaisa = Math.round(winBidPaisa);
    } else if (typeof winAmountPaisa === 'number' && winAmountPaisa > 0) {
      bidPaisa = Math.max(0, chit.chitValue - Math.round(winAmountPaisa) - docCharges);
    } else if (typeof winBidDiscountPct === 'number' && winBidDiscountPct >= 0 && winBidDiscountPct < 100) {
      bidPaisa = Math.round((winBidDiscountPct / 100) * chit.chitValue);
    } else {
      return NextResponse.json(
        { error: 'Provide winBidPaisa, winAmountPaisa, or winBidDiscountPct' },
        { status: 400 },
      );
    }

    const foremanCommissionPaisa = Math.round((commissionPct / 100) * chit.chitValue);
    if (bidPaisa < foremanCommissionPaisa) {
      return NextResponse.json(
        {
          error: `Bid must be ≥ foreman commission (${commissionPct}% = ₹${(
            foremanCommissionPaisa / 100
          ).toLocaleString('en-IN')})`,
        },
        { status: 400 },
      );
    }

    const winAmountReceivedPaisa =
      typeof winAmountPaisa === 'number' && winAmountPaisa > 0
        ? Math.round(winAmountPaisa)
        : chit.chitValue - bidPaisa - docCharges;

    const resolvedBidDiscountPct = (bidPaisa / chit.chitValue) * 100;

    const installs = await db
      .select()
      .from(chitFundInstallments)
      .where(eq(chitFundInstallments.chitFundId, numericId))
      .orderBy(asc(chitFundInstallments.monthNumber));

    const flows = buildChitCashFlows({
      installments: installs.map((i) => ({
        paidOn: i.paidOn,
        installmentPaid: i.installmentPaid,
        dividendReceived: i.dividendReceived ?? 0,
      })),
      status: 'WON',
      winDate,
      winAmountReceived: winAmountReceivedPaisa,
      netContributionPaisa: chit.netContribution ?? 0,
    });
    const xirrPct = calculateXirr(flows);

    const updated = await db
      .update(chitFunds)
      .set({
        status: 'WON',
        winMonth,
        winDate,
        winBidDiscountPct: resolvedBidDiscountPct,
        winAmountReceived: winAmountReceivedPaisa,
        xirr: xirrPct,
        updatedAt: new Date(),
      })
      .where(eq(chitFunds.id, numericId))
      .returning();

    return NextResponse.json({ chitFund: updated[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark as won';
    console.error('Error winning chit fund:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
