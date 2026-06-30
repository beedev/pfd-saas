/**
 * GET  /api/agent/tuning — L3 self-tuning state for the user's ORB sleeve(s):
 *   the two opt-in gates, current params, recent proposals/promotions, and any
 *   active (non-rolled-back) promotion.
 * PATCH /api/agent/tuning — toggle a sleeve's tuning_enabled / tuning_auto_promote.
 * Both scoped to the session user; PATCH only affects INTRADAY_ORB sleeves.
 */

import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, agentSleeves, agentParamExperiments, agentParamHistory } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const sleeves = (await db.select().from(agentSleeves)
    .where(eq(agentSleeves.userId, userId)))
    .filter((s) => s.strategy === 'INTRADAY_ORB');

  const out = await Promise.all(sleeves.map(async (s) => {
    const experiments = await db.select().from(agentParamExperiments)
      .where(eq(agentParamExperiments.sleeveId, s.id))
      .orderBy(desc(agentParamExperiments.id)).limit(5);
    const activePromotion = (await db.select().from(agentParamHistory)
      .where(and(eq(agentParamHistory.sleeveId, s.id), eq(agentParamHistory.rolledBack, false)))
      .orderBy(desc(agentParamHistory.promotedAt)).limit(1))[0] ?? null;
    return {
      sleeveId: s.id, key: s.key, name: s.name,
      tuningEnabled: s.tuningEnabled, tuningAutoPromote: s.tuningAutoPromote,
      params: s.paramsJson ?? {},
      experiments: experiments.map((e) => ({
        id: e.id, runDate: e.runDate, decision: e.decision, reason: e.reason,
        sessions: e.sessions, rationale: e.llmRationale,
        championNetPaisa: (e.championMetrics as { netPaisa?: number } | null)?.netPaisa ?? null,
        challengerNetPaisa: (e.challengerMetrics as { netPaisa?: number } | null)?.netPaisa ?? null,
      })),
      activePromotion: activePromotion ? {
        fromParams: activePromotion.fromParams, toParams: activePromotion.toParams, promotedAt: activePromotion.promotedAt,
      } : null,
    };
  }));

  return NextResponse.json({ sleeves: out });
}

const patchSchema = z.object({
  sleeveId: z.number().int().positive(),
  tuningEnabled: z.boolean().optional(),
  tuningAutoPromote: z.boolean().optional(),
}).refine((b) => b.tuningEnabled !== undefined || b.tuningAutoPromote !== undefined, {
  message: 'provide tuningEnabled and/or tuningAutoPromote',
});

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const { data, error } = await parseBody(request, patchSchema);
  if (error) return error;

  const set: Record<string, boolean | Date> = { updatedAt: new Date() };
  if (data.tuningEnabled !== undefined) set.tuningEnabled = data.tuningEnabled;
  // Auto-promote can't be on without the master gate — enabling it implies enabling tuning.
  if (data.tuningAutoPromote !== undefined) {
    set.tuningAutoPromote = data.tuningAutoPromote;
    if (data.tuningAutoPromote) set.tuningEnabled = true;
  }
  // Turning the master gate off also clears auto-promote.
  if (data.tuningEnabled === false) set.tuningAutoPromote = false;

  const [updated] = await db.update(agentSleeves).set(set)
    .where(and(
      eq(agentSleeves.id, data.sleeveId),
      eq(agentSleeves.userId, userId),
      eq(agentSleeves.strategy, 'INTRADAY_ORB'),
    ))
    .returning({ id: agentSleeves.id, tuningEnabled: agentSleeves.tuningEnabled, tuningAutoPromote: agentSleeves.tuningAutoPromote });

  if (!updated) return NextResponse.json({ error: 'sleeve not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...updated });
}
