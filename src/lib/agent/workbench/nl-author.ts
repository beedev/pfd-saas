/**
 * NL → strategy author. Turns a plain-English description into a DSL spec via the
 * LLM (constrained to emit ONLY the DSL grammar as JSON), then renders the spec
 * BACK into English deterministically so the user confirms what will actually run
 * — not what the LLM claims. The explain-back is code, not the model, so it can't
 * lie. Reuses the shared OpenAI plumbing + per-task cost tracking.
 */

import { recordLlmUsage, MODEL_FOR, type OpenAiUsage } from '../llm/usage';
import type { DslSpec, NumExpr, Condition, StopRule } from './dsl';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = MODEL_FOR.nl_author;

const GRAMMAR = `
The DSL is JSON. A strategy is long-only.
Shape: { "meta": {id,name,description,horizon,universe}, "params":[{key,label,min,max,step,default}], "entry":<Condition>, "exit":<Condition>, "stop":<Stop>?, "maxHoldDays":<Num>? }
  horizon ∈ INTRADAY|SWING|POSITION (use SWING for multi-day holds). universe ∈ NIFTY_500|NIFTY_50|ETF|WATCHLIST.
NumExpr (a number): a literal number; {"param":"key"}; {"close":off}|{"open":off}|{"high":off}|{"low":off} (off 0=today,1=yesterday);
  {"sma":n}|{"rsi":n}|{"atr":n}; {"priorHigh":n}|{"priorLow":n} (extreme over prior n bars); {"sub":[a,b]}|{"add":..}|{"mul":..}|{"div":..}.
Condition (a boolean): {"gt":[a,b]}|{"lt":..}|{"gte":..}|{"lte":..}; {"and":[..]}|{"or":[..]}|{"not":c};
  {"consecutiveDownDays":n}|{"consecutiveUpDays":n}; {"gapDownPct":n}|{"gapUpPct":n}; {"crossAbove":[a,b]}|{"crossBelow":[a,b]}.
Stop: {"type":"atr","n":14,"mult":<Num>} or {"type":"pct","pct":<Num>}.
Every tunable number the user mentions should be a param (so it can be swept/tuned), referenced as {"param":"key"}.
Example — "buy after 3 down days, sell when close tops the prior day's high, 3xATR stop, max hold 5 days":
{"meta":{"id":"turnaround","name":"Turnaround","description":"...","horizon":"SWING","universe":"NIFTY_500"},
 "params":[{"key":"downDays","label":"Down days","min":2,"max":6,"step":1,"default":3},{"key":"stopAtr","label":"Stop xATR","min":1,"max":4,"step":0.5,"default":3},{"key":"maxHold","label":"Max hold","min":2,"max":10,"step":1,"default":5}],
 "entry":{"consecutiveDownDays":{"param":"downDays"}},"exit":{"gt":[{"close":0},{"high":1}]},"stop":{"type":"atr","n":14,"mult":{"param":"stopAtr"}},"maxHoldDays":{"param":"maxHold"}}`;

export interface AuthorResult { spec: DslSpec | null; explain: string; warnings: string[] }

