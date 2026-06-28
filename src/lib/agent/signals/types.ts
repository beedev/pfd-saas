/**
 * Shared types for the analyst-agent signal engine. Pure, no DB/IO.
 * Prices are integer paisa; percentages/scores are plain numbers.
 */

import type { AgentSignalsJson, AgentRecommendation, AgentRiskProfile } from '@/db/schema';

export type { AgentSignalsJson, AgentRecommendation, AgentRiskProfile };

export interface SignalResult {
  /** Composite score in [-100, 100]; positive = bullish. */
  score: number;
  signals: AgentSignalsJson;
}
