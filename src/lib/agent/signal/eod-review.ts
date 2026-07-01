/**
 * EOD credit-assignment + weight update. After close, fetch the day's % change
 * for Nifty 500 ∪ our tracked universe, then for each of today's news→phrase tags
 * decide HIT (stock made a tradeable move in the tag's direction) / MISS / NEUTRAL
 * (no quote). Update each phrase's Bayesian weight (decayed), promote/demote by
 * trust, and flag big movers we had NO news for (coverage gaps). Global; paper.
 */

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import {
  db, agentNews, agentNewsSignalTags, agentSignalPhrases, agentEodReviews, agentDailyBrief, agentWatchlist,
} from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { NIFTY_500 } from '@/lib/agent/universe/nifty500';
import { trustStateFor } from './dictionary';

const BIG_MOVER_PCT = 4;   // classify a "mover" for the report + coverage gaps
const MOVE_HIT_PCT = 2;    // a tag HITs if the stock moved ≥2% in the tag's direction (tradeable net-of-cost)
const DAILY_DECAY = 0.97;  // fade old evidence so stale regimes lose trust
const CHUNK = 40;

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function fetchDayChanges(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const qs = await getQuotes(symbols.slice(i, i + CHUNK));
    for (const q of qs) if (Number.isFinite(q.regularMarketChangePercent)) out.set(q.symbol, q.regularMarketChangePercent);
  }
  return out;
}

export interface EodReviewResult {
  reviewDate: string; universe: number; gainers: number; losers: number;
  tagsScored: number; hits: number; misses: number; phrasesUpdated: number;
  newlyTrusted: number; coverageGaps: number;
}

