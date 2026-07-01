/**
 * News → signal-phrase tagging. For each fresh equity headline, the LLM maps it
 * to an EXISTING dictionary phrase (strongly preferred) or mints a new one — the
 * self-curating clustering that gives every signal a stable identity. Runs on the
 * 30-min news-ingest tick over ALL tagged equity news (movers AND non-movers), so
 * the EOD credit-assignment has an honest base rate. No trading here (Phase 1).
 *
 * Grounded strictly in the headline; omits non-predictive/generic news. Global.
 */

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, agentNews, type AgentBriefBias, type AgentSignalPhrase } from '@/db';
import { getActiveDictionary, ensurePhrase, recordTag } from './dictionary';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4.1';
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export interface TagItem { newsId: number; symbol: string; title: string; summary?: string | null }
export interface TagResult { newsId: number; symbol: string; phrase: string; direction: AgentBriefBias; isNew: boolean; description?: string }

/**
 * Ask the LLM to assign each (headline, stock) a signal phrase from the current
 * dictionary, or mint a new one when genuinely distinct. Non-predictive items are
 * omitted. Returns [] if no key / no items / call fails.
 */
export async function tagNewsBatch(items: TagItem[], dictionary: AgentSignalPhrase[]): Promise<TagResult[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !items.length) return [];

  const dict = dictionary.length
    ? dictionary.map((p) => `- "${p.phrase}" (${p.direction})`).join('\n')
    : '(dictionary is empty — mint new phrases as needed)';
  const list = items.map((i) => `[news ${i.newsId} · ${i.symbol}] ${i.title}`).join('\n');

  const system = [
    'You maintain a dictionary of concise, reusable signal phrases that capture WHY a piece of news could move a stock intraday (e.g. "large order win", "block deal", "earnings beat", "regulatory penalty", "promoter stake increase").',
    'For each headline, decide the single best signal phrase and the likely direction (BULLISH or BEARISH).',
    'STRONGLY PREFER an existing dictionary phrase — reuse it verbatim. Mint a NEW phrase ONLY when the news is a genuinely distinct pattern not covered by any existing phrase. Keep new phrases short (2-4 words), general (not company-specific), lowercase.',
    'OMIT a headline entirely if it is generic, routine, or not materially predictive of a move (e.g. index commentary, "market opens higher", vague brokerage chatter).',
    'Return JSON only: {"tags":[{"newsId":<n>,"symbol":"<sym>","phrase":"<phrase>","direction":"BULLISH|BEARISH","isNew":<bool>,"description":"<one short line, only if isNew>"}]}',
  ].join(' ');

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `CURRENT DICTIONARY:\n${dict}\n\nHEADLINES:\n${list}` },
        ],
      }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? '{}').tags ?? [];
    return (parsed as TagResult[]).filter((t) =>
      t && Number.isFinite(t.newsId) && t.symbol && t.phrase && (t.direction === 'BULLISH' || t.direction === 'BEARISH'));
  } catch {
    return [];
  }
}

/**
 * Orchestrator for the ingest tick: tag recent untagged equity news, persist the
 * phrase mappings, and mark those news rows signal-tagged so the base-rate count
 * isn't inflated by re-processing. Idempotent.
 */
export async function tagRecentNews(opts: { sinceHours?: number; limit?: number } = {}): Promise<{
  processed: number; tagged: number; minted: number; dictionarySize: number;
}> {
  const since = new Date(Date.now() - (opts.sinceHours ?? 24) * 60 * 60 * 1000);
  const rows = await db.select({ id: agentNews.id, title: agentNews.title, summary: agentNews.summary, symbols: agentNews.symbols })
    .from(agentNews)
    .where(and(
      eq(agentNews.signalTagged, false),
      gte(agentNews.publishedAt, since),
      sql`${agentNews.symbols} is not null and jsonb_array_length(${agentNews.symbols}) > 0`,
    ))
    .orderBy(desc(agentNews.publishedAt))
    .limit(opts.limit ?? 60);
  if (!rows.length) return { processed: 0, tagged: 0, minted: 0, dictionarySize: (await getActiveDictionary()).length };

  const items: TagItem[] = rows.flatMap((r) =>
    (r.symbols ?? []).filter((s) => s.endsWith('.NS')).map((s) => ({ newsId: r.id, symbol: s, title: r.title, summary: r.summary })));

  const dictionary = await getActiveDictionary();
  const tags = await tagNewsBatch(items, dictionary);
  const today = istDate();

  let minted = 0;
  for (const t of tags) {
    const example = items.find((i) => i.newsId === t.newsId)?.title;
    const { id, minted: m } = await ensurePhrase({
      phrase: t.phrase.trim().toLowerCase(), direction: t.direction, description: t.description, example, istDate: today,
    });
    if (m) minted++;
    await recordTag({ newsId: t.newsId, phraseId: id, symbol: t.symbol, direction: t.direction, istDate: today });
  }

  // Mark every processed news row tagged (even if it yielded no signal) so we
  // don't re-tag it next tick and double-count the base rate.
  const processedIds = [...new Set(rows.map((r) => r.id))];
  if (processedIds.length) {
    await db.update(agentNews).set({ signalTagged: true }).where(inArray(agentNews.id, processedIds));
  }

  return { processed: rows.length, tagged: tags.length, minted, dictionarySize: (await getActiveDictionary()).length };
}
