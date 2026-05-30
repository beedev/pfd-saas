import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, asc } from 'drizzle-orm';
import {
  db,
  chitFunds,
  chitFundInstallments,
  type ChitFundStatus,
} from '@/db';
import { calculateXirr } from '@/lib/finance/xirr';
import { buildChitCashFlows } from '@/lib/finance/chit-xirr';

// Add n months to an ISO date (YYYY-MM-DD) and return ISO date.
function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// GET /api/investments/chit-funds
export async function GET() {
  try {
    const rows = await db.select().from(chitFunds).orderBy(desc(chitFunds.createdAt));
    return NextResponse.json({ chitFunds: rows });
  } catch (error) {
    console.error('Error fetching chit funds:', error);
    return NextResponse.json({ error: 'Failed to fetch chit funds' }, { status: 500 });
  }
}

// POST /api/investments/chit-funds — register new chit fund
// Body (rupees for money inputs):
// {
//   foremanName, schemeName, registrationNumber?, isRegistered?,
//   chitValue, monthlyInstallment, durationMonths, groupSize,
//   ticketNumber?, startDate, foremanCommissionPct?,
//   notes?,
//   startingPosition?: {
//     installmentsPaid: number,
//     totalPaid: number,             // rupees
//     totalDividends?: number,       // rupees
//     status?: 'ACTIVE'|'WON'|'COMPLETED',
//     winMonth?: number,
//     winBidDiscountPct?: number,
//     winAmountReceived?: number,    // rupees (optional, otherwise computed)
//     winDate?: string,
//   }
// }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      foremanName,
      schemeName,
      registrationNumber,
      isRegistered = true,
      chitValue,
      monthlyInstallment,
      durationMonths,
      groupSize,
      ticketNumber,
      startDate,
      foremanCommissionPct = 5,
      notes,
      startingPosition,
    } = body;

    if (!foremanName) return NextResponse.json({ error: 'foremanName required' }, { status: 400 });
    if (!schemeName) return NextResponse.json({ error: 'schemeName required' }, { status: 400 });
    if (typeof chitValue !== 'number' || chitValue <= 0)
      return NextResponse.json({ error: 'chitValue must be positive' }, { status: 400 });
    if (typeof monthlyInstallment !== 'number' || monthlyInstallment <= 0)
      return NextResponse.json({ error: 'monthlyInstallment must be positive' }, { status: 400 });
    if (typeof durationMonths !== 'number' || durationMonths <= 0)
      return NextResponse.json({ error: 'durationMonths must be positive' }, { status: 400 });
    if (typeof groupSize !== 'number' || groupSize <= 0)
      return NextResponse.json({ error: 'groupSize must be positive' }, { status: 400 });
    if (!startDate) return NextResponse.json({ error: 'startDate required' }, { status: 400 });

    const chitValuePaisa = Math.round(chitValue * 100);
    const installmentPaisa = Math.round(monthlyInstallment * 100);
    const expectedEndDate = addMonths(startDate, durationMonths);
    const nextDueDate = addMonths(startDate, 1);

    // Seed running state from starting position (if provided)
    let installmentsPaidCount = 0;
    let totalPaidPaisa = 0;
    let totalDividendsPaisa = 0;
    let status: ChitFundStatus = 'ACTIVE';
    let winMonth: number | null = null;
    let winDate: string | null = null;
    let winBidDiscountPct: number | null = null;
    let winAmountReceivedPaisa: number | null = null;

    const seedInstallments: Array<{
      monthNumber: number;
      dueDate: string;
      installmentPaid: number;
      dividendReceived: number;
      netOutgo: number;
      paidOn: string;
    }> = [];

    if (startingPosition) {
      const sp = startingPosition;
      installmentsPaidCount = Number(sp.installmentsPaid ?? 0) || 0;
      totalPaidPaisa = Math.round((Number(sp.totalPaid ?? 0) || 0) * 100);
      totalDividendsPaisa = Math.round((Number(sp.totalDividends ?? 0) || 0) * 100);
      status = (sp.status as ChitFundStatus) ?? 'ACTIVE';

      // If start data was given, generate monthly seed rows so history/charts render.
      if (installmentsPaidCount > 0) {
        const perInstallmentPaid =
          installmentsPaidCount > 0
            ? Math.round(totalPaidPaisa / installmentsPaidCount)
            : installmentPaisa;
        const perInstallmentDividend =
          installmentsPaidCount > 0
            ? Math.round(totalDividendsPaisa / installmentsPaidCount)
            : 0;
        for (let i = 1; i <= installmentsPaidCount; i++) {
          const due = addMonths(startDate, i);
          seedInstallments.push({
            monthNumber: i,
            dueDate: due,
            installmentPaid: perInstallmentPaid,
            dividendReceived: perInstallmentDividend,
            // Net outgo IS what user paid — dividend is already factored into the
            // installment amount paid (lower installment = dividend already applied).
            netOutgo: perInstallmentPaid,
            paidOn: due,
          });
        }
      }

      if (status === 'WON') {
        winMonth = Number(sp.winMonth ?? installmentsPaidCount) || installmentsPaidCount;
        winBidDiscountPct = Number(sp.winBidDiscountPct ?? 0) || 0;
        winDate = sp.winDate || addMonths(startDate, winMonth);
        if (typeof sp.winAmountReceived === 'number') {
          winAmountReceivedPaisa = Math.round(sp.winAmountReceived * 100);
        } else {
          // Cheque = V − bid − doc. Foreman is taken FROM the bid, not
          // subtracted from the cheque separately (the previous formula
          // V × (1−bid%) × (1−foreman%) double-counted foreman commission).
          const bidPaisa = Math.round((winBidDiscountPct / 100) * chitValuePaisa);
          const docPaisa = Math.round(Number(sp.documentChargesRupees ?? 0) * 100);
          winAmountReceivedPaisa = Math.max(0, chitValuePaisa - bidPaisa - docPaisa);
        }
      }
    }

    // Net contribution = gross notional value of installments paid so far
    // (cash cheques + dividend benefit). Equivalent to installmentsPaid × monthlyInstallment
    // but computed from running totals to stay correct even if individual
    // installments deviated from the nominal amount.
    const netContributionPaisa = totalPaidPaisa + totalDividendsPaisa;

    const inserted = await db
      .insert(chitFunds)
      .values({
        foremanName,
        schemeName,
        registrationNumber: registrationNumber || null,
        isRegistered: Boolean(isRegistered),
        chitValue: chitValuePaisa,
        monthlyInstallment: installmentPaisa,
        durationMonths,
        groupSize,
        ticketNumber: ticketNumber || null,
        startDate,
        expectedEndDate,
        foremanCommissionPct,
        installmentsPaid: installmentsPaidCount,
        totalPaid: totalPaidPaisa,
        totalDividends: totalDividendsPaisa,
        netContribution: netContributionPaisa,
        status,
        winMonth,
        winDate,
        winBidDiscountPct,
        winAmountReceived: winAmountReceivedPaisa,
        xirr: null,
        nextDueDate:
          installmentsPaidCount > 0 ? addMonths(startDate, installmentsPaidCount + 1) : nextDueDate,
        notes: notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const newChit = inserted[0];

    // Insert seed installments
    if (seedInstallments.length) {
      await db.insert(chitFundInstallments).values(
        seedInstallments.map((s) => ({
          chitFundId: newChit.id,
          monthNumber: s.monthNumber,
          dueDate: s.dueDate,
          installmentPaid: s.installmentPaid,
          dividendReceived: s.dividendReceived,
          netOutgo: s.netOutgo,
          paidOn: s.paidOn,
          paymentMethod: 'NEFT' as const,
          winnerName: null,
          winnerBidDiscountPct: null,
          notes: 'Seeded from registration',
          createdAt: new Date(),
        }))
      );

      // Recompute XIRR from seeded flows
      const insts = await db
        .select()
        .from(chitFundInstallments)
        .where(eq(chitFundInstallments.chitFundId, newChit.id))
        .orderBy(asc(chitFundInstallments.monthNumber));

      const flows = buildChitCashFlows({
        installments: insts.map((i) => ({
          paidOn: i.paidOn,
          installmentPaid: i.installmentPaid,
          dividendReceived: i.dividendReceived ?? 0,
        })),
        status,
        winDate,
        winAmountReceived: winAmountReceivedPaisa,
        netContributionPaisa,
      });
      const xirrPct = calculateXirr(flows);

      const updated = await db
        .update(chitFunds)
        .set({ xirr: xirrPct, updatedAt: new Date() })
        .where(eq(chitFunds.id, newChit.id))
        .returning();
      return NextResponse.json({ chitFund: updated[0] }, { status: 201 });
    }

    return NextResponse.json({ chitFund: newChit }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to register chit fund';
    console.error('Error creating chit fund:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
