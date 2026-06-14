/**
 * LLM router (Phase 2.1). Maps a free-text message to one LLM-eligible
 * capability (dataIntegrity=false ONLY) via OpenAI function-calling. The model
 * never touches data — it only chooses a tool + args; the worker executes and
 * re-validates. Raw fetch (no SDK), gpt-4o-mini, temperature 0.
 */
import { CAPABILITIES } from './registry';

export interface LLMRoute {
  capabilityId: string | null;
  args: Record<string, unknown>;
  clarify?: string;
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT =
  'You are Artha, a personal-finance assistant. Map the user message to exactly ' +
  'one available tool when it clearly matches, extracting its arguments. If no ' +
  'tool clearly fits, do NOT call a tool — instead briefly say what you can help with.';

export async function routeWithLLM(message: string): Promise<LLMRoute> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { capabilityId: null, args: {}, clarify: 'AI chat isn’t configured here. Use a slash command — try /help.' };
  }

  // Only LLM-eligible (dataIntegrity=false) capabilities are exposed as tools.
  const tools = CAPABILITIES.filter((c) => !c.dataIntegrity).map((c) => ({
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
      model: 'gpt-4o-mini',
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
  const call = msg?.tool_calls?.[0]?.function;
  if (call?.name) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch {
      /* malformed → empty, required-check will catch it */
    }
    return { capabilityId: call.name, args };
  }
  return { capabilityId: null, args: {}, clarify: msg?.content ?? undefined };
}
