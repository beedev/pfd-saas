/**
 * Pre-market brief — built ~07:30 IST. Refresh the RSS feeds, then for each
 * stock with fresh overnight/morning headlines ask the LLM for a likely INTRADAY
 * directional stance (BULLISH / BEARISH / NEUTRAL + impact + one-line why).
 * Stored once per day; the intraday ORB sleeve reads it to decide what to BUY
 * (longs) vs SHORT. Global (shared across users). Money/logic side-effect-free
 * beyond the agent_news + agent_daily_brief tables.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, agentNews, agentDailyBrief, type AgentBriefBias, type AgentDailyBrief } from '@/db';
import { runNewsIngest } from './ingest';
import { recordLlmUsage, type OpenAiUsage } from '../llm/usage';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function runPremarketBrief(): Promise<{ analyzed: number; date: string; bullish: number; bearish: number }> {
  const date = istDate();
  await runNewsIngest().catch(() => {}); // refresh feeds + per-item sentiment first

  // Fresh tagged equity news from the overnight/morning window.
  const since = new Date(Date.now() - 18 * 60 * 60 * 1000);
  const rows = await db.select().from(agentNews)
    .where(and(gte(agentNews.publishedAt, since), sql`${agentNews.symbols} is not null and jsonb_array_length(${agentNews.symbols}) > 0`))
    .orderBy(desc(agentNews.publishedAt)).limit(400);

  const bySym = new Map<string, { titles: string[]; rel: number }>();
  for (const r of rows) {
    for (const s of r.symbols ?? []) {
      if (!s.endsWith('.NS')) continue; // intraday tradeable equities only
      const e = bySym.get(s) ?? { titles: [], rel: 0 };
      if (e.titles.length < 5) e.titles.push(r.title);
      e.rel = Math.max(e.rel, r.relevance ?? 0);
      bySym.set(s, e);
    }
  }
  const candidates = [...bySym.entries()].filter(([, e]) => e.rel >= 0.3).slice(0, 40);
  const key = process.env.OPENAI_API_KEY;
  if (!candidates.length || !key) return { analyzed: 0, date, bullish: 0, bearish: 0 };

  // One LLM pass → a directional stance per stock.
  let stances: Array<{ symbol: string; bias: string; impact: number; why: string }> = [];
  try {
    const list = candidates.map(([s, e]) => `${s}\n${e.titles.map((t) => '  - ' + t).join('\n')}`).join('\n\n');
    const res = await fetch(OPENAI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4.1', temperature: 0,
        messages: [
          { role: 'system', content: 'You are an Indian-market pre-market analyst. For each stock and its overnight/morning headlines, judge the LIKELY INTRADAY price direction. Return JSON only: {"items":[{"symbol":"<symbol>","bias":"BULLISH|BEARISH|NEUTRAL","impact":<0..1 expected intraday magnitude>,"why":"<one short line>"}]}. Be conservative — use NEUTRAL unless the news is clearly directional and material.' },
          { role: 'user', content: list },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (res.ok) {
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: OpenAiUsage };
      await recordLlmUsage('premarket_brief', 'gpt-4.1', j.usage);
      stances = (JSON.parse(j.choices?.[0]?.message?.content ?? '{}').items ?? []) as typeof stances;
    }
  } catch { /* leave stances empty → all NEUTRAL */ }

  let analyzed = 0, bullish = 0, bearish = 0;
  for (const [sym, e] of candidates) {
    const st = stances.find((x) => x.symbol === sym);
    const bias: AgentBriefBias = st && ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(st.bias) ? (st.bias as AgentBriefBias) : 'NEUTRAL';
    if (bias === 'BULLISH') bullish++; else if (bias === 'BEARISH') bearish++;
    await db.insert(agentDailyBrief).values({
      briefDate: date, symbol: sym, bias, impact: st?.impact ?? null, rationale: st?.why ?? null, headlineCount: e.titles.length,
    }).onConflictDoUpdate({
      target: [agentDailyBrief.briefDate, agentDailyBrief.symbol],
      set: { bias, impact: st?.impact ?? null, rationale: st?.why ?? null, headlineCount: e.titles.length },
    });
    analyzed++;
  }
  return { analyzed, date, bullish, bearish };
}

export async function getTodayBrief(): Promise<AgentDailyBrief[]> {
  return db.select().from(agentDailyBrief).where(eq(agentDailyBrief.briefDate, istDate())).orderBy(desc(agentDailyBrief.impact));
}

/** symbol → today's directional stance, for the intraday sleeve's gate. */
export async function getBriefBias(): Promise<Map<string, { bias: AgentBriefBias; impact: number | null }>> {
  const rows = await getTodayBrief();
  const m = new Map<string, { bias: AgentBriefBias; impact: number | null }>();
  for (const r of rows) m.set(r.symbol, { bias: r.bias, impact: r.impact });
  return m;
}
