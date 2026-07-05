/**
 * POST /api/agent/watchlist/rebuild — clear the watchlist and rebuild it from the
 * current RS/Stage-2 leaders (the review's "RS/Stage-aware watchlist" replacing the
 * static blue-chips). Each entry is stamped with its entry price, entry date, and
 * sector, so the watchlist page can track growth/loss since it was added.
 */

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, agentPortfolios, agentSleeves, agentWatchlist } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { screenRsStage } from '@/lib/agent/engine/rs-stage-screen';
import { resolveUniverse } from '@/lib/agent/workbench/universes';
import { sectorOf } from '@/lib/agent/workbench/sectors';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!pf) return NextResponse.json({ error: 'No paper portfolio yet' }, { status: 400 });
  const sleeve = (await db.select().from(agentSleeves).where(and(eq(agentSleeves.portfolioId, pf.id), eq(agentSleeves.key, 'STK_SHORT'))).limit(1))[0];

  const strong = await screenRsStage(resolveUniverse('NIFTY_500').slice(0, 150), '^NSEI', 20).catch(() => []);
  if (!strong.length) return NextResponse.json({ error: 'RS screen returned nothing (market data throttled — try again shortly)' }, { status: 503 });

  const qs = await getQuotes(strong.map((s) => s.symbol)).catch(() => []);
  const px = new Map(qs.filter((q) => Number.isFinite(q.regularMarketPrice)).map((q) => [q.symbol, q.regularMarketPrice]));
  const today = istDate();

  await db.delete(agentWatchlist).where(eq(agentWatchlist.userId, userId));   // cleanup the old (static) list
  let added = 0;
  for (const s of strong) {
    const cur = px.get(s.symbol);
    await db.insert(agentWatchlist).values({
      userId, portfolioId: pf.id, sleeveId: sleeve?.id ?? null, assetClass: 'STOCK', schemeCode: '',
      symbol: s.symbol, name: s.name, horizon: 'MULTIDAY',
      entryPricePaisa: cur != null ? Math.round(cur * 100) : null, entryDate: today, sector: sectorOf(s.symbol),
    }).onConflictDoNothing();
    added++;
  }
  return NextResponse.json({ cleared: true, added, date: today });
}
