import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
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
import { auth } from '@/auth';

const SOURCE = 'NETWORTH_SNAPSHOT';
const CASH_VALUE_POLICIES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  // Return today's snapshot if present
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(priceSnapshots)
    .where(
      and(
        eq(priceSnapshots.priceDate, today),
        eq(priceSnapshots.source, SOURCE),
        eq(priceSnapshots.userId, session.user.id),
      ),
    );
  return NextResponse.json({ date: today, snapshots: rows, hasToday: rows.length > 0 });
}

export async function POST(_request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const [stocks, mfs, gold, nps, pf, re, ins, debts, chits, fds] = await Promise.all([
      db.select().from(holdings).where(eq(holdings.userId, session.user.id)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, session.user.id)),
      db.select().from(goldHoldings).where(eq(goldHoldings.userId, session.user.id)),
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, session.user.id)),
      db.select().from(providentFund).where(eq(providentFund.userId, session.user.id)),
      db.select().from(realEstate).where(eq(realEstate.userId, session.user.id)),
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, session.user.id)),
      db.select().from(liabilities).where(eq(liabilities.userId, session.user.id)),
      db.select().from(chitFunds).where(eq(chitFunds.userId, session.user.id)),
      db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, session.user.id)),
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
            eq(priceSnapshots.priceDate, today),
            eq(priceSnapshots.userId, session.user.id),
          )
        );
      await db.insert(priceSnapshots).values({
        userId: session.user.id,
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
