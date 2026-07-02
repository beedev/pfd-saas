/**
 * News ingestion: poll RSS feeds → dedup (by guid) → tag to tracked instruments
 * (via Yahoo company names) → LLM sentiment/relevance → store. Plus read helpers:
 * recent news, "in-play" (fresh high-impact names for the intraday experiment),
 * and a fresh-negative-news check used as a live BUY guard. Global/shared.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, agentNews, agentWatchlist, type AgentNews } from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { FEEDS } from './feeds';
import { parseFeed } from './rss';
import { NEWS_EQUITY_UNIVERSE, aliasesFromName } from './universe';
import { tagRecentNews } from '../signal/tag-news';
import { recordLlmUsage, type OpenAiUsage } from '../llm/usage';

const UA = 'Mozilla/5.0 (compatible; PersonalFinanceDashboard/1.0)';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

let aliasCache: { map: Map<string, string[]>; ts: number } | null = null;
const ALIAS_TTL = 60 * 60 * 1000;

/**
 * symbol → name aliases. Tagged universe = the tracked stock/future watchlists
 * (Yahoo longName) PLUS a curated mid/small-cap NEWS_EQUITY_UNIVERSE, so the
 * in-play signal can surface non-large-cap movers for the intraday sleeve.
 * Multi-word names → first two words (distinctive); single-word → the word,
 * matched on a boundary — keeps tagging precise.
 */
async function buildAliasMap(): Promise<Map<string, string[]>> {
  if (aliasCache && Date.now() - aliasCache.ts < ALIAS_TTL) return aliasCache.map;
  const rows = await db.selectDistinct({ symbol: agentWatchlist.symbol, assetClass: agentWatchlist.assetClass }).from(agentWatchlist);
  const symbols = rows.filter((r) => r.assetClass !== 'MF' && r.symbol).map((r) => r.symbol);
  const map = new Map<string, string[]>();
  if (symbols.length) {
    const quotes = await getQuotes(symbols);
    for (const q of quotes) {
      const aliases = aliasesFromName(q.longName || q.shortName || '');
      if (aliases.length) map.set(q.symbol, aliases);
    }
  }
  // Curated mid/small-cap universe (news-only; names provided so no extra quote fetches).
  for (const { symbol, name } of NEWS_EQUITY_UNIVERSE) {
    if (map.has(symbol)) continue;
    const aliases = aliasesFromName(name);
    if (aliases.length) map.set(symbol, aliases);
  }
  aliasCache = { map, ts: Date.now() };
  return map;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function tagSymbols(text: string, aliasMap: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const [sym, aliases] of aliasMap) {
    // Word-boundary match (not substring) → no "bitcoin"→ITC, no "estate"→State.
    if (aliases.some((a) => new RegExp(`\\b${esc(a)}\\b`, 'i').test(text))) out.push(sym);
  }
  return out;
}

