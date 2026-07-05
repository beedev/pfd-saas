/**
 * POST /api/agent/workbench/character — vet candidate stocks. Give it symbols
 * (or source:'news' for today's in-play names, source:'watchlist' for your list)
 * and it returns a per-stock report card: does it trend or revert, which
 * strategy actually paid, and a yes/no with a range-break warning.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, agentWatchlist, agentPortfolios } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { loadDaily } from '@/lib/agent/workbench/data';
import { assessStock } from '@/lib/agent/workbench/character';
import { getInPlay } from '@/lib/agent/news/ingest';

export const maxDuration = 120;
const MAX = 25;

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json().catch(() => ({}));
    let symbols: string[] = [];
    if (body.source === 'news') {
      symbols = (await getInPlay().catch(() => [])).map((x: { symbol: string }) => x.symbol);
    } else if (body.source === 'watchlist') {
      const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
      if (pf) {
        const rows = await db.select({ symbol: agentWatchlist.symbol }).from(agentWatchlist)
          .where(and(eq(agentWatchlist.portfolioId, pf.id), eq(agentWatchlist.enabled, true), eq(agentWatchlist.assetClass, 'STOCK')));
        symbols = rows.map((r) => r.symbol);
      }
    } else if (Array.isArray(body.symbols)) {
      symbols = body.symbols.map((s: string) => String(s).trim().toUpperCase()).map((s: string) => (s.endsWith('.NS') || s.includes('=') ? s : `${s}.NS`));
    }
    symbols = [...new Set(symbols.filter((s) => s.endsWith('.NS')))].slice(0, MAX);
    if (!symbols.length) return NextResponse.json({ reports: [], note: 'no candidate symbols' });

    const reports = [];
    for (const s of symbols) {
      const bars = await loadDaily(s, '5y').catch(() => []);
      if (bars.length < 250) { reports.push({ symbol: s.replace('.NS', ''), verdict: 'NO', recommended: 'AVOID', note: 'not enough history', character: 'NEUTRAL', autocorr: 0, rangeStatus: 'in-range', reversion: { netPct: 0, winRate: 0, trades: 0 }, momentum: { netPct: 0, winRate: 0, trades: 0 } }); continue; }
      reports.push(assessStock(s.replace('.NS', ''), bars));
    }
    // yes's first, then by better recommended-strategy return
    reports.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'YES' ? -1 : 1));
    return NextResponse.json({ reports, tested: symbols.length });
  } catch (e) {
    return NextResponse.json({ error: `character test failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 });
  }
}
