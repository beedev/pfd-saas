import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  priceSnapshots,
  holdings,
  mutualFunds,
  goldHoldings,
  npsAccounts,
  providentFund,
  realEstate,
  insurancePolicies,
  liabilities,
  chitFunds,
  fixedDeposits,
} from '@/db';

const SOURCE = 'NETWORTH_SNAPSHOT';
const CASH_VALUE_POLICIES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export async function GET() {
  // Return today's snapshot if present
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.priceDate, today), eq(priceSnapshots.source, SOURCE)));
  return NextResponse.json({ date: today, snapshots: rows, hasToday: rows.length > 0 });
}

export async function POST(_request: NextRequest) {
  try {
    const [stocks, mfs, gold, nps, pf, re, ins, debts, chits, fds] = await Promise.all([
      db.select().from(holdings),
      db.select().from(mutualFunds),
      db.select().from(goldHoldings),
      db.select().from(npsAccounts),
      db.select().from(providentFund),
      db.select().from(realEstate),
      db.select().from(insurancePolicies),
      db.select().from(liabilities),
      db.select().from(chitFunds),
      db.select().from(fixedDeposits),
    ]);

    const stocksPaisa = stocks.reduce((s, h) => s + (h.currentValue || 0), 0);
    const mfPaisa = mfs.reduce((s, f) => s + (f.currentValue || 0), 0);
    const goldPaisa = gold.reduce((s, g) => s + (g.currentValue || 0), 0);
    const npsPaisa = nps.reduce((s, n) => s + (n.totalValue || 0), 0);
    const pfPaisa = pf.reduce((s, p) => s + (p.totalBalance || 0), 0);
    const rePaisa = re.reduce((s, r) => s + (r.currentValuation || 0), 0);
    const insPaisa = ins
      .filter((p) => CASH_VALUE_POLICIES.includes(p.policyType))
      .reduce((s, p) => s + (p.investmentValue || 0), 0);
    const liaPaisa = debts.reduce((s, d) => s + (d.currentBalance || 0), 0);
    // Matches the home-page net-worth tile: sum netContribution across all chit
    // funds (including WON ones — their dividend value still counts).
    const chitPaisa = chits.reduce((s, c) => s + (c.netContribution || 0), 0);
    // Fixed Deposits: principal of ACTIVE FDs (same conservative convention as
    // chits — accrued interest isn't booked here; projected maturity lives in
    // /projections Liquid Assets).
    const fdPaisa = fds
      .filter((f) => f.status === 'ACTIVE')
      .reduce((s, f) => s + (f.principalPaisa || 0), 0);

    const totalAssets =
      stocksPaisa + mfPaisa + goldPaisa + npsPaisa + pfPaisa + rePaisa + insPaisa + chitPaisa + fdPaisa;
    const netWorth = totalAssets - liaPaisa;

    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      { symbol: 'STOCKS_TOTAL', name: 'Stocks', price: stocksPaisa },
      { symbol: 'MF_TOTAL', name: 'Mutual Funds', price: mfPaisa },
      { symbol: 'GOLD_TOTAL', name: 'Gold', price: goldPaisa },
      { symbol: 'NPS_TOTAL', name: 'NPS', price: npsPaisa },
      { symbol: 'PF_TOTAL', name: 'Provident Fund', price: pfPaisa },
      { symbol: 'RE_TOTAL', name: 'Real Estate', price: rePaisa },
      { symbol: 'INS_TOTAL', name: 'Insurance (cash)', price: insPaisa },
      { symbol: 'CHIT_TOTAL', name: 'Chit Funds', price: chitPaisa },
      { symbol: 'FD_TOTAL', name: 'Fixed Deposits', price: fdPaisa },
      { symbol: 'LIA_TOTAL', name: 'Liabilities', price: liaPaisa },
      { symbol: 'NET_WORTH', name: 'Net Worth', price: netWorth },
    ];

    // Delete existing rows for today (if any) then insert
    for (const r of rows) {
      await db
        .delete(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.assetSymbol, r.symbol),
            eq(priceSnapshots.priceDate, today)
          )
        );
      await db.insert(priceSnapshots).values({
        assetType: 'NETWORTH',
        assetSymbol: r.symbol,
        assetName: r.name,
        price: r.price,
        priceDate: today,
        source: SOURCE,
      });
    }

    return NextResponse.json({
      date: today,
      netWorthPaisa: netWorth,
      totalAssetsPaisa: totalAssets,
      liabilitiesPaisa: liaPaisa,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Snapshot failed';
    console.error('[networth/snapshot]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
