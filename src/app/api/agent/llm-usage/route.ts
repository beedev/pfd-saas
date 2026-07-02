/**
 * GET /api/agent/llm-usage — token + cost summary for the analyst's OpenAI calls
 * (news sentiment, brief, signal tagging, tuning explain, advisory). Read-only,
 * global data, auth-gated. Cost from the per-model price table in llm/usage.ts.
 */

import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getUsageSummary, LLM_PRICING } from '@/lib/agent/llm/usage';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const summary = await getUsageSummary();
  return NextResponse.json({ ...summary, pricing: LLM_PRICING });
}
