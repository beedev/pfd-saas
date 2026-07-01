/**
 * Signal-phrase dictionary — the self-curating catalog of news→move patterns and
 * their Bayesian hit-rate weights. Phase 1 builds + tags the dictionary; Phase 2
 * sets outcomes and updates weights; a phrase past the trust bar auto-trades in
 * Phase 3.
 *
 * Weight = Beta(alpha, beta) mean = alpha/(alpha+beta) — the precision (how often
 * the phrase actually preceded a tradeable move). TRUSTED needs BOTH a high
 * weight AND enough distinct observation days, so a short fluke can't go live.
 *
 * GLOBAL (market knowledge, no user scoping). Paper only.
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  db, agentSignalPhrases, agentNewsSignalTags,
  type AgentSignalPhrase, type AgentBriefBias, type AgentSignalStatus,
} from '@/db';

export const TRUST_THRESHOLD = 0.6;   // hit-rate a phrase must clear to be TRUSTED
export const DEMOTE_THRESHOLD = 0.45; // hysteresis: drop below this → DEMOTED
export const MIN_OBSERVED_DAYS = 5;   // + at least this many distinct days seen

/** Beta mean = precision estimate. */
export function weightOf(p: { alpha: number; beta: number }): number {
  return p.alpha / (p.alpha + p.beta);
}

/** Trust state a phrase SHOULD be in given its stats (applied when weights update). */
export function trustStateFor(p: { alpha: number; beta: number; observedDays: number; status: AgentSignalStatus }): AgentSignalStatus {
  const w = weightOf(p);
  if (p.observedDays >= MIN_OBSERVED_DAYS && w >= TRUST_THRESHOLD) return 'TRUSTED';
  if (p.status === 'TRUSTED' && w < DEMOTE_THRESHOLD) return 'DEMOTED';
  if (p.status === 'TRUSTED') return 'TRUSTED';     // hold trust in the hysteresis band
  return 'MONITORING';
}

/** Active phrases, for the tagging LLM prompt + (later) the trigger. */
export async function getActiveDictionary(): Promise<AgentSignalPhrase[]> {
  return db.select().from(agentSignalPhrases).where(eq(agentSignalPhrases.active, true));
}

export async function getTrustedPhrases(): Promise<AgentSignalPhrase[]> {
  return db.select().from(agentSignalPhrases)
    .where(and(eq(agentSignalPhrases.active, true), eq(agentSignalPhrases.status, 'TRUSTED')));
}

/**
 * Map-or-mint a phrase. Returns the phrase id. If it exists, bumps appearCount +
 * observedDays (once per new day) and keeps a few example headlines. New phrases
 * start MONITORING at Beta(1,1). The LLM decides sameness upstream; here we just
 * persist by canonical phrase string.
 */
export async function ensurePhrase(input: {
  phrase: string; direction: AgentBriefBias; description?: string; example?: string; istDate: string;
}): Promise<{ id: number; minted: boolean }> {
  const existing = (await db.select().from(agentSignalPhrases).where(eq(agentSignalPhrases.phrase, input.phrase)).limit(1))[0];
  if (existing) {
    const examples = existing.examplesJson ?? [];
    if (input.example && !examples.includes(input.example) && examples.length < 8) examples.push(input.example);
    const newDay = existing.firstSeen !== input.istDate && !(await seenOn(existing.id, input.istDate));
    await db.update(agentSignalPhrases).set({
      appearCount: existing.appearCount + 1,
      observedDays: existing.observedDays + (newDay ? 1 : 0),
      examplesJson: examples,
      description: existing.description ?? input.description ?? null,
      lastUpdated: new Date(),
    }).where(eq(agentSignalPhrases.id, existing.id));
    return { id: existing.id, minted: false };
  }
  const [row] = await db.insert(agentSignalPhrases).values({
    phrase: input.phrase, direction: input.direction, description: input.description ?? null,
    status: 'MONITORING', alpha: 1, beta: 1, observedDays: 1, appearCount: 1,
    examplesJson: input.example ? [input.example] : [], firstSeen: input.istDate,
  }).onConflictDoNothing({ target: agentSignalPhrases.phrase }).returning();
  // onConflict (race) → fetch the winner.
  if (!row) {
    const w = (await db.select().from(agentSignalPhrases).where(eq(agentSignalPhrases.phrase, input.phrase)).limit(1))[0];
    return { id: w.id, minted: false };
  }
  return { id: row.id, minted: true };
}

async function seenOn(phraseId: number, istDate: string): Promise<boolean> {
  const r = await db.select({ n: sql<number>`count(*)` }).from(agentNewsSignalTags)
    .where(and(eq(agentNewsSignalTags.phraseId, phraseId), eq(agentNewsSignalTags.taggedDate, istDate)));
  return Number(r[0]?.n ?? 0) > 0;
}

/** Record a (news, symbol) → phrase tag. Idempotent per (news, phrase, symbol). */
export async function recordTag(input: {
  newsId: number; phraseId: number; symbol: string; direction: AgentBriefBias; istDate: string;
}): Promise<void> {
  await db.insert(agentNewsSignalTags).values({
    newsId: input.newsId, phraseId: input.phraseId, symbol: input.symbol,
    direction: input.direction, taggedDate: input.istDate, outcome: 'PENDING',
  }).onConflictDoNothing({ target: [agentNewsSignalTags.newsId, agentNewsSignalTags.phraseId, agentNewsSignalTags.symbol] });
}
