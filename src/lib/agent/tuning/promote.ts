/**
 * Promotion gate + rollback for the L3 self-tune loop — the only place that
 * writes live ORB params, and only behind guardrails. A challenger is promoted
 * to `agentSleeves.paramsJson` ONLY when ALL hold:
 *   1. sample floor   — enough sessions AND enough challenger trades (not noise)
 *   2. positive       — challenger net-of-cost edge > 0
 *   3. effect size    — challenger avg R-multiple beats champion by a real margin
 *   4. significance   — a bootstrap says challenger > champion with high confidence
 *   5. cool-down      — no promotion in the last K sessions (let prior moves settle)
 * Each promotion is recorded in agent_param_history (from/to + baseline) so it
 * can be AUTO-ROLLED-BACK if the live edge over the next cool-down window
 * underperforms the pre-promotion baseline.
 *
 * One-step-per-promotion is enforced upstream (candidates.ts emits only one-step
 * neighbours). Paper only; money in paisa.
 */

import { eq } from 'drizzle-orm';
import { db, agentSleeves, agentParamHistory, type AgentSleeve, type AgentParamHistory, type AgentSleeveParams } from '@/db';
import type { OrbParams } from '../engine/orb-step';
import type { EdgeMetrics } from './metrics';

export interface Guardrails {
  minSessions: number;
  minChallengerTrades: number;
  marginR: number;            // required avgR improvement (effect size)
  bootstrapConf: number;      // required P(challenger mean > champion mean)
  bootstrapResamples: number;
  cooldownSessions: number;
}

// Lenient sample floor + bootstrap significance + 5-session cool-down (user-set).
export const DEFAULT_GUARDRAILS: Guardrails = {
  minSessions: 5,
  minChallengerTrades: 10,
  marginR: 0.05,
  bootstrapConf: 0.95,
  bootstrapResamples: 1000,
  cooldownSessions: 5,
};

export interface GuardrailCheck { ok: boolean; reason: string }

/** Bootstrap: fraction of resamples where the challenger's mean beats champion's. */
function bootstrapBeatsProb(
  challenger: number[], champion: number[], resamples: number, rng: () => number,
): number {
  if (!challenger.length || !champion.length) return 0;
  const resampleMean = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rng() * xs.length)];
    return s / xs.length;
  };
  let wins = 0;
  for (let b = 0; b < resamples; b++) if (resampleMean(challenger) > resampleMean(champion)) wins++;
  return wins / resamples;
}

export function checkGuardrails(input: {
  championMetrics: EdgeMetrics;
  challengerMetrics: EdgeMetrics;
  championRealized: number[];
  challengerRealized: number[];
  sessions: number;
  sessionsSinceLastPromotion: number | null;  // null = never promoted
  guardrails?: Guardrails;
  rng?: () => number;
}): GuardrailCheck {
  const g = input.guardrails ?? DEFAULT_GUARDRAILS;
  const rng = input.rng ?? Math.random;
  const { championMetrics: h, challengerMetrics: c } = input;

  if (input.sessionsSinceLastPromotion != null && input.sessionsSinceLastPromotion < g.cooldownSessions)
    return { ok: false, reason: `cool-down: ${input.sessionsSinceLastPromotion}/${g.cooldownSessions} sessions since last promotion` };
  if (input.sessions < g.minSessions)
    return { ok: false, reason: `sample floor: ${input.sessions}/${g.minSessions} sessions` };
  if (c.n < g.minChallengerTrades)
    return { ok: false, reason: `sample floor: ${c.n}/${g.minChallengerTrades} challenger trades` };
  if (c.netPaisa <= 0)
    return { ok: false, reason: `challenger net not positive (${c.netPaisa})` };
  if (c.avgRMultiple == null || h.avgRMultiple == null || c.avgRMultiple - h.avgRMultiple < g.marginR)
    return { ok: false, reason: `effect size: avgR ${c.avgRMultiple ?? 'n/a'} vs ${h.avgRMultiple ?? 'n/a'} (need +${g.marginR})` };

  const prob = bootstrapBeatsProb(input.challengerRealized, input.championRealized, g.bootstrapResamples, rng);
  if (prob < g.bootstrapConf)
    return { ok: false, reason: `not significant: bootstrap P(challenger>champion)=${prob.toFixed(2)} < ${g.bootstrapConf}` };

  return { ok: true, reason: `promote: net +${c.netPaisa} (avgR ${c.avgRMultiple} vs ${h.avgRMultiple}), bootstrap ${prob.toFixed(2)}` };
}