export async function authorStrategy(nl: string, hints?: { universe?: string; horizon?: string }): Promise<AuthorResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { spec: null, explain: '', warnings: ['OPENAI_API_KEY not set — cannot author from text'] };
  const system = [
    'You translate a plain-English trading strategy into a DSL spec. Output JSON ONLY, matching the grammar exactly. Do not invent primitives not in the grammar.',
    'If the description needs a primitive the grammar lacks, still return your best spec and add a top-level "missing" array naming what you could not express.',
    GRAMMAR,
  ].join('\n');
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Strategy: ${nl}\nDefault universe: ${hints?.universe ?? 'NIFTY_500'}, horizon: ${hints?.horizon ?? 'SWING'}. Return the DSL JSON.` },
        ],
      }),
    });
    if (!res.ok) return { spec: null, explain: '', warnings: [`LLM error ${res.status}`] };
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: OpenAiUsage };
    await recordLlmUsage('nl_author', MODEL, j.usage);
    const raw = JSON.parse(j.choices?.[0]?.message?.content ?? '{}');
    const warnings: string[] = Array.isArray(raw.missing) && raw.missing.length ? [`LLM could not express: ${raw.missing.join(', ')} — a primitive may need adding`] : [];
    const spec = validateSpec(raw);
    if (!spec.ok) return { spec: null, explain: '', warnings: [...warnings, ...spec.errors] };
    return { spec: spec.value, explain: explainSpec(spec.value), warnings };
  } catch (e) {
    return { spec: null, explain: '', warnings: [`author failed: ${e instanceof Error ? e.message : 'unknown'}`] };
  }
}

/** Shallow structural validation — the interpreter is total (bad nodes → false/NaN), this just catches missing top-level pieces. */
export function validateSpec(raw: unknown): { ok: true; value: DslSpec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = raw as Partial<DslSpec>;
  if (!s || typeof s !== 'object') return { ok: false, errors: ['not an object'] };
  if (!s.meta?.id || !s.meta?.name) errors.push('missing meta.id/name');
  if (!s.entry) errors.push('missing entry condition');
  if (!s.exit) errors.push('missing exit condition');
  if (!Array.isArray(s.params)) errors.push('missing params array');
  return errors.length ? { ok: false, errors } : { ok: true, value: raw as DslSpec };
}

// ---- Deterministic English renderer (the confirmation the user approves) ----
const off = (n: number) => (n === 0 ? '' : n === 1 ? " (prior day's)" : ` (${n}d ago)`);
function num(e: NumExpr): string {
  if (typeof e === 'number') return String(e);
  if ('param' in e) return `«${e.param}»`;
  if ('close' in e) return `close${off(e.close)}`;
  if ('open' in e) return `open${off(e.open)}`;
  if ('high' in e) return `high${off(e.high)}`;
  if ('low' in e) return `low${off(e.low)}`;
  if ('sma' in e) return `${e.sma}-day SMA`;
  if ('rsi' in e) return `RSI(${e.rsi})`;
  if ('atr' in e) return `ATR(${e.atr})`;
  if ('priorHigh' in e) return `${e.priorHigh}-day high`;
  if ('priorLow' in e) return `${e.priorLow}-day low`;
  if ('sub' in e) return `(${num(e.sub[0])} − ${num(e.sub[1])})`;
  if ('add' in e) return `(${num(e.add[0])} + ${num(e.add[1])})`;
  if ('mul' in e) return `(${num(e.mul[0])} × ${num(e.mul[1])})`;
  if ('div' in e) return `(${num(e.div[0])} ÷ ${num(e.div[1])})`;
  return '?';
}
function cond(c: Condition): string {
  if (typeof c === 'boolean') return String(c);
  if ('gt' in c) return `${num(c.gt[0])} > ${num(c.gt[1])}`;
  if ('lt' in c) return `${num(c.lt[0])} < ${num(c.lt[1])}`;
  if ('gte' in c) return `${num(c.gte[0])} ≥ ${num(c.gte[1])}`;
  if ('lte' in c) return `${num(c.lte[0])} ≤ ${num(c.lte[1])}`;
  if ('and' in c) return c.and.map(cond).join(' AND ');
  if ('or' in c) return c.or.map(cond).join(' OR ');
  if ('not' in c) return `NOT (${cond(c.not)})`;
  if ('consecutiveDownDays' in c) return `the last ${num(c.consecutiveDownDays)} closes each fell`;
  if ('consecutiveUpDays' in c) return `the last ${num(c.consecutiveUpDays)} closes each rose`;
  if ('gapDownPct' in c) return `the open gapped down ≥ ${num(c.gapDownPct)}%`;
  if ('gapUpPct' in c) return `the open gapped up ≥ ${num(c.gapUpPct)}%`;
  if ('crossAbove' in c) return `${num(c.crossAbove[0])} crossed above ${num(c.crossAbove[1])}`;
  if ('crossBelow' in c) return `${num(c.crossBelow[0])} crossed below ${num(c.crossBelow[1])}`;
  return '?';
}
const stopStr = (s: StopRule): string => s.type === 'atr' ? `stop ${num(s.mult)}×ATR(${s.n})` : `stop ${num(s.pct)}% below entry`;

/** Render a spec to plain English — this is what the user confirms before it runs. */
export function explainSpec(spec: DslSpec): string {
  const parts = [`BUY when ${cond(spec.entry)}`, `EXIT when ${cond(spec.exit)}`];
  if (spec.maxHoldDays != null) parts[1] += `, or after ${num(spec.maxHoldDays)} days`;
  if (spec.stop) parts.push(stopStr(spec.stop));
  const p = spec.params.length ? `  Params: ${spec.params.map((x) => `${x.key}=${x.default}`).join(', ')}.` : '';
  return parts.join('. ') + '.' + p;
}
