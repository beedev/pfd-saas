import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, priceSnapshots } from '@/db';
import { auth } from '@/auth';
import { computeNetWorth } from '@/lib/assets/registry';

const SOURCE = 'NETWORTH_SNAPSHOT';

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
    // Asset fetch + valuation now lives in the asset registry — one entry
    // per class — instead of 11 hardcoded selects + reduces here.
    const { breakdown, totalAssetsPaisa, liabilitiesPaisa, netWorthPaisa } =
      await computeNetWorth(session.user.id);

    const totalAssets = totalAssetsPaisa;
    const liaPaisa = liabilitiesPaisa;
    const netWorth = netWorthPaisa;

    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      ...breakdown.map((b) => ({ symbol: b.snapshotSymbol, name: b.label, price: b.valuePaisa })),
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
