/**
 * Candidate parameter generation for the ORB tuner — deterministic, bounded
 * hill-climb. From the champion params we emit the one-step neighbours along each
 * tunable knob, clamped to a hard box the tuner can never leave. "One step per
 * candidate" is also the promotion guardrail: a promotion moves exactly one knob
 * by one step, so the loop edges toward better config instead of leaping.
 *
 * Only knobs that actually change `planIntradayTick` behaviour are tuned:
 *   targetR          — the high-value lever (the cost-hurdle diagnosis pointed here)
 *   riskPctPerTrade  — position size per trade
 *   maxConcurrent    — how many simultaneous names
 * (openingRangeMins + LAST_ENTRY are not yet behaviour-driving params — wiring
 *  them live is a follow-up that widens this surface.)
 */

import type { OrbParams } from '../engine/orb-step';

export type TunableKnob = 'targetR' | 'riskPctPerTrade' | 'maxConcurrent';

export interface ParamBound { min: number; max: number; step: number; decimals: number }

export const ORB_PARAM_BOUNDS: Record<TunableKnob, ParamBound> = {
  targetR: { min: 1.0, max: 3.0, step: 0.25, decimals: 2 },
  riskPctPerTrade: { min: 0.25, max: 1.5, step: 0.25, decimals: 2 },
  maxConcurrent: { min: 3, max: 8, step: 1, decimals: 0 },
};

const roundTo = (n: number, d: number) => +n.toFixed(d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Clamp every tunable knob into its box (defends against hand-set out-of-range params). */
export function clampParams(p: OrbParams): OrbParams {
  const out = { ...p };
  for (const k of Object.keys(ORB_PARAM_BOUNDS) as TunableKnob[]) {
    const b = ORB_PARAM_BOUNDS[k];
    out[k] = roundTo(clamp(p[k], b.min, b.max), b.decimals);
  }
  return out;
}

/**
 * One-step neighbours of the champion (±step on each knob, clamped + deduped,
 * excluding the champion itself). At most 2×knobs candidates.
 */
export function neighborCandidates(champion: OrbParams): OrbParams[] {
  const base = clampParams(champion);
  const out: OrbParams[] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(ORB_PARAM_BOUNDS) as TunableKnob[]) {
    const b = ORB_PARAM_BOUNDS[k];
    for (const dir of [-1, 1] as const) {
      const v = roundTo(clamp(base[k] + dir * b.step, b.min, b.max), b.decimals);
      if (v === base[k]) continue;                 // already at the boundary
      const cand: OrbParams = { ...base, [k]: v };
      const sig = `${cand.targetR}|${cand.riskPctPerTrade}|${cand.maxConcurrent}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(cand);
    }
  }
  return out;
}

/** The single knob (and direction) that differs between two param sets, for labelling. */
export function describeDelta(from: OrbParams, to: OrbParams): string {
  const parts: string[] = [];
  for (const k of Object.keys(ORB_PARAM_BOUNDS) as TunableKnob[]) {
    if (from[k] !== to[k]) parts.push(`${k} ${from[k]}→${to[k]}`);
  }
  return parts.join(', ') || 'no change';
}
