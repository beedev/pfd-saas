/**
 * L3 self-tune orchestrator — runs once/day post square-off (~16:00 IST). For
 * each ORB sleeve with tuning ENABLED:
 *   1. archive today's session bars (grow the replay corpus),
 *   2. replay a window of recent sessions under the champion params,
 *   3. score the one-step neighbour candidates over the same window,
 *   4. pick the best; if it beats champion, PROPOSE it (LLM writes the why),
 *   5. log an agent_param_experiments row.
 *
 * PHASE 3 IS PROPOSE-ONLY: it never writes paramsJson. Phase 4 adds the
 * guardrailed auto-promotion at the marked hook (gated by tuningAutoPromote).
 *
 * SAFETY: paper only — agent_* tables. Money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import {
  db, agentPortfolios, agentSleeves, agentParamExperiments,
  type AgentSleeve, type AgentParamDecision, type AgentSleeveParams,
} from '@/db';
import { resolveOrbParams, type OrbParams } from '@/lib/agent/engine/orb-step';
import { archiveSession, loadWindow } from '@/lib/agent/tuning/bars-archive';
import { replayWindow } from '@/lib/agent/tuning/replay';
import { neighborCandidates, describeDelta } from '@/lib/agent/tuning/candidates';
import { explainCandidate } from '@/lib/agent/tuning/explain';
import type { EdgeMetrics } from '@/lib/agent/tuning/metrics';

const TUNE_WINDOW_DAYS = 20;

function istDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export interface SelfTuneSleeveResult {
  sleeveKey: string;
  sessions: number;
  decision: 'PROPOSED' | 'HELD' | 'PROMOTED' | 'REJECTED' | 'SKIPPED';
  delta: string;
  championNetPaisa: number | null;
  challengerNetPaisa: number | null;
  rationale: string;
}

export interface SelfTuneResult {
  status: 'COMPLETED' | 'SKIPPED';
  reason?: string;
  runDate: string;
  sleeves: SelfTuneSleeveResult[];
}

export async function runAgentSelfTune(
  userId: string, opts: { runDate?: string; windowDays?: number } = {},
): Promise<SelfTuneResult> {
  const runDate = opts.runDate ?? istDate();
  const windowDays = opts.windowDays ?? TUNE_WINDOW_DAYS;

  const portfolio = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!portfolio || !portfolio.enabled) return { status: 'SKIPPED', reason: 'disabled', runDate, sleeves: [] };

  const sleeves = (await db.select().from(agentSleeves)
    .where(and(eq(agentSleeves.portfolioId, portfolio.id), eq(agentSleeves.enabled, true))))
    .filter((s) => s.strategy === 'INTRADAY_ORB' && s.tuningEnabled);
  if (!sleeves.length) return { status: 'SKIPPED', reason: 'no-tuning-enabled-orb-sleeves', runDate, sleeves: [] };

  const results: SelfTuneSleeveResult[] = [];
  for (const sleeve of sleeves) {
    results.push(await tuneSleeve(userId, sleeve, runDate, windowDays));
  }
  return { status: 'COMPLETED', runDate, sleeves: results };
}

async function tuneSleeve(
  userId: string, sleeve: AgentSleeve, runDate: string, windowDays: number,
): Promise<SelfTuneSleeveResult> {
  // 1. Grow the corpus, then load the replay window.
  await archiveSession(userId, sleeve, runDate).catch(() => ({ archived: 0, symbols: 0 }));
  const sessions = await loadWindow(sleeve.id, windowDays);

  const champion = resolveOrbParams(sleeve.paramsJson as Record<string, unknown> | null);
  if (!sessions.length) {
    return { sleeveKey: sleeve.key, sessions: 0, decision: 'SKIPPED', delta: 'no change',
      championNetPaisa: null, challengerNetPaisa: null, rationale: 'No archived sessions yet — corpus still warming up.' };
  }

  // 2. Score champion + every one-step neighbour over the same window.
  const championWin = replayWindow(sessions, sleeve.allocationPaisa, champion);
  const championMetrics = championWin.metrics;
  const scored = neighborCandidates(champion)
    .map((c) => ({ params: c, metrics: replayWindow(sessions, sleeve.allocationPaisa, c).metrics }))
    .sort((a, b) => b.metrics.netPaisa - a.metrics.netPaisa);

  const best = scored[0];
  const improves = !!best && best.metrics.netPaisa > championMetrics.netPaisa;

  // 3. Decide. PHASE 3: propose only — never write paramsJson.
  //    >>> PHASE 4 HOOK: if (sleeve.tuningAutoPromote && improves && passesGuardrails(...))
  //        then promote(...) -> decision = 'PROMOTED'. <<<
  const decision: AgentParamDecision = improves ? 'PROPOSED' : 'HELD';
  const challenger = improves ? best : { params: champion, metrics: championMetrics };

  const rationale = improves
    ? await explainCandidate({
        championParams: champion, championMetrics,
        challengerParams: challenger.params, challengerMetrics: challenger.metrics,
        sessions: sessions.length, willPromote: false,
      })
    : `Held ${describeParams(champion)}: no one-step neighbour beat champion net over ${sessions.length} session(s).`;

  // 4. Log the experiment (audit of every evaluation).
  await db.insert(agentParamExperiments).values({
    userId, sleeveId: sleeve.id, runDate,
    windowFrom: sessions[0].runDate, windowTo: sessions[sessions.length - 1].runDate, sessions: sessions.length,
    championParams: champion as unknown as AgentSleeveParams, championMetrics: championMetrics as unknown as Record<string, unknown>,
    challengerParams: challenger.params as unknown as AgentSleeveParams, challengerMetrics: challenger.metrics as unknown as Record<string, unknown>,
    decision, reason: improves ? describeDelta(champion, challenger.params) : 'no improving neighbour', llmRationale: rationale,
  });

  return {
    sleeveKey: sleeve.key, sessions: sessions.length, decision,
    delta: improves ? describeDelta(champion, challenger.params) : 'no change',
    championNetPaisa: championMetrics.netPaisa,
    challengerNetPaisa: improves ? challenger.metrics.netPaisa : null,
    rationale,
  };
}

function describeParams(p: OrbParams): string {
  return `targetR ${p.targetR}/risk ${p.riskPctPerTrade}%/max ${p.maxConcurrent}`;
}

export type { EdgeMetrics };
