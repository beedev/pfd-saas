/**
 * Grounded advisory composer for the analyst agent's daily digest.
 *
 * Mirrors telegram-assistant/compose.ts: we hand the LLM ONLY the computed
 * numbers (portfolio value, today's paper trades, top signals) and ask it to
 * write a short advisory using strictly those figures — never inventing values.
 * Returns null with no OpenAI key / on error; buildDeterministicDigest() is the
 * always-available fallback so the daily run always has a digest. Paisa in,
 * formatted ₹ out. This is PAPER TRADING — not financial advice.
 */

import { recordLlmUsage, MODEL_FOR, type OpenAiUsage } from './usage';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export interface DigestDecision {
  action: string;
  assetClass: string;
  symbol: string;
  name: string;
  quantity: number;
  amountPaisa: number;
  score: number;
  recommendation: string;
}

export interface DigestInput {
  portfolioName: string;
  startingCapitalPaisa: number;
  cashPaisa: number;
  equityPaisa: number;
  benchmarkSymbol: string;
  benchmarkReturnPct: number | null;
  portfolioReturnPct: number;
  decisions: DigestDecision[];
  todayISO: string;
}

const inr = (paisa: number) => '₹' + Math.round(paisa / 100).toLocaleString('en-IN');
const pct = (n: number | null) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);

/** Build the grounding block of exact numbers the LLM must not deviate from. */
function grounding(d: DigestInput): string {
  const lines: string[] = [];
  lines.push(`Portfolio: ${d.portfolioName}`);
  lines.push(`Equity value: ${inr(d.equityPaisa)} (started ${inr(d.startingCapitalPaisa)}, return ${pct(d.portfolioReturnPct)})`);
  lines.push(`Cash: ${inr(d.cashPaisa)}`);
  lines.push(`Benchmark ${d.benchmarkSymbol} return since start: ${pct(d.benchmarkReturnPct)}`);
  const trades = d.decisions.filter((x) => x.action === 'BUY' || x.action === 'SELL');
  if (trades.length) {
    lines.push(`Trades executed today:`);
    for (const t of trades) {
      lines.push(`• ${t.action} ${t.quantity} ${t.name} (${t.symbol || t.assetClass}) for ${inr(t.amountPaisa)} [score ${t.score}]`);
    }
  } else {
    lines.push(`Trades executed today: none (all HOLD/WATCH).`);
  }
  const watch = d.decisions.filter((x) => x.action === 'WATCH').slice(0, 5);
  if (watch.length) {
    lines.push(`Watching:`);
    for (const w of watch) lines.push(`• ${w.name} (${w.symbol || w.assetClass}) score ${w.score} → ${w.recommendation}`);
  }
  return lines.join('\n');
}

const SYSTEM =
  `You are Artha, an analyst agent reporting on a PAPER-TRADING (virtual money) portfolio.\n` +
  `Write a short daily briefing using ONLY the DATA provided. NEVER state a number, name, or % not present in the DATA — never estimate or invent.\n` +
  `Keep amounts exactly as given (Indian ₹ grouping). Be concise and mobile-friendly: 2-4 short sentences, then "• " bullets for the trades. Use *bold* sparingly.\n` +
  `End with a one-line reminder: "Paper trading — not financial advice."`;

export async function composeAdvisory(input: DigestInput): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL_FOR.advisory,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Date: ${input.todayISO}\n\nDATA:\n${grounding(input)}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: OpenAiUsage };
    await recordLlmUsage('advisory', MODEL_FOR.advisory, j.usage);
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

/** Deterministic digest — always available, used when the LLM is unavailable. */
export function buildDeterministicDigest(d: DigestInput): string {
  const parts: string[] = [];
  parts.push(`*${d.portfolioName}* — ${d.todayISO}`);
  parts.push(
    `Equity ${inr(d.equityPaisa)} (${pct(d.portfolioReturnPct)}) vs ${d.benchmarkSymbol} ${pct(d.benchmarkReturnPct)}. Cash ${inr(d.cashPaisa)}.`,
  );
  const trades = d.decisions.filter((x) => x.action === 'BUY' || x.action === 'SELL');
  if (trades.length) {
    parts.push(`Trades today:`);
    for (const t of trades) parts.push(`• ${t.action} ${t.quantity} ${t.name} — ${inr(t.amountPaisa)}`);
  } else {
    parts.push(`No trades today (all HOLD/WATCH).`);
  }
  parts.push(`_Paper trading — not financial advice._`);
  return parts.join('\n');
}
