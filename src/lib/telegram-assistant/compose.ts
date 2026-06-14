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

const SYSTEM = (todayISO: string) => {
  const [y, m] = todayISO.split('-');
  return (
    `You are Artha, a personal-finance assistant replying on Telegram.\n` +
    `Answer the user's question using ONLY the DATA provided below it.\n` +
    `NEVER state an amount, name, policy/account number, or date that is not present in the DATA — never estimate or invent. Copy amounts exactly as written (e.g. ₹78,244).\n\n` +
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
