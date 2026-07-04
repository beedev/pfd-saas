/**
 * LLM usage + cost ledger. Every OpenAI call the analyst makes (news sentiment,
 * pre-market brief, signal tagging, tuning explain, advisory) records its token
 * usage here, with a cost computed from a per-model price table. Best-effort —
 * a failed insert never breaks the calling job. Cost in micro-USD (integer).
 *
 * PRICING is OpenAI's published per-1M-token rates (verified 2026-07-02). Update
 * the one table below if OpenAI changes them.
 */

import { desc, gte, sql } from 'drizzle-orm';
import { db, agentLlmUsage } from '@/db';

export type LlmTask = 'news_sentiment' | 'premarket_brief' | 'signal_tagging' | 'tuning_explain' | 'advisory' | 'nl_author';

/**
 * Per-task model. mini for the cheap/low-stakes high-volume tasks; 4.1 for the
 * quality-critical ones (brief drives trades, tagging must keep the dictionary
 * consistent, advisory must not misgroup numbers). Flip any task here — cost per
 * task is tracked so you can measure the effect. (gpt-4.1-mini ≠ the older
 * gpt-4o-mini; it follows instructions far better.)
 */
export const MODEL_FOR: Record<LlmTask, string> = {
  news_sentiment: 'gpt-4.1-mini',
  tuning_explain: 'gpt-4.1-mini',
  premarket_brief: 'gpt-4.1',
  signal_tagging: 'gpt-4.1',
  advisory: 'gpt-4.1',
  nl_author: 'gpt-4.1',              // strategy authoring is high-stakes — use the strong model
};

export interface LlmPrice { inputPerM: number; outputPerM: number } // USD per 1,000,000 tokens

export const LLM_PRICING: Record<string, LlmPrice> = {
  'gpt-4.1': { inputPerM: 2.00, outputPerM: 8.00 },
  'gpt-4.1-mini': { inputPerM: 0.40, outputPerM: 1.60 },
  'gpt-4.1-nano': { inputPerM: 0.10, outputPerM: 0.40 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.60 },
};

export interface OpenAiUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }

/** Cost of a call in micro-USD (USD × 1e6). Unknown model → 0 (still logs tokens). */
export function costMicroUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = LLM_PRICING[model];
  if (!p) return 0;
  const usd = (promptTokens / 1e6) * p.inputPerM + (completionTokens / 1e6) * p.outputPerM;
  return Math.round(usd * 1e6);
}

/** Log one call's usage + cost. Best-effort; swallows errors. */
export async function recordLlmUsage(task: LlmTask, model: string, usage: OpenAiUsage | undefined): Promise<void> {
  const pt = usage?.prompt_tokens ?? 0, ct = usage?.completion_tokens ?? 0;
  if (!pt && !ct) return;
  try {
    await db.insert(agentLlmUsage).values({
      task, model, promptTokens: pt, completionTokens: ct, costMicroUsd: costMicroUsd(model, pt, ct),
    });
  } catch { /* never break the job for accounting */ }
}

export interface UsageSummary {
  totals: { calls: number; promptTokens: number; completionTokens: number; costUsd: number };
  byTask: Array<{ task: string; calls: number; promptTokens: number; completionTokens: number; costUsd: number }>;
  byDay: Array<{ day: string; calls: number; costUsd: number }>;
  last30dCostUsd: number;
}

/** Aggregate usage for the Settings view. */
export async function getUsageSummary(): Promise<UsageSummary> {
  const micro = (n: unknown) => Number(n ?? 0) / 1e6;

  const totalsRes = await db.execute(sql`
    SELECT count(*) calls, coalesce(sum(prompt_tokens),0) pt, coalesce(sum(completion_tokens),0) ct, coalesce(sum(cost_micro_usd),0) cost
    FROM agent_llm_usage`);
  const t = ((totalsRes as unknown as { rows?: Record<string, unknown>[] }).rows ?? (totalsRes as unknown as Record<string, unknown>[]))[0] ?? {};

  const byTaskRes = await db.execute(sql`
    SELECT task, count(*) calls, coalesce(sum(prompt_tokens),0) pt, coalesce(sum(completion_tokens),0) ct, coalesce(sum(cost_micro_usd),0) cost
    FROM agent_llm_usage GROUP BY task ORDER BY cost DESC`);
  const taskRows = (byTaskRes as unknown as { rows?: Record<string, unknown>[] }).rows ?? (byTaskRes as unknown as Record<string, unknown>[]);

  const byDayRes = await db.execute(sql`
    SELECT to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') dt,
           count(*) calls, coalesce(sum(cost_micro_usd),0) cost
    FROM agent_llm_usage GROUP BY 1 ORDER BY 1 DESC LIMIT 30`);
  const dayRows = (byDayRes as unknown as { rows?: Record<string, unknown>[] }).rows ?? (byDayRes as unknown as Record<string, unknown>[]);

  const last30 = await db.select({ cost: sql<number>`coalesce(sum(${agentLlmUsage.costMicroUsd}),0)` }).from(agentLlmUsage)
    .where(gte(agentLlmUsage.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));

  return {
    totals: { calls: Number(t.calls ?? 0), promptTokens: Number(t.pt ?? 0), completionTokens: Number(t.ct ?? 0), costUsd: micro(t.cost) },
    byTask: taskRows.map((r) => ({ task: String(r.task), calls: Number(r.calls), promptTokens: Number(r.pt), completionTokens: Number(r.ct), costUsd: micro(r.cost) })),
    byDay: dayRows.map((r) => ({ day: String(r.dt), calls: Number(r.calls), costUsd: micro(r.cost) })),
    last30dCostUsd: micro(last30[0]?.cost),
  };
}