export async function runNewsIngest(): Promise<{ fetched: number; inserted: number; tagged: number; scored: number; signalTagged?: number; phrasesMinted?: number }> {
  const aliasMap = await buildAliasMap();
  let fetched = 0, inserted = 0, tagged = 0;
  for (const feed of FEEDS) {
    let xml: string;
    try {
      const r = await fetch(feed.url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
      if (!r.ok) continue;
      xml = await r.text();
    } catch { continue; }
    const items = parseFeed(xml);
    fetched += items.length;
    for (const it of items) {
      const syms = tagSymbols(`${it.title} ${it.summary}`, aliasMap);
      const res = await db.insert(agentNews).values({
        source: feed.source, guid: it.guid, title: it.title, url: it.link || undefined,
        summary: it.summary.slice(0, 2000) || undefined, publishedAt: it.publishedAt || undefined,
        symbols: syms.length ? syms : undefined,
      }).onConflictDoNothing({ target: agentNews.guid }).returning({ id: agentNews.id });
      if (res.length) { inserted++; if (syms.length) tagged++; }
    }
  }
  const scored = await scoreSentiment();
  // Signal-dictionary pass: map fresh equity news to signal phrases (map-or-mint)
  // so the EOD loop has a weighted, honest base-rate catalog. Best-effort.
  const signal = await tagRecentNews().catch(() => ({ tagged: 0, minted: 0 }));
  return { fetched, inserted, tagged, scored, signalTagged: signal.tagged, phrasesMinted: signal.minted };
}

/** LLM sentiment + relevance for freshly-tagged items (batched, bounded). */
async function scoreSentiment(): Promise<number> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return 0;
  const rows = await db.select().from(agentNews)
    .where(and(eq(agentNews.llmDone, false), sql`${agentNews.symbols} is not null and jsonb_array_length(${agentNews.symbols}) > 0`))
    .orderBy(desc(agentNews.id)).limit(20);
  if (!rows.length) return 0;
  try {
    const list = rows.map((r, i) => `${i}. ${r.title}${r.summary ? ' — ' + r.summary.slice(0, 200) : ''}`).join('\n');
    const res = await fetch(OPENAI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4.1', temperature: 0,
        messages: [
          { role: 'system', content: 'You score Indian stock-market headlines. For each numbered item return JSON only: {"items":[{"i":<index>,"sentiment":"POSITIVE|NEGATIVE|NEUTRAL","score":<-1..1>,"relevance":<0..1 how materially it affects the specific stock\'s price>}]}. No prose.' },
          { role: 'user', content: list },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return 0;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: OpenAiUsage };
    await recordLlmUsage('news_sentiment', 'gpt-4.1', j.usage);
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as { items?: Array<{ i: number; sentiment: string; score: number; relevance: number }> };
    let n = 0;
    for (const it of parsed.items ?? []) {
      const row = rows[it.i];
      if (!row) continue;
      const sentiment = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(it.sentiment) ? (it.sentiment as AgentNews['sentiment']) : 'NEUTRAL';
      await db.update(agentNews).set({ sentiment, sentimentScore: it.score, relevance: it.relevance, llmDone: true }).where(eq(agentNews.id, row.id));
      n++;
    }
    // Mark any unscored in this batch done so we don't loop on them.
    for (const r of rows) if (!parsed.items?.some((x) => rows[x.i]?.id === r.id)) await db.update(agentNews).set({ llmDone: true }).where(eq(agentNews.id, r.id));
    return n;
  } catch {
    return 0;
  }
}

/** Recent news, optionally filtered to a set of symbols (any overlap). */
export async function getRecentNews(symbols?: string[], limit = 60): Promise<AgentNews[]> {
  const rows = await db.select().from(agentNews).orderBy(desc(agentNews.publishedAt)).limit(symbols ? 300 : limit);
  if (!symbols?.length) return rows.slice(0, limit);
  const set = new Set(symbols);
  return rows.filter((r) => (r.symbols ?? []).some((s) => set.has(s))).slice(0, limit);
}

/** "In play" = tracked symbols with fresh (≤48h) high-relevance news. */
export async function getInPlay(): Promise<Array<{ symbol: string; headlines: number; topTitle: string; sentiment: string | null }>> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = await db.select().from(agentNews).where(gte(agentNews.publishedAt, since)).orderBy(desc(agentNews.publishedAt)).limit(500);
  const by = new Map<string, { headlines: number; topTitle: string; sentiment: string | null; rel: number }>();
  for (const r of rows) {
    if ((r.relevance ?? 0) < 0.5) continue;
    for (const s of r.symbols ?? []) {
      const e = by.get(s) ?? { headlines: 0, topTitle: r.title, sentiment: r.sentiment, rel: r.relevance ?? 0 };
      e.headlines++;
      if ((r.relevance ?? 0) >= e.rel) { e.topTitle = r.title; e.sentiment = r.sentiment; e.rel = r.relevance ?? 0; }
      by.set(s, e);
    }
  }
  return [...by.entries()].map(([symbol, e]) => ({ symbol, headlines: e.headlines, topTitle: e.topTitle, sentiment: e.sentiment }))
    .sort((a, b) => b.headlines - a.headlines);
}

/** Live BUY guard: is there fresh (≤3d), material negative news for this symbol? */
export async function hasFreshNegativeNews(symbol: string): Promise<boolean> {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const rows = await db.select({ id: agentNews.id }).from(agentNews)
    .where(and(eq(agentNews.sentiment, 'NEGATIVE'), gte(agentNews.publishedAt, since), sql`${agentNews.relevance} >= 0.6`, sql`${agentNews.symbols} @> ${JSON.stringify([symbol])}::jsonb`))
    .limit(1);
  return rows.length > 0;
}