export async function runEodReview(
  opts: { reviewDate?: string; force?: boolean; changesOverride?: Map<string, number> } = {},
): Promise<EodReviewResult> {
  const today = opts.reviewDate ?? istDate();

  // Global job scheduled per user — run once/day. A completed review with scored
  // tags means someone already ran it; skip. (force overrides for tests/manual.)
  if (!opts.force) {
    const done = (await db.select({ id: agentEodReviews.id }).from(agentEodReviews).where(eq(agentEodReviews.reviewDate, today)).limit(1)).length > 0;
    if (done) return { reviewDate: today, universe: 0, gainers: 0, losers: 0, tagsScored: 0, hits: 0, misses: 0, phrasesUpdated: 0, newlyTrusted: 0, coverageGaps: 0 };
  }

  // Universe = Nifty 500 ∪ tracked watchlist ∪ today's tagged symbols.
  const watch = await db.selectDistinct({ symbol: agentWatchlist.symbol }).from(agentWatchlist);
  const taggedSyms = await db.selectDistinct({ symbol: agentNewsSignalTags.symbol }).from(agentNewsSignalTags)
    .where(eq(agentNewsSignalTags.taggedDate, today));
  const universe = [...new Set([...NIFTY_500, ...watch.map((w) => w.symbol), ...taggedSyms.map((t) => t.symbol)])]
    .filter((s) => s.endsWith('.NS'));
  const changes = opts.changesOverride ?? await fetchDayChanges(universe);

  const movers = [...changes.entries()].filter(([, p]) => Math.abs(p) >= BIG_MOVER_PCT)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const gainers = movers.filter(([, p]) => p > 0).slice(0, 15);
  const losers = movers.filter(([, p]) => p < 0).slice(0, 15);

  // 1. Score today's PENDING tags.
  const tags = await db.select().from(agentNewsSignalTags)
    .where(and(eq(agentNewsSignalTags.taggedDate, today), eq(agentNewsSignalTags.outcome, 'PENDING')));
  const perPhrase = new Map<number, { hits: number; misses: number }>();
  let hits = 0, misses = 0;
  for (const tag of tags) {
    const pct = changes.get(tag.symbol);
    let outcome: 'HIT' | 'MISS' | 'NEUTRAL';
    if (pct == null) outcome = 'NEUTRAL';
    else {
      const signed = pct * (tag.direction === 'BULLISH' ? 1 : -1);
      outcome = signed >= MOVE_HIT_PCT ? 'HIT' : 'MISS';
    }
    await db.update(agentNewsSignalTags).set({ outcome, movePct: pct ?? null }).where(eq(agentNewsSignalTags.id, tag.id));
    if (outcome === 'NEUTRAL') continue;
    const e = perPhrase.get(tag.phraseId) ?? { hits: 0, misses: 0 };
    if (outcome === 'HIT') { e.hits++; hits++; } else { e.misses++; misses++; }
    perPhrase.set(tag.phraseId, e);
  }

  // 2. Update phrase weights (Bayesian, decayed) + trust status.
  let phrasesUpdated = 0, newlyTrusted = 0;
  for (const [phraseId, o] of perPhrase) {
    const p = (await db.select().from(agentSignalPhrases).where(eq(agentSignalPhrases.id, phraseId)).limit(1))[0];
    if (!p) continue;
    const alpha = 1 + (p.alpha - 1) * DAILY_DECAY + o.hits;   // keep Beta(1,1) prior floor, decay evidence, add today
    const beta = 1 + (p.beta - 1) * DAILY_DECAY + o.misses;
    const status = trustStateFor({ alpha, beta, observedDays: p.observedDays, status: p.status });
    await db.update(agentSignalPhrases).set({ alpha, beta, hitCount: p.hitCount + o.hits, status, lastUpdated: new Date() })
      .where(eq(agentSignalPhrases.id, phraseId));
    phrasesUpdated++;
    if (status === 'TRUSTED' && p.status !== 'TRUSTED') newlyTrusted++;
  }

  // 3. Coverage gaps — big movers we had NO news for today.
  const since = new Date(Date.now() - 14 * 60 * 60 * 1000);
  const newsRows = await db.select({ symbols: agentNews.symbols }).from(agentNews).where(gte(agentNews.publishedAt, since));
  const newsSyms = new Set(newsRows.flatMap((r) => r.symbols ?? []));
  const moverSyms = [...gainers, ...losers].map(([s]) => s);
  const gaps = moverSyms.filter((s) => !newsSyms.has(s));

  // Which movers WERE captured by today's directional brief (for the report). Best-effort.
  const brief = await db.select().from(agentDailyBrief).where(eq(agentDailyBrief.briefDate, today)).catch(() => []);
  const briefDir = new Map(brief.filter((b) => b.bias !== 'NEUTRAL').map((b) => [b.symbol, b.bias]));
  const label = ([s, p]: [string, number]) => ({
    symbol: s, changePct: +p.toFixed(2),
    captured: briefDir.get(s) === (p > 0 ? 'BULLISH' : 'BEARISH'),
    coverageGap: !newsSyms.has(s),
  });

  const summary = `${gainers.length} gainers / ${losers.length} losers ≥${BIG_MOVER_PCT}%; ${tags.length} tags scored (${hits} hit / ${misses} miss); ${phrasesUpdated} phrases updated${newlyTrusted ? `, ${newlyTrusted} newly TRUSTED` : ''}; ${gaps.length} coverage gap(s).`;

  await db.insert(agentEodReviews).values({
    reviewDate: today,
    moversJson: { gainers: gainers.map(label), losers: losers.map(label) },
    phrasesMinted: 0, phrasesUpdated, coverageGapsJson: gaps, summary,
  }).onConflictDoUpdate({
    target: agentEodReviews.reviewDate,
    set: { moversJson: { gainers: gainers.map(label), losers: losers.map(label) }, phrasesUpdated, coverageGapsJson: gaps, summary },
  });

  return {
    reviewDate: today, universe: universe.length, gainers: gainers.length, losers: losers.length,
    tagsScored: tags.length, hits, misses, phrasesUpdated, newlyTrusted, coverageGaps: gaps.length,
  };
}
