import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db, priceSnapshots } from '@/db';
import { auth } from '@/auth';

const SOURCE = 'NETWORTH_SNAPSHOT';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const months = Number(searchParams.get('months') || '12');

  try {
    const all = await db
      .select()
      .from(priceSnapshots)
      .where(and(eq(priceSnapshots.userId, session.user.id), eq(priceSnapshots.source, SOURCE)))
      .orderBy(asc(priceSnapshots.priceDate));

    // Group by date -> { date, symbols: {symbol: paisa} }
    const byDate: Record<string, Record<string, number>> = {};
    for (const row of all) {
      if (!byDate[row.priceDate]) byDate[row.priceDate] = {};
      byDate[row.priceDate][row.assetSymbol] = row.price;
    }

    const dates = Object.keys(byDate).sort();
    // Filter to last N months
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const filtered = dates.filter((d) => new Date(d) >= cutoff);

    const history = filtered.map((date) => {
      const g = byDate[date];
      return {
        date,
        stocksPaisa: g.STOCKS_TOTAL || 0,
        mfPaisa: g.MF_TOTAL || 0,
        goldPaisa: g.GOLD_TOTAL || 0,
        npsPaisa: g.NPS_TOTAL || 0,
        pfPaisa: g.PF_TOTAL || 0,
        realEstatePaisa: g.RE_TOTAL || 0,
        insurancePaisa: g.INS_TOTAL || 0,
        liabilitiesPaisa: g.LIA_TOTAL || 0,
        netWorthPaisa: g.NET_WORTH || 0,
      };
    });

    return NextResponse.json({ history });
  } catch (err) {
    console.error('[networth/history]', err);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
