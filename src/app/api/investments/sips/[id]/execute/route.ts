import { NextRequest, NextResponse } from 'next/server';
import { eq, and, asc } from 'drizzle-orm';
import { db, sips, mutualFunds, investmentTransactions, type SIPFrequency } from '@/db';
import { calculateXirr, type CashFlow } from '@/lib/finance/xirr';
import { recomputeSipBudgetForPeriod, dateToPeriod } from '@/lib/finance/budget-sync';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

function computeNextExecution(fromDate: string, frequency: SIPFrequency): string {
  const d = new Date(fromDate);
  switch (frequency) {
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'QUARTERLY':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'SEMI_ANNUAL':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'ANNUAL':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

// POST /api/investments/sips/:id/execute
// Body: { executionDate, navOnExecution (rupees), amount (rupees) }
export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const { executionDate, navOnExecution, amount } = body;
    if (!executionDate) {
      return NextResponse.json({ error: 'executionDate is required' }, { status: 400 });
    }
    if (typeof navOnExecution !== 'number' || navOnExecution <= 0) {
      return NextResponse.json({ error: 'navOnExecution must be positive' }, { status: 400 });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount must be positive' }, { status: 400 });
    }

    const sipRows = await db
      .select()
      .from(sips)
      .where(and(eq(sips.id, numericId), eq(sips.userId, session.user.id)))
      .limit(1);
    if (!sipRows.length) {
      return NextResponse.json({ error: 'SIP not found' }, { status: 404 });
    }
    const sip = sipRows[0];

    const mfRows = await db
      .select()
      .from(mutualFunds)
      .where(and(eq(mutualFunds.id, sip.mutualFundId), eq(mutualFunds.userId, session.user.id)))
      .limit(1);
    if (!mfRows.length) {
      return NextResponse.json({ error: 'Linked mutual fund not found' }, { status: 404 });
    }
    const mf = mfRows[0];

    const navPaisa = Math.round(navOnExecution * 100);
    const amountPaisa = Math.round(amount * 100);
    const unitsBought = amount / navOnExecution;

    // Insert SIP installment transaction
    const txnResult = await db
      .insert(investmentTransactions)
      .values({
        userId: session.user.id,
        type: 'SIP_EXECUTION',
        assetType: 'MUTUAL_FUND',
        assetId: sip.mutualFundId,
        assetName: mf.schemeName,
        quantity: unitsBought,
        pricePerUnit: navPaisa,
        amount: amountPaisa,
        brokerageCharges: 0,
        taxesAndCharges: 0,
        totalCost: amountPaisa,
        transactionDate: executionDate,
        notes: `SIP installment via SIP #${sip.id}`,
        createdAt: new Date(),
      })
      .returning();
    const newTxn = txnResult[0];

    // Update the mutual fund row: units, totalInvestment, currentValue, gainLoss
    const newUnits = mf.units + unitsBought;
    const newTotalInvestment = mf.totalInvestment + amountPaisa;
    const newCurrentValue = Math.round(newUnits * navPaisa);
    const newGainLoss = newCurrentValue - newTotalInvestment;
    const newGainLossPercent =
      newTotalInvestment > 0 ? (newGainLoss / newTotalInvestment) * 100 : 0;

    await db
      .update(mutualFunds)
      .set({
        units: newUnits,
        nav: navPaisa,
        totalInvestment: newTotalInvestment,
        currentValue: newCurrentValue,
        gainLoss: newGainLoss,
        gainLossPercent: newGainLossPercent,
        lastNavDate: executionDate,
        updatedAt: new Date(),
      })
      .where(and(eq(mutualFunds.id, sip.mutualFundId), eq(mutualFunds.userId, session.user.id)));

    // Recompute XIRR using the full transaction history of this MF
    const allTxns = await db
      .select()
      .from(investmentTransactions)
      .where(
        and(
          eq(investmentTransactions.userId, session.user.id),
          eq(investmentTransactions.assetType, 'MUTUAL_FUND'),
          eq(investmentTransactions.assetId, sip.mutualFundId)
        )
      )
      .orderBy(asc(investmentTransactions.transactionDate));

    const flows: CashFlow[] = allTxns.map((t) => ({
      // Investments are outflows (negative), redemptions positive.
      amount: -(t.amount / 100),
      when: new Date(t.transactionDate),
    }));
    // Add a synthetic "current value" inflow at execution date so XIRR is meaningful
    flows.push({
      amount: newCurrentValue / 100,
      when: new Date(executionDate),
    });
    const xirrPct = calculateXirr(flows);

    const newTotalInvestedSoFar = sip.totalInvestedSoFar + amountPaisa;
    const nextExec = computeNextExecution(executionDate, sip.frequency as SIPFrequency);

    const updatedSipRows = await db
      .update(sips)
      .set({
        totalInvestedSoFar: newTotalInvestedSoFar,
        lastExecutionDate: executionDate,
        nextExecutionDate: nextExec,
        expectedXirr: xirrPct,
        updatedAt: new Date(),
      })
      .where(and(eq(sips.id, numericId), eq(sips.userId, session.user.id)))
      .returning();

    // Sync SIP spend to budget
    await recomputeSipBudgetForPeriod(dateToPeriod(executionDate));

    return NextResponse.json({
      sip: updatedSipRows[0],
      transaction: newTxn,
      xirr: xirrPct,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute SIP';
    console.error('Error executing SIP:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
