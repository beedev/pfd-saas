import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, holdings, mutualFunds } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { auth } from '@/auth';

// Since Phase 6 typically has no SELL data, we compute unrealised gains
// grouped by holding period (>12 months vs ≤12 months) for equity instruments.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || getCurrentFinancialYear();

  try {
    const [stockRows, mfRows] = await Promise.all([
      db.select().from(holdings).where(eq(holdings.userId, session.user.id)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, session.user.id)),
    ]);

    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    let stocksLtcgPaisa = 0;
    let stocksStcgPaisa = 0;
    for (const h of stockRows) {
      const pd = new Date(h.purchaseDate);
      const gain = (h.currentValue || 0) - (h.totalInvestment || 0);
      if (pd <= twelveMonthsAgo) stocksLtcgPaisa += gain;
      else stocksStcgPaisa += gain;
    }

    let equityMfLtcgPaisa = 0;
    let equityMfStcgPaisa = 0;
    let debtMfGainPaisa = 0;
    for (const m of mfRows) {
      const gain = (m.currentValue || 0) - (m.totalInvestment || 0);
      if (m.fundType === 'EQUITY' || m.fundType === 'HYBRID') {
        // Heuristic: unrealised gains, assume held >12 months
        equityMfLtcgPaisa += gain;
      } else {
        debtMfGainPaisa += gain;
      }
    }
    // unused stcg placeholder for equity MF (no purchaseDate)
    void equityMfStcgPaisa;

    // Gold LTCG: holdings > 36 months; SGB exempt at maturity
    // For Phase 6 we mark gold as 'estimated' only

    const ltcgExemptionPaisa = 12500000; // ₹1.25L exemption (Budget 2024)
    const equityLtcgTotal = stocksLtcgPaisa + equityMfLtcgPaisa;
    const equityLtcgTaxablePaisa = Math.max(0, equityLtcgTotal - ltcgExemptionPaisa);
    const equityLtcgTaxPaisa = Math.round(equityLtcgTaxablePaisa * 0.125); // 12.5% LTCG (Budget 2024)
    const equityStcgTaxPaisa = Math.round(stocksStcgPaisa * 0.2); // 20% STCG (Budget 2024)

    return NextResponse.json({
      financialYear: fy,
      stocks: {
        ltcgPaisa: stocksLtcgPaisa,
        stcgPaisa: stocksStcgPaisa,
      },
      equityMutualFunds: {
        ltcgPaisa: equityMfLtcgPaisa,
        stcgPaisa: 0,
      },
      debtMutualFunds: {
        totalGainPaisa: debtMfGainPaisa,
      },
      equityLtcgTotalPaisa: equityLtcgTotal,
      ltcgExemptionPaisa,
      equityLtcgTaxablePaisa,
      equityLtcgTaxPaisa,
      equityStcgTaxPaisa,
      estimatedTotalTaxPaisa: equityLtcgTaxPaisa + equityStcgTaxPaisa,
    });
  } catch (err) {
    console.error('[tax/ltcg-stcg]', err);
    return NextResponse.json({ error: 'Failed to compute capital gains' }, { status: 500 });
  }
}
