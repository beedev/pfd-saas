/**
 * L3 self-tune orchestrator — runs once/day post square-off (~16:00 IST). For
 * each ORB sleeve with tuning ENABLED:
 *   0. rollback check  — if a prior promotion's cool-down has elapsed and the
 *      LIVE edge since underperformed its baseline, revert the params,
 *   1. archive today's session bars (grow the replay corpus),
 *   2. replay a window of recent sessions under the champion params,
 *   3. score the one-step neighbour candidates over the same window,
 *   4. pick the best; if it beats champion → PROPOSE (and, when tuningAutoPromote
 *      is on AND the guardrails pass → PROMOTE: write paramsJson),
 *   5. log an agent_param_experiments row.
 *
 * Two opt-in gates: tuningEnabled (evaluate + propose) and tuningAutoPromote
 * (actually write params). Both default false. Paper only; money in paisa.
 */

import { and, desc, eq, gt } from 'drizzle-orm';
import {
  db, agentPortfolios, agentSleeves, agentParamExperiments, agentParamHistory, agentDecisions,
  type AgentSleeve, type AgentParamDecision, type AgentSleeveParams,
} from '@/db';
import { resolveOrbParams, type OrbParams } from '@/lib/agent/engine/orb-step';
import { archiveSession, loadWindow } from '@/lib/agent/tuning/bars-archive';
import { replayWindow, type ReplaySession, type WindowResult } from '@/lib/agent/tuning/replay';
import { neighborCandidates, describeDelta } from '@/lib/agent/tuning/candidates';
import { explainCandidate } from '@/lib/agent/tuning/explain';
import { closedTradesFromExitEvidence, computeEdge, type EdgeMetrics } from '@/lib/agent/tuning/metrics';
import { checkGuardrails, promote, maybeRollback } from '@/lib/agent/tuning/promote';

const TUNE_WINDOW_DAYS = 20;

const istFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const istDate = () => istFmt.format(new Date());
const istDateOf = (d: Date) => istFmt.format(d);

export interface SelfTuneSleeveResult {
  sleeveKey: string;
  sessions: number;
  decision: 'PROPOSED' | 'HELD' | 'PROMOTED' | 'REJECTED' | 'SKIPPED';
  delta: string;
  championNetPaisa: number | null;
  challengerNetPaisa: number | null;
  rolledBack: boolean;
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
  for (const sleeve of sleeves) results.push(await tuneSleeve(userId, sleeve, runDate, windowDays));
  return { status: 'COMPLETED', runDate, sleeves: results };
}

async function tuneSleeve(
  userId: string, sleeve: AgentSleeve, runDate: string, windowDays: number,
): Promise<SelfTuneSleeveResult> {
  await archiveSession(userId, sleeve, runDate).catch(() => ({ archived: 0, symbols: 0 }));
  const sessions = await loadWindow(sleeve.id, windowDays);
  let champion = resolveOrbParams(sleeve.paramsJson as Record<string, unknown> | null);

  if (!sessions.length) {
    return blank(sleeve.key, 'SKIPPED', 'no change', null, null, false,
      'No archived sessions yet — corpus still warming up.');
  }

  // 0. Rollback check — may revert champion under-foot (and blocks promotion this run).
  let note = '';
  if (sleeve.tuningAutoPromote) {
    const rb = await runRollbackCheck(sleeve, sessions);
    if (rb.rolledBack && rb.revertedParams) { champion = rb.revertedParams; note = `Rolled back (${rb.reason}). `; }
  }
  const rolledBack = note.length > 0;

  // 1-3. Score champion + one-step neighbours over the window.
  const championWin = replayWindow(sessions, sleeve.allocationPaisa, champion);
  const scored = neighborCandidates(champion)
    .map((c) => ({ params: c, win: replayWindow(sessions, sleeve.allocationPaisa, c) }))
    .sort((a, b) => b.win.metrics.netPaisa - a.win.metrics.netPaisa);
  const best = scored[0];
  const improves = !!best && best.win.metrics.netPaisa > championWin.metrics.netPaisa;
  const challenger: { params: OrbParams; win: WindowResult } = improves ? best : { params: champion, win: championWin };

  // 4. Decide. Propose if better; promote only when auto-promote is on, no rollback
  //    happened this run, and ALL guardrails pass.
  let decision: AgentParamDecision = improves ? 'PROPOSED' : 'HELD';
  let guardReason = '';
  if (improves && sleeve.tuningAutoPromote && !rolledBack) {
    const sessionsSince = await sessionsSinceLastPromotion(sleeve.id, sessions);
    const gc = checkGuardrails({
      championMetrics: championWin.metrics, challengerMetrics: best.win.metrics,
      championRealized: championWin.closedTrades.map((t) => t.realizedPnlPaisa),
      challengerRealized: best.win.closedTrades.map((t) => t.realizedPnlPaisa),
      sessions: sessions.length, sessionsSinceLastPromotion: sessionsSince,
    });
    guardReason = gc.reason;
    if (gc.ok) decision = 'PROMOTED';
  }

  const rationale = improves
    ? note + (await explainCandidate({
        championParams: champion, championMetrics: championWin.metrics,
        challengerParams: challenger.params, challengerMetrics: challenger.win.metrics,
        sessions: sessions.length, willPromote: decision === 'PROMOTED',
      })) + (decision === 'PROPOSED' && sleeve.tuningAutoPromote ? ` Auto-promote withheld: ${guardReason}.` : '')
    : note + `Held ${describeParams(champion)}: no one-step neighbour beat champion over ${sessions.length} session(s).`;

  // 5. Log the experiment, then promote (so history can FK the experiment).
  const [exp] = await db.insert(agentParamExperiments).values({
    userId, sleeveId: sleeve.id, runDate,
    windowFrom: sessions[0].runDate, windowTo: sessions[sessions.length - 1].runDate, sessions: sessions.length,
    championParams: champion as unknown as AgentSleeveParams, championMetrics: championWin.metrics as unknown as Record<string, unknown>,
    challengerParams: challenger.params as unknown as AgentSleeveParams, challengerMetrics: challenger.win.metrics as unknown as Record<string, unknown>,
    decision, reason: improves ? describeDelta(champion, challenger.params) : 'no improving neighbour', llmRationale: rationale,
  }).returning();

  if (decision === 'PROMOTED') {
    await promote({
      userId, sleeve, experimentId: exp.id, fromParams: champion, toParams: challenger.params,
      triggerMetrics: challenger.win.metrics, baselineMetrics: championWin.metrics,
    });
  }

  return {
    sleeveKey: sleeve.key, sessions: sessions.length, decision,
    delta: improves ? describeDelta(champion, challenger.params) : 'no change',
    championNetPaisa: championWin.metrics.netPaisa,
    challengerNetPaisa: improves ? challenger.win.metrics.netPaisa : null,
    rolledBack, rationale,
  };
}