/** Write the challenger params live + record the promotion (rollback source). */
export async function promote(input: {
  userId: string;
  sleeve: AgentSleeve;
  experimentId: number | null;
  fromParams: OrbParams;
  toParams: OrbParams;
  triggerMetrics: EdgeMetrics;     // challenger over the window
  baselineMetrics: EdgeMetrics;    // champion over the window (rollback comparison)
}): Promise<void> {
  const merged = { ...(input.sleeve.paramsJson ?? {}), ...input.toParams } as unknown as AgentSleeveParams;
  await db.update(agentSleeves).set({ paramsJson: merged, updatedAt: new Date() }).where(eq(agentSleeves.id, input.sleeve.id));
  await db.insert(agentParamHistory).values({
    userId: input.userId, sleeveId: input.sleeve.id, experimentId: input.experimentId,
    fromParams: input.fromParams as unknown as AgentSleeveParams,
    toParams: input.toParams as unknown as AgentSleeveParams,
    triggerMetrics: input.triggerMetrics as unknown as Record<string, unknown>,
    baselineMetrics: input.baselineMetrics as unknown as Record<string, unknown>,
  });
}

export interface RollbackResult { rolledBack: boolean; reason: string }

/**
 * After the cool-down window, compare the LIVE edge since a promotion against the
 * pre-promotion baseline. If it underperformed, revert paramsJson to the prior
 * set and mark the history row rolled back.
 */
export async function maybeRollback(input: {
  sleeve: AgentSleeve;
  lastPromotion: AgentParamHistory | null;
  sessionsSincePromotion: number;
  liveMetricsSincePromotion: EdgeMetrics;
  guardrails?: Guardrails;
}): Promise<RollbackResult> {
  const g = input.guardrails ?? DEFAULT_GUARDRAILS;
  const p = input.lastPromotion;
  if (!p || p.rolledBack) return { rolledBack: false, reason: 'no active promotion' };
  if (input.sessionsSincePromotion < g.cooldownSessions)
    return { rolledBack: false, reason: `cool-down active (${input.sessionsSincePromotion}/${g.cooldownSessions})` };

  const baselineAvgR = (p.baselineMetrics as { avgRMultiple?: number } | null)?.avgRMultiple;
  const liveAvgR = input.liveMetricsSincePromotion.avgRMultiple;
  // Need real live trades to judge; if none, hold (don't revert on no evidence).
  if (input.liveMetricsSincePromotion.n === 0 || liveAvgR == null || baselineAvgR == null)
    return { rolledBack: false, reason: 'insufficient live evidence to judge' };

  if (liveAvgR < baselineAvgR) {
    await db.update(agentSleeves)
      .set({ paramsJson: p.fromParams ?? input.sleeve.paramsJson, updatedAt: new Date() })
      .where(eq(agentSleeves.id, input.sleeve.id));
    await db.update(agentParamHistory)
      .set({ rolledBack: true, rolledBackAt: new Date() })
      .where(eq(agentParamHistory.id, p.id));
    return { rolledBack: true, reason: `live avgR ${liveAvgR.toFixed(3)} < baseline ${baselineAvgR.toFixed(3)} after cool-down — reverted` };
  }
  return { rolledBack: false, reason: `live avgR ${liveAvgR.toFixed(3)} ≥ baseline ${baselineAvgR.toFixed(3)} — kept` };
}
