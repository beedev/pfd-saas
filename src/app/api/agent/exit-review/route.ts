import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, holdings } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { loadDaily } from '@/lib/agent/workbench/data';
import { computeStage } from '@/lib/agent/workbench/stage';

/**
 * Portfolio exit-review — applies the same Stage/RS lens we vet BUYS with to the
 * user's existing holdings, and flags which to exit. The RELIANCE finding
 * (Stage 4, RS 17) generalized: a name in Stage 3/4 or lagging the index is
 * dead-or-dying money. Read-only analysis over the app's holdings table.
 */

const LOOKBACK = 126;
const ret6mo = (closes: number[]) => (closes.length < LOOKBACK + 1 ? 0 : closes[closes.length - 1] / closes[closes.length - 1 - LOOKBACK] - 1);
const ACTION: Record<string, { action: string; reason: string }> = {
  STAGE2: { action: 'HOLD', reason: 'Stage 2 — advancing uptrend. Let it run.' },
  STAGE3: { action: 'TRIM', reason: 'Stage 3 — topping (above a rolling-over 200-DMA). Book some / tighten stop.' },
  STAGE4: { action: 'EXIT', reason: 'Stage 4 — declining (below a falling 200-DMA). Dead money; exit.' },
  STAGE1: { action: 'REVIEW', reason: 'Stage 1 — basing, no trend. Capital is idle; consider redeploying.' },
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const rows = await db.select().from(holdings).where(eq(holdings.userId, userId));
  const idx = await loadDaily('^NSEI', '1y').catch(() => []);
  const idxRet = ret6mo(idx.map((b) => b.close));

  const CONC = 8;
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i += CONC) {
    const batch = rows.slice(i, i + CONC);
    const reviewed = await Promise.all(batch.map(async (h) => {
      const sym = h.symbol.endsWith('.NS') ? h.symbol : `${h.symbol}.NS`;
      const bars = await loadDaily(sym, '1y').catch(() => []);
      const gainPct = h.gainLossPercent != null ? Number(h.gainLossPercent) : null;
      if (bars.length < 220) return { symbol: h.symbol, quantity: h.quantity, stage: null, rsExcess: null, action: 'REVIEW', reason: 'Not enough price history to stage.', gainPct };
      const closes = bars.map((b) => b.close);
      const stage = computeStage(closes);
      const rsExcess = +((ret6mo(closes) - idxRet) * 100).toFixed(1);
      const a = ACTION[stage];
      // A holding that's Stage 2 but badly lagging the index is still weak — flag it.
      const laggard = stage === 'STAGE2' && rsExcess < 0;
      return {
        symbol: h.symbol, quantity: h.quantity, stage, rsExcess,
        action: laggard ? 'TRIM' : a.action,
        reason: laggard ? 'Stage 2 but lagging the Nifty (weak leadership) — watch / trim.' : a.reason,
        gainPct,
      };
    }));
    out.push(...reviewed);
  }
  const rank = { EXIT: 0, TRIM: 1, REVIEW: 2, HOLD: 3 } as Record<string, number>;
  out.sort((a, b) => (rank[a.action as string] ?? 9) - (rank[b.action as string] ?? 9));
  return NextResponse.json({ count: out.length, holdings: out });
}