/** Revert a prior promotion if its cool-down elapsed and live edge underperformed. */
async function runRollbackCheck(
  sleeve: AgentSleeve, sessions: ReplaySession[],
): Promise<{ rolledBack: boolean; reason: string; revertedParams?: OrbParams }> {
  const last = (await db.select().from(agentParamHistory)
    .where(and(eq(agentParamHistory.sleeveId, sleeve.id), eq(agentParamHistory.rolledBack, false)))
    .orderBy(desc(agentParamHistory.promotedAt)).limit(1))[0];
  if (!last?.promotedAt) return { rolledBack: false, reason: 'no active promotion' };

  const promoDate = istDateOf(last.promotedAt);
  const sessionsSince = sessions.filter((s) => s.runDate > promoDate).length;
  const liveExits = await db.select({ symbol: agentDecisions.symbol, evidenceJson: agentDecisions.evidenceJson })
    .from(agentDecisions)
    .where(and(eq(agentDecisions.sleeveId, sleeve.id), gt(agentDecisions.createdAt, last.promotedAt)));
  const liveTrades = closedTradesFromExitEvidence(
    liveExits.filter((r) => r.evidenceJson).map((r) => ({ symbol: r.symbol, evidence: r.evidenceJson! })),
  );
  const rb = await maybeRollback({
    sleeve, lastPromotion: last, sessionsSincePromotion: sessionsSince,
    liveMetricsSincePromotion: computeEdge(liveTrades),
  });
  return { rolledBack: rb.rolledBack, reason: rb.reason, revertedParams: rb.rolledBack ? resolveOrbParams(last.fromParams as Record<string, unknown> | null) : undefined };
}

/** Sessions in the window after the most recent promotion (any), for cool-down. */
async function sessionsSinceLastPromotion(sleeveId: number, sessions: ReplaySession[]): Promise<number | null> {
  const last = (await db.select({ promotedAt: agentParamHistory.promotedAt }).from(agentParamHistory)
    .where(eq(agentParamHistory.sleeveId, sleeveId)).orderBy(desc(agentParamHistory.promotedAt)).limit(1))[0];
  if (!last?.promotedAt) return null;
  const d = istDateOf(last.promotedAt);
  return sessions.filter((s) => s.runDate > d).length;
}

function describeParams(p: OrbParams): string {
  return `targetR ${p.targetR}/risk ${p.riskPctPerTrade}%/max ${p.maxConcurrent}`;
}

function blank(
  key: string, decision: SelfTuneSleeveResult['decision'], delta: string,
  championNet: number | null, challengerNet: number | null, rolledBack: boolean, rationale: string,
): SelfTuneSleeveResult {
  return { sleeveKey: key, sessions: 0, decision, delta, championNetPaisa: championNet, challengerNetPaisa: challengerNet, rolledBack, rationale };
}

export type { EdgeMetrics };
