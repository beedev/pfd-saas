/**
 * LLM explainer — the "why" for a tuning proposal. The deterministic search
 * (candidates.ts + replay) DECIDES; this only narrates the chosen candidate for
 * the experiment log + Telegram digest. gpt-4.1 (project standard), temperature
 * 0, grounded strictly in the supplied numbers. Always falls back to a plain
 * deterministic sentence when the key is missing or the call fails — the
 * decision never depends on the LLM.
 */

import type { OrbParams } from '../engine/orb-step';
import type { EdgeMetrics } from './metrics';
import { describeDelta } from './candidates';
import { recordLlmUsage, type OpenAiUsage } from '../llm/usage';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const rupee = (p: number | null | undefined) => p == null ? 'n/a' : '₹' + Math.round(p / 100).toLocaleString('en-IN');

export interface ExplainInput {
  championParams: OrbParams;
  championMetrics: EdgeMetrics;
  challengerParams: OrbParams;
  challengerMetrics: EdgeMetrics;
  sessions: number;
  willPromote: boolean;
}

function deterministicWhy(i: ExplainInput): string {
  const delta = describeDelta(i.championParams, i.challengerParams);
  const c = i.challengerMetrics, h = i.championMetrics;
  const verb = i.willPromote ? 'Promoting' : 'Proposed (monitor)';
  return `${verb} ${delta}: over ${i.sessions} session(s), net ${rupee(c.netPaisa)} vs champion ${rupee(h.netPaisa)} `
    + `(win ${c.winRatePct?.toFixed(0) ?? 'n/a'}% vs ${h.winRatePct?.toFixed(0) ?? 'n/a'}%, `
    + `avgR ${c.avgRMultiple ?? 'n/a'} vs ${h.avgRMultiple ?? 'n/a'}, cost-drag ${c.costDragPct ?? 'n/a'}%).`;
}

export async function explainCandidate(i: ExplainInput): Promise<string> {
  const fallback = deterministicWhy(i);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;
  try {
    const payload = {
      knobChanged: describeDelta(i.championParams, i.challengerParams),
      sessionsReplayed: i.sessions,
      champion: pick(i.championMetrics),
      challenger: pick(i.challengerMetrics),
      action: i.willPromote ? 'PROMOTE' : 'PROPOSE_ONLY',
    };
    const res = await fetch(OPENAI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4.1', temperature: 0,
        messages: [
          { role: 'system', content: 'You explain a parameter-tuning decision for an intraday Opening-Range-Breakout paper-trading sleeve (Indian equities, costs + 30% intraday tax already netted). Write ONE plain, concrete sentence (<40 words) on why the challenger param set is better or worse than the champion, grounded ONLY in the supplied numbers (net P&L is paisa). Name the knob changed. Do not invent figures or give financial advice.' },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: OpenAiUsage };
    await recordLlmUsage('tuning_explain', 'gpt-4.1', j.usage);
    const text = j.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : fallback;
  } catch {
    return fallback;
  }
}

function pick(m: EdgeMetrics) {
  return {
    netPaisa: m.netPaisa, n: m.n, winRatePct: m.winRatePct, avgRMultiple: m.avgRMultiple,
    costDragPct: m.costDragPct, payoffRatio: m.payoffRatio, exitMix: m.exitMix,
  };
}
