/**
 * Map a composite score (-100..100) to a BUY/SELL/HOLD recommendation,
 * with thresholds tuned by the user's risk profile (aggressive acts on
 * weaker signals; conservative needs stronger conviction).
 */

import type { AgentRecommendation, AgentRiskProfile } from './types';

const THRESHOLDS: Record<AgentRiskProfile, number> = {
  AGGRESSIVE: 15,
  BALANCED: 25,
  CONSERVATIVE: 40,
};

export function scoreToRecommendation(
  score: number,
  riskProfile: AgentRiskProfile,
): AgentRecommendation {
  const t = THRESHOLDS[riskProfile] ?? THRESHOLDS.BALANCED;
  if (score >= t) return 'BUY';
  if (score <= -t) return 'SELL';
  return 'HOLD';
}

/** Coarse confidence label from the score magnitude (for display). */
export function scoreToConfidence(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  const m = Math.abs(score);
  if (m >= 50) return 'HIGH';
  if (m >= 25) return 'MEDIUM';
  return 'LOW';
}
