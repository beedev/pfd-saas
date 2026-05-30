import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import {
  db,
  sips,
  mutualFunds,
  investmentTransactions,
  type SIPFrequency,
} from '@/db';

// Computes the next execution date based on frequency
function computeNextExecution(startDate: string, frequency: SIPFrequency): string {
  const d = new Date(startDate);
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

// GET /api/investments/sips — list all SIPs joined with their MF
export async function GET() {
  try {
    const rows = await db
      .select({
        sip: sips,
        mutualFund: mutualFunds,
      })
      .from(sips)
      .leftJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
      .orderBy(desc(sips.createdAt));

    const enriched = rows.map((row) => {
      const sip = row.sip;
      const mf = row.mutualFund;
      const currentUnits = sip.startingUnits; // adjusted via transactions on the MF
      const currentNavPaisa = mf?.nav ?? sip.startingNav;
      const currentValuePaisa = Math.round((mf?.units ?? currentUnits) * currentNavPaisa);
      // MF totalInvestment is the source of truth (includes seed + all SIP executions)
      const totalInvestedSoFar = mf?.totalInvestment ?? sip.totalInvestedSoFar;
      return {
        ...sip,
        totalInvestedSoFar,
        schemeName: mf?.schemeName ?? null,
        fundType: mf?.fundType ?? null,
        currentNav: currentNavPaisa,
        currentUnits: mf?.units ?? currentUnits,
        currentValue: currentValuePaisa,
        gainLossPercent: mf?.gainLossPercent ?? 0,
      };
    });

    return NextResponse.json({ sips: enriched });
  } catch (error) {
    console.error('Error fetching SIPs:', error);
    return NextResponse.json({ error: 'Failed to fetch SIPs' }, { status: 500 });
  }
}

// POST /api/investments/sips — register a new SIP
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      mutualFundId,
      monthlyAmount,
      frequency = 'MONTHLY',
      startDate,
      endDate,
      startingUnits,
      startingNav,
      totalInvestedSoFar,
      notes,
    } = body;

    if (typeof mutualFundId !== 'number') {
      return NextResponse.json({ error: 'mutualFundId is required' }, { status: 400 });
    }
    if (typeof monthlyAmount !== 'number' || monthlyAmount <= 0) {
      return NextResponse.json({ error: 'monthlyAmount must be positive' }, { status: 400 });
    }
    if (!startDate) {
      return NextResponse.json({ error: 'startDate is required' }, { status: 400 });
    }
    if (typeof startingUnits !== 'number' || startingUnits < 0) {
      return NextResponse.json({ error: 'startingUnits must be >= 0' }, { status: 400 });
    }
    if (typeof startingNav !== 'number' || startingNav < 0) {
      return NextResponse.json({ error: 'startingNav must be >= 0' }, { status: 400 });
    }
    if (typeof totalInvestedSoFar !== 'number' || totalInvestedSoFar < 0) {
      return NextResponse.json({ error: 'totalInvestedSoFar must be >= 0' }, { status: 400 });
    }

    // Verify MF exists
    const mfRows = await db
      .select()
      .from(mutualFunds)
      .where(eq(mutualFunds.id, mutualFundId))
      .limit(1);
    if (!mfRows.length) {
      return NextResponse.json({ error: 'mutual fund not found' }, { status: 404 });
    }
    const mf = mfRows[0];

    const monthlyAmountPaisa = Math.round(monthlyAmount * 100);
    const startingNavPaisa = Math.round(startingNav * 100);
    const totalInvestedSoFarPaisa = Math.round(totalInvestedSoFar * 100);
    const nextExecutionDate = computeNextExecution(startDate, frequency as SIPFrequency);

    const result = await db
      .insert(sips)
      .values({
        mutualFundId,
        startingUnits,
        startingNav: startingNavPaisa,
        monthlyAmount: monthlyAmountPaisa,
        frequency: frequency as SIPFrequency,
        startDate,
        endDate: endDate || null,
        status: 'ACTIVE',
        totalInvestedSoFar: totalInvestedSoFarPaisa,
        lastExecutionDate: null,
        nextExecutionDate,
        expectedXirr: null,
        notes: notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const newSip = result[0];

    // Insert a starting-position transaction so XIRR has a seed.
    if (startingUnits > 0 && totalInvestedSoFarPaisa > 0) {
      await db.insert(investmentTransactions).values({
        type: 'BUY',
        assetType: 'MUTUAL_FUND',
        assetId: mutualFundId,
        assetName: mf.schemeName,
        quantity: startingUnits,
        pricePerUnit: startingNavPaisa,
        amount: totalInvestedSoFarPaisa,
        brokerageCharges: 0,
        taxesAndCharges: 0,
        totalCost: totalInvestedSoFarPaisa,
        transactionDate: startDate,
        notes: `Starting position (registered SIP #${newSip.id})`,
        createdAt: new Date(),
      });
    }

    return NextResponse.json({ sip: newSip }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to register SIP';
    console.error('Error creating SIP:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
