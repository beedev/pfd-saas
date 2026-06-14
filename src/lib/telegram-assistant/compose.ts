/**
 * Grounded answer composer (RAG-style inference over an API result).
 *
 * The deterministic capability fetches the real data; this pass hands the LLM
 * the user's question + that data + today's date, and asks it to answer using
 * ONLY what's in the data. The numbers/names/dates all come from the API, so the
 * model selects/filters/phrases but cannot invent values. This is what makes
 * open-ended reads ("premium due this month", "cheapest term plan", "how many
 * ULIPs") work without coding a capability per question.
 *
 * Returns null when no OpenAI key or on any error — the caller falls back to the
 * deterministic rendering (which is also what we pass in as grounding).
 */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Generic fallback renderer (no OpenAI key) — walks a raw read object and prints
 * it readably. `*Rupees` fields are shown as ₹ with Indian grouping; arrays
 * become bullet lists. One renderer for every read, no per-domain formatting.
 */
export function renderRaw(data: unknown): string {
  if (data == null || typeof data !== 'object') return String(data ?? 'No data.');
  const o = data as Record<string, unknown>;
  const fmtVal = (k: string, v: unknown): string => {
    if (typeof v === 'number' && /rupees$/i.test(k)) return '₹' + Math.round(v).toLocaleString('en-IN');
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v);
  };
  const scalarLine = (obj: Record<string, unknown>) =>
    Object.entries(obj)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .map(([k, v]) => `${k}: ${fmtVal(k, v)}`)
      .join(', ');
  const parts: string[] = [];
  if (typeof o.title === 'string') parts.push(`*${o.title}*`);
  const scalars = scalarLine(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'title')));
  if (scalars) parts.push(scalars);
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v) && v.length) {
      parts.push(`${k}:`);
      for (const item of v.slice(0, 40)) {
        parts.push('• ' + (item && typeof item === 'object' ? scalarLine(item as Record<string, unknown>) : String(item)));
      }
    }
  }
  return parts.filter(Boolean).join('\n') || 'No data.';
}

const SYSTEM = (todayISO: string) => {
  const [y, m] = todayISO.split('-');
  return (
    `You are Artha, a personal-finance assistant replying on Telegram.\n` +
    `Answer the user's question using ONLY the DATA provided below it.\n` +
    `NEVER state an amount, name, policy/account number, or date that is not present in the DATA — never estimate or invent.\n` +
    `Money fields are WHOLE RUPEES (names end in "Rupees"). Never change a value — only format it. Show every amount as ₹ in the INDIAN numbering system (lakh/crore grouping): ₹9,99,11,514 (NOT ₹99,911,514), ₹59,77,697 (NOT ₹5,977,697), ₹4,32,000, ₹6,156. Drop the "Rupees" suffix in your reply.\n\n` +
    `Today's date is ${todayISO} (year ${y}, month ${m}). Resolve relative time against it.\n` +
    `FILTER PRECISELY — this is critical:\n` +
    `• "this month" / "due this month" = ONLY items whose date is in year ${y} AND month ${m} (i.e. starts with "${y}-${m}"). A ${y}-${String(Number(m) - 1).padStart(2, '0')} or any other month is NOT this month — exclude it.\n` +
    `• "overdue" = date strictly before ${todayISO}. "next month", "this year", "before <date>" = match the exact range.\n` +
    `• "cheapest"/"highest"/"how many"/"total" = compute over the matching rows only; show your basis.\n` +
    `Include an item ONLY if it strictly satisfies the filter. When in doubt, exclude it and say what you used.\n\n` +
    `Be concise and mobile-friendly: a short sentence, then "• " bullets only if listing. Use *bold* sparingly. Avoid underscores in plain text. If nothing in the DATA matches the filter, say so plainly (don't substitute near-misses).`
  );
};

export async function composeAnswer(opts: {
  userMessage: string;
  summary: string;
  grounding: string;
  todayISO: string;
}): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4.1',
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM(opts.todayISO) },
          { role: 'user', content: `Question: ${opts.userMessage}\n\nDATA (${opts.summary}):\n${opts.grounding}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}
