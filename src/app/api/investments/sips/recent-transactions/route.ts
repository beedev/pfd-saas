/**
 * GET /api/investments/sips/recent-transactions
 *
 * Returns SIP execution transactions from the past 30 days, enriched with
 * scheme name and cumulative units for the "Invested in past 30 days" panel.
 */

import { NextResponse } from 'next/server';
import { and, eq, gte, asc, desc } from 'drizzle-orm';
import { db, investmentTransactions, sips, mutualFunds } from '@/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    // Get all SIP_EXECUTION transactions in the past 30 days
    const txns = await db
      .select()
      .from(investmentTransactions)
      .where(
        and(
          eq(investmentTransactions.type, 'SIP_EXECUTION'),
          gte(investmentTransactions.transactionDate, cutoffIso)
        )
      )
      .orderBy(desc(investmentTransactions.transactionDate));

    // Enrich with scheme name and SIP id
    const sipRows = await db.select().from(sips);
    const mfRows = await db.select().from(mutualFunds);

    const mfMap = new Map(mfRows.map((m) => [m.id, m]));
    const sipByMfId = new Map(sipRows.map((s) => [s.mutualFundId, s]));

    const transactions = txns.map((t) => {
      const sip = sipByMfId.get(t.assetId ?? 0);
      const mf = mfMap.get(t.assetId ?? 0);
      return {
        sipId: sip?.id ?? 0,
        schemeName: mf?.schemeName ?? 'Unknown',
        amount: t.amount,           // paisa
        nav: t.pricePerUnit,        // paisa
        units: t.quantity,
        totalUnits: mf?.units ?? 0,
        date: t.transactionDate,
      };
    });

    return NextResponse.json({ transactions });
  } catch (err) {
    console.error('Failed to fetch recent SIP transactions:', err);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}
