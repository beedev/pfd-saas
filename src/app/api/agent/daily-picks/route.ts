import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, agentDailyPicks } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Today's morning-pipeline picks for the signed-in user (news + announcements + RS/Stage screen). */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const today = istDate();
  const rows = await db.select().from(agentDailyPicks)
    .where(and(eq(agentDailyPicks.userId, userId), eq(agentDailyPicks.pickDate, today)))
    .orderBy(desc(agentDailyPicks.horizon), agentDailyPicks.symbol);
  const picks = rows.map((r) => {
    const rep = (r.reportJson ?? {}) as Record<string, unknown>;
    return {
      symbol: r.symbol, name: r.name, horizon: r.horizon, source: r.source, recommended: r.recommended,
      stage: (rep.stage as string) ?? null,
      liquidityCr: typeof rep.liquidityCr === 'number' ? rep.liquidityCr : null,
      deliveryPct: typeof rep.deliveryPct === 'number' ? rep.deliveryPct : null,
      rsExcess: typeof rep.rsExcess === 'number' ? rep.rsExcess : null,
      suggestedBuy: typeof rep.suggestedBuy === 'number' ? rep.suggestedBuy : null,
      targetPrice: typeof rep.targetPrice === 'number' ? rep.targetPrice : null,
      stopPrice: typeof rep.stopPrice === 'number' ? rep.stopPrice : null,
      note: (rep.note as string) ?? '',
    };
  });
  return NextResponse.json({ date: today, count: picks.length, picks });
}
