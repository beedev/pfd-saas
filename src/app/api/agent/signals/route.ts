/**
 * GET /api/agent/signals — the news-signal learning state for the Settings view:
 * the phrase dictionary (with Bayesian weight + trust status) and recent EOD
 * review summaries. Read-only; global data, auth-gated.
 */

import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db, agentSignalPhrases, agentEodReviews } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { weightOf } from '@/lib/agent/signal/dictionary';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const rows = await db.select().from(agentSignalPhrases);
  const phrases = rows
    .map((p) => ({
      phrase: p.phrase, direction: p.direction, description: p.description, status: p.status,
      weight: +weightOf(p).toFixed(2), observedDays: p.observedDays, appearCount: p.appearCount,
      hitCount: p.hitCount, examples: p.examplesJson ?? [], active: p.active,
    }))
    .sort((a, b) => (b.status === 'TRUSTED' ? 1 : 0) - (a.status === 'TRUSTED' ? 1 : 0) || b.weight - a.weight);

  const reviews = (await db.select().from(agentEodReviews).orderBy(desc(agentEodReviews.reviewDate)).limit(14))
    .map((r) => ({
      reviewDate: r.reviewDate, summary: r.summary, phrasesUpdated: r.phrasesUpdated,
      coverageGaps: r.coverageGapsJson ?? [], movers: r.moversJson ?? null,
    }));

  const counts = {
    total: phrases.length,
    trusted: phrases.filter((p) => p.status === 'TRUSTED').length,
    monitoring: phrases.filter((p) => p.status === 'MONITORING').length,
    demoted: phrases.filter((p) => p.status === 'DEMOTED').length,
  };

  return NextResponse.json({ phrases, reviews, counts });
}
