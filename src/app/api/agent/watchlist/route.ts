/**
 * GET  /api/agent/watchlist — instruments the agent monitors
 * POST /api/agent/watchlist — add an instrument (auto-creates a default
 *                             paper portfolio on first add)
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, agentPortfolios, agentWatchlist, agentDailyPicks, agentPositions, type AgentAssetClass } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getQuotes } from '@/lib/services/yahoo-finance';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysBetween = (from: string) => Math.max(0, Math.round((Date.now() - Date.parse(from)) / 86400000));

const CLASSES: AgentAssetClass[] = ['STOCK', 'MF', 'FUTURE'];

async function ensurePortfolio(userId: string) {
  const existing = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (existing) return existing;
  const [created] = await db.insert(agentPortfolios).values({ userId }).returning();
  return created;
}

/**
 * Watchlist = the buy→hold lifecycle tracker:
 *   • held   — open positions (bought), tracked entry → current → growth/loss.
 *   • toBuy  — today's picks (+ any manual watchlist names) NOT yet held.
 * Driven by the pipeline: a pick shows in toBuy, gets bought, then flips to held.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const today = istDate();
    const positions = await db.select().from(agentPositions).where(eq(agentPositions.userId, userId));
    const heldSyms = new Set(positions.map((p) => p.symbol));

    const picks = await db.select().from(agentDailyPicks).where(and(eq(agentDailyPicks.userId, userId), eq(agentDailyPicks.pickDate, today)));
    const manual = await db.select().from(agentWatchlist).where(eq(agentWatchlist.userId, userId)).orderBy(desc(agentWatchlist.id));

    // Live prices for everything on screen.
    const symbols = [...new Set([...positions.map((p) => p.symbol), ...picks.map((p) => p.symbol), ...manual.map((m) => m.symbol)].filter(Boolean))];
    const qs = symbols.length ? await getQuotes(symbols).catch(() => []) : [];
    const px = new Map(qs.filter((q) => Number.isFinite(q.regularMarketPrice)).map((q) => [q.symbol, q.regularMarketPrice]));

    const held = positions.map((p) => {
      const current = px.get(p.symbol) ?? null;
      const entry = p.avgPricePaisa / 100;
      return {
        symbol: p.symbol, name: p.name, sector: null as string | null,
        entryPrice: entry, currentPrice: current,
        gainPct: current != null && entry > 0 ? +(((current - entry) / entry) * 100).toFixed(2) : null,
        target: p.targetPaisa != null ? p.targetPaisa / 100 : null, stop: p.stopPaisa != null ? p.stopPaisa / 100 : null,
        entryDate: p.openedDate, daysHeld: daysBetween(p.openedDate), quantity: p.quantity,
        addedToday: p.openedDate === today,   // distinguish today's fresh entries from existing holds
      };
    });

    const seen = new Set(heldSyms);
    const toBuy: Array<Record<string, unknown>> = [];
    for (const p of picks) {
      if (p.horizon !== 'MULTIDAY' || seen.has(p.symbol)) continue;
      seen.add(p.symbol);
      const rep = (p.reportJson ?? {}) as Record<string, unknown>;
      toBuy.push({ symbol: p.symbol, name: p.name, sector: (rep.sector as string) ?? null, source: p.source, score: typeof rep.score === 'number' ? Math.round(rep.score * 100) : null, suggestedBuy: rep.suggestedBuy ?? null, target: rep.targetPrice ?? null, stop: rep.stopPrice ?? null, currentPrice: px.get(p.symbol) ?? null });
    }
    for (const m of manual) {   // manual additions the user still wants to buy
      if (seen.has(m.symbol)) continue;
      seen.add(m.symbol);
      toBuy.push({ symbol: m.symbol, name: m.name, sector: m.sector ?? null, source: 'manual', score: null, suggestedBuy: m.entryPricePaisa != null ? m.entryPricePaisa / 100 : null, target: null, stop: null, currentPrice: px.get(m.symbol) ?? null });
    }

    // Today's INTRADAY signals (folded in from the retired Daily Picks page — kept
    // compact + separate from the 2-3mo book).
    const intraday = picks
      .filter((p) => p.horizon === 'INTRADAY')
      .map((p) => {
        const rep = (p.reportJson ?? {}) as Record<string, unknown>;
        return { symbol: p.symbol, name: p.name, sector: (rep.sector as string) ?? null, source: p.source, score: typeof rep.score === 'number' ? Math.round(rep.score * 100) : null, suggestedBuy: rep.suggestedBuy ?? null, target: rep.targetPrice ?? null, stop: rep.stopPrice ?? null, currentPrice: px.get(p.symbol) ?? null };
      });

    return NextResponse.json({ held, toBuy, intraday });
  } catch (err) {
    console.error('GET agent/watchlist:', err);
    return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const assetClass = body.assetClass as AgentAssetClass;
    if (!CLASSES.includes(assetClass)) {
      return NextResponse.json({ error: 'assetClass must be STOCK | MF | FUTURE' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
    const schemeCode = typeof body.schemeCode === 'string' ? body.schemeCode.trim() : '';
    if (assetClass === 'MF' && !schemeCode) {
      return NextResponse.json({ error: 'schemeCode required for MF' }, { status: 400 });
    }
    if (assetClass !== 'MF' && !symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }
    // Watchlist is decoupled from sleeves now (pipeline-driven); sleeveId optional.
    const sleeveId = Number.isInteger(body.sleeveId) ? body.sleeveId : null;
    // "My Picks" hold horizon — INTRADAY (same-day) or MULTIDAY (swing).
    const horizon = body.horizon === 'INTRADAY' ? 'INTRADAY' : 'MULTIDAY';

    const portfolio = await ensurePortfolio(userId);
    const [created] = await db
      .insert(agentWatchlist)
      .values({
        userId,
        portfolioId: portfolio.id,
        sleeveId,
        assetClass,
        symbol,
        schemeCode,
        isin: typeof body.isin === 'string' ? body.isin.trim() || null : null,
        name,
        horizon,
        contractMultiplier: typeof body.contractMultiplier === 'number' && body.contractMultiplier > 0 ? body.contractMultiplier : 1,
      })
      .onConflictDoNothing({ target: [agentWatchlist.userId, agentWatchlist.sleeveId, agentWatchlist.assetClass, agentWatchlist.symbol, agentWatchlist.schemeCode] })
      .returning();
    if (!created) return NextResponse.json({ error: 'Already in watchlist' }, { status: 409 });
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (err) {
    console.error('POST agent/watchlist:', err);
    return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 });
  }
}
