/**
 * LLM router (Phase 2.1 + 1.4). Maps a free-text message to one LLM-eligible
 * capability via OpenAI function-calling. The model never touches data — it only
 * chooses a tool + args; the worker executes and re-validates. The caller passes
 * the *already-filtered* eligible set (user-included AND dataIntegrity=false), so
 * Settings → Assistant APIs governs exactly what the LLM can reach. Raw fetch (no
 * SDK), gpt-4o-mini, temperature 0.
 */
import type { Capability } from './registry';

export interface LLMCandidate {
  capabilityId: string;
  args: Record<string, unknown>;
}

export interface LLMRoute {
  capabilityId: string | null;
  args: Record<string, unknown>;
  /** Set when the message plausibly matches >1 tool — the worker asks the user to choose. */
  candidates?: LLMCandidate[];
  clarify?: string;
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT =
  'You are Artha, a personal-finance assistant. Pick the available tool(s) that ' +
  'satisfy the user message and extract their arguments. If exactly one tool ' +
  'clearly fits, call just that one. If the request genuinely could mean more ' +
  'than one distinct tool (it is ambiguous), call ALL the plausible tools — the ' +
  'user will be asked to choose. If no tool fits, do NOT call a tool — briefly ' +
  'say what you can help with.';

export async function routeWithLLM(message: string, eligible: Capability[]): Promise<LLMRoute> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { capabilityId: null, args: {}, clarify: 'AI chat isn’t configured here. Use a slash command — try /help.' };
  }
  if (eligible.length === 0) {
    return { capabilityId: null, args: {}, clarify: 'No AI-enabled actions are turned on. Use a slash command — try /help.' };
  }

  // The caller has already restricted `eligible` to user-included,
  // dataIntegrity=false capabilities.
  const tools = eligible.map((c) => ({
    type: 'function' as const,
    function: {
      name: c.id,
      description: c.summary,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          c.params.map((p) => [p.name, { type: p.type === 'number' ? 'number' : 'string', description: p.description }]),
        ),
        required: c.params.filter((p) => p.required).map((p) => p.name),
        additionalProperties: false,
      },
    },
  }));

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4.1',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      tools,
      tool_choice: 'auto',
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
  const msg = j.choices?.[0]?.message;
  const valid = new Set(eligible.map((c) => c.id));

  // Collect every tool call, dedup by capability id (keep first args), drop
  // any name not in the eligible set.
  const seen = new Set<string>();
  const candidates: LLMCandidate[] = [];
  for (const tc of msg?.tool_calls ?? []) {
    const name = tc.function?.name;
    if (!name || !valid.has(name) || seen.has(name)) continue;
    seen.add(name);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments || '{}');
    } catch {
      /* malformed → empty; required-check catches it */
    }
    candidates.push({ capabilityId: name, args });
  }

  if (candidates.length === 0) return { capabilityId: null, args: {}, clarify: msg?.content ?? undefined };
  if (candidates.length === 1) return { capabilityId: candidates[0].capabilityId, args: candidates[0].args };
  return { capabilityId: null, args: {}, candidates };
}
