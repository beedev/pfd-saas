/**
 * Telegram assistant — worker (Phases 0.5–3).
 *
 * Drains telegram_inbox in update_id order. Per message: rate-limit + authz
 * (chat_id → user) → resolve a pending slot/confirm → else route (free-text via
 * LLM over the user's effective capabilities; `/cmd` via the registry) →
 * dispatch (missing required param ⇒ ask & slot-fill; write ⇒ confirm; read ⇒
 * invoke + format). Every step is audit-logged. dataIntegrity=true writes dedupe
 * by the original message_id; Settings → Assistant APIs governs reachability.
 */
import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  telegramInbox,
  telegramConversations,
  telegramCommandLog,
  userPreferences,
} from '@/db';
import { enqueueOutbox } from './send';
import { parseSlash } from './slash';
import { assertRegistryIntegrity, type CapParam } from './registry';
import { getEffectiveCapabilities, findEffectiveById, type EffectiveCapability } from './effective';
import { formatResult } from './format';
import { routeWithLLM } from './llm';

const PENDING_TTL_MS = 10 * 60 * 1000;

// Per-chat rate limit (Phase 3.1): in-memory sliding window. One always-on
// process owns the bot, so an in-memory window is sufficient + cheap.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;
const rateHits = new Map<string, number[]>();
function rateLimited(chatId: string): boolean {
  const now = Date.now();
  const arr = (rateHits.get(chatId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  rateHits.set(chatId, arr);
  return arr.length > RATE_MAX;
}

const VERBOSE_RE = /\b(detail|details|full|expand|breakdown|everything)\b/i;

/** Persist pending state + ask. `awaiting` is 'confirm' or 'slot'. */
async function setPending(
  chatId: string,
  capabilityId: string,
  args: Record<string, unknown>,
  awaiting: 'confirm' | 'slot',
  sourceMessageId: number | null,
): Promise<void> {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db
    .insert(telegramConversations)
    .values({ chatId, pendingCapability: capabilityId, collectedArgs: args as never, awaiting, sourceMessageId, expiresAt })
    .onConflictDoUpdate({
      target: telegramConversations.chatId,
      set: { pendingCapability: capabilityId, collectedArgs: args as never, awaiting, sourceMessageId, expiresAt, updatedAt: new Date() },
    });
}

async function askConfirm(chatId: string, cap: EffectiveCapability, args: Record<string, unknown>, sourceMessageId: number | null): Promise<void> {
  const preview =
    `*Confirm:* ${cap.summary}\n` +
    Object.entries(args).map(([k, v]) => `• ${k}: ${v}`).join('\n') +
    `\n\nReply *yes* to confirm, anything else cancels.`;
  await setPending(chatId, cap.id, args, 'confirm', sourceMessageId);
  await enqueueOutbox(chatId, preview, { kind: 'confirm' });
}

async function askSlot(chatId: string, cap: EffectiveCapability, args: Record<string, unknown>, param: CapParam, sourceMessageId: number | null): Promise<void> {
  await setPending(chatId, cap.id, args, 'slot', sourceMessageId);
  await enqueueOutbox(chatId, `${cap.summary}\nWhat's the *${param.name}*? (${param.description})\n_Reply with the value, or "cancel"._`, { kind: 'notice' });
}

/** The message matched >1 capability — ask the user to pick one (Phase 2.2/your
 *  disambiguation spec). Candidates are stashed in collectedArgs for the reply. */
async function askChoice(
  chatId: string,
  caps: EffectiveCapability[],
  candidates: Array<{ capabilityId: string; args: Record<string, unknown> }>,
  sourceMessageId: number | null,
): Promise<void> {
  const lines = candidates.map((c, i) => {
    const cap = findEffectiveById(caps, c.capabilityId);
    return `${i + 1}) ${cap?.summary ?? c.capabilityId}`;
  });
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db
    .insert(telegramConversations)
    .values({ chatId, pendingCapability: null, collectedArgs: { candidates } as never, awaiting: 'choice', sourceMessageId, expiresAt })
    .onConflictDoUpdate({
      target: telegramConversations.chatId,
      set: { pendingCapability: null, collectedArgs: { candidates } as never, awaiting: 'choice', sourceMessageId, expiresAt, updatedAt: new Date() },
    });
  await enqueueOutbox(chatId, `Did you mean:\n${lines.join('\n')}\n\n_Reply with the number, or "cancel"._`, { kind: 'notice' });
}

interface LogInput {
  userId?: string | null;
  chatId: string;
  messageId?: number | null;
  rawText?: string | null;
  route?: string;
  capabilityId?: string | null;
  args?: unknown;
  confirmed?: boolean;
  executed?: boolean;
  resultStatus: string;
  resultSummary?: string;
}
async function logCmd(v: LogInput): Promise<void> {
  await db.insert(telegramCommandLog).values({
    userId: v.userId ?? null,
    chatId: v.chatId,
    messageId: v.messageId ?? null,
    rawText: v.rawText ?? null,
    route: v.route ?? null,
    capabilityId: v.capabilityId ?? null,
    args: (v.args ?? null) as never,
    confirmed: v.confirmed ?? false,
    executed: v.executed ?? false,
    resultStatus: v.resultStatus,
    resultSummary: v.resultSummary ?? null,
  });
}

function helpText(included: EffectiveCapability[]): string {
  const lines = included
    .filter((c) => c.slashCommand)
    .map((c) => {
      const p = c.params.map((x) => `<${x.name}>`).join(' ');
      return `${c.slashCommand} ${p} — ${c.summary}`;
    });
  const body = lines.length ? lines.join('\n') : '(no commands enabled — turn some on in Settings → Assistant APIs)';
  return `*Artha assistant*\n${body}\n\n_Or just ask in plain language._`;
}

export async function processInbox(limit = 10): Promise<{ processed: number }> {
  assertRegistryIntegrity(); // Phase 1.2 — fail loudly on registry drift.
  const rows = await db
    .select()
    .from(telegramInbox)
    .where(eq(telegramInbox.status, 'pending'))
    .orderBy(asc(telegramInbox.updateId))
    .limit(limit);

  let processed = 0;
  for (const row of rows) {
    await db.update(telegramInbox).set({ status: 'processing' }).where(eq(telegramInbox.id, row.id));
    try {
      await handle(row);
      await db
        .update(telegramInbox)
        .set({ status: 'done', processedAt: new Date() })
        .where(eq(telegramInbox.id, row.id));
    } catch (err) {
      console.error('[telegram/worker]', err);
      await enqueueOutbox(
        row.chatId,
        `⚠️ ${err instanceof Error ? err.message : 'Something went wrong.'}\nYou can try again, or use a slash command — /help.`,
        { kind: 'notice' },
      ).catch(() => {});
      await db
        .update(telegramInbox)
        .set({ status: 'error', error: String(err), processedAt: new Date() })
        .where(eq(telegramInbox.id, row.id));
    }
    processed++;
  }
  return { processed };
}

async function handle(row: typeof telegramInbox.$inferSelect): Promise<void> {
  const chatId = row.chatId;
  const text = (row.text ?? '').trim();

  // 1. authz — chat_id → paired user
  const prefs = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(eq(userPreferences.telegramChatId, chatId))
    .limit(1);
  const userId = prefs[0]?.userId;
  if (!userId) {
    await enqueueOutbox(
      chatId,
      '🔒 This chat isn’t linked to an Artha account. Pair it in Settings → Telegram, then try again.',
      { kind: 'notice' },
    );
    await logCmd({ chatId, messageId: row.messageId, rawText: text, resultStatus: 'rejected', resultSummary: 'not-authorized' });
    return;
  }

  // 2. rate limit (Phase 3.1)
  if (rateLimited(chatId)) {
    await enqueueOutbox(chatId, '⏳ That’s a lot of messages — give me a minute, then try again.', { kind: 'notice' });
    await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, resultStatus: 'rate-limited' });
    return;
  }

  // Per-user effective registry (Settings → Assistant APIs).
  const caps = await getEffectiveCapabilities(userId);
  const included = caps.filter((c) => c.included);
  const verbose = VERBOSE_RE.test(text);

  // 3. resolve a pending slot / confirm
  const pend = await db.select().from(telegramConversations).where(eq(telegramConversations.chatId, chatId)).limit(1);
  const pending = pend[0];
  const live = pending?.expiresAt && pending.expiresAt > new Date();

  if (live && pending?.awaiting === 'slot') {
    await db.delete(telegramConversations).where(eq(telegramConversations.chatId, chatId));
    const cap = pending.pendingCapability ? findEffectiveById(caps, pending.pendingCapability) : undefined;
    if (!cap || !cap.included) {
      await enqueueOutbox(chatId, 'That request expired. Try again.', { kind: 'notice' });
      return;
    }
    if (/^(cancel|stop|nvm|never\s?mind)$/i.test(text)) {
      await enqueueOutbox(chatId, 'Cancelled.');
      await logCmd({ userId, chatId, messageId: pending.sourceMessageId, rawText: text, route: 'slot', capabilityId: cap.id, resultStatus: 'cancelled' });
      return;
    }
    // fill the first still-missing required param with this reply
    const args = { ...((pending.collectedArgs ?? {}) as Record<string, unknown>) };
    const firstMissing = cap.params.find((p) => p.required && (args[p.name] == null || args[p.name] === ''));
    if (firstMissing) args[firstMissing.name] = text;
    await dispatch(userId, chatId, cap, args, { route: 'slot', sourceMessageId: pending.sourceMessageId ?? null, rawText: text, verbose });
    return;
  }

  if (live && pending?.awaiting === 'choice') {
    await db.delete(telegramConversations).where(eq(telegramConversations.chatId, chatId));
    if (/^(cancel|stop|nvm|never\s?mind)$/i.test(text)) {
      await enqueueOutbox(chatId, 'Cancelled.');
      return;
    }
    const candidates = ((pending.collectedArgs ?? {}) as { candidates?: Array<{ capabilityId: string; args: Record<string, unknown> }> }).candidates ?? [];
    const n = parseInt(text.trim(), 10);
    const chosen = Number.isFinite(n) && n >= 1 && n <= candidates.length ? candidates[n - 1] : undefined;
    const cap = chosen ? findEffectiveById(caps, chosen.capabilityId) : undefined;
    if (!chosen || !cap || !cap.included) {
      await enqueueOutbox(chatId, 'I didn’t get that choice — ask again.', { kind: 'notice' });
      await logCmd({ userId, chatId, messageId: pending.sourceMessageId, rawText: text, route: 'choice', resultStatus: 'no-match' });
      return;
    }
    await dispatch(userId, chatId, cap, chosen.args, { route: 'choice', sourceMessageId: pending.sourceMessageId ?? null, rawText: text, verbose });
    return;
  }

  if (live && pending?.awaiting === 'confirm') {
    await db.delete(telegramConversations).where(eq(telegramConversations.chatId, chatId));
    const cap = pending.pendingCapability ? findEffectiveById(caps, pending.pendingCapability) : undefined;
    if (!/^(yes|y|confirm|ok)$/i.test(text) || !cap) {
      await enqueueOutbox(chatId, 'Cancelled.');
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'confirm', capabilityId: pending.pendingCapability, confirmed: false, resultStatus: 'cancelled' });
      return;
    }
    if (cap.integrity && pending.sourceMessageId) {
      const dup = await db
        .select({ id: telegramCommandLog.id })
        .from(telegramCommandLog)
        .where(and(eq(telegramCommandLog.messageId, pending.sourceMessageId), eq(telegramCommandLog.capabilityId, cap.id), eq(telegramCommandLog.executed, true)))
        .limit(1);
      if (dup.length) {
        await enqueueOutbox(chatId, 'ℹ️ Already done.');
        return;
      }
    }
    await runAndReply(userId, chatId, cap, (pending.collectedArgs ?? {}) as Record<string, unknown>, {
      messageId: pending.sourceMessageId, rawText: text, route: 'confirm', confirmed: true, verbose,
    });
    return;
  }

  // 4. help / start
  if (text === '/start' || text === '/help') {
    await enqueueOutbox(chatId, helpText(included), { kind: 'notice' });
    return;
  }

  // 5. free text → LLM route. Only included + dataIntegrity=false are reachable.
  if (!text.startsWith('/')) {
    const eligible = included.filter((c) => !c.integrity);
    const route = await routeWithLLM(text, eligible);
    if (route.candidates && route.candidates.length > 1) {
      await askChoice(chatId, included, route.candidates, row.messageId ?? null);
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', resultStatus: 'ambiguous', resultSummary: route.candidates.map((c) => c.capabilityId).join(',') });
      return;
    }
    if (!route.capabilityId) {
      await enqueueOutbox(chatId, route.clarify || ('I didn’t catch a request.\n' + helpText(included)), { kind: 'notice' });
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', resultStatus: 'no-match' });
      return;
    }
    const cap = findEffectiveById(caps, route.capabilityId);
    if (!cap || !cap.included || cap.integrity) {
      await enqueueOutbox(chatId, 'That action needs a slash command for safety. Try /help.', { kind: 'notice' });
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', capabilityId: route.capabilityId, resultStatus: 'blocked-integrity' });
      return;
    }
    await dispatch(userId, chatId, cap, route.args, { route: 'llm', sourceMessageId: row.messageId ?? null, rawText: text, verbose });
    return;
  }

  // 6. slash route
  const parsed = parseSlash(text, included);
  if (!parsed) {
    await enqueueOutbox(chatId, 'Unknown command.\n' + helpText(included), { kind: 'notice' });
    return;
  }
  await dispatch(userId, chatId, parsed.capability, parsed.args, { route: 'slash', sourceMessageId: row.messageId ?? null, rawText: text, verbose });
}

interface DispatchOpts {
  route: string;
  sourceMessageId: number | null;
  rawText: string;
  verbose: boolean;
}

/** Shared tail for every route (slash / llm / slot-completion): missing required
 *  param ⇒ ask & slot-fill; write ⇒ confirm; read ⇒ invoke now. */
async function dispatch(
  userId: string,
  chatId: string,
  cap: EffectiveCapability,
  args: Record<string, unknown>,
  opts: DispatchOpts,
): Promise<void> {
  const missing = cap.params.find((p) => p.required && (args[p.name] == null || args[p.name] === ''));
  if (missing) {
    await askSlot(chatId, cap, args, missing, opts.sourceMessageId);
    await logCmd({ userId, chatId, messageId: opts.sourceMessageId, rawText: opts.rawText, route: opts.route, capabilityId: cap.id, args, resultStatus: 'awaiting-slot' });
    return;
  }
  if (cap.kind === 'write') {
    await askConfirm(chatId, cap, args, opts.sourceMessageId);
    await logCmd({ userId, chatId, messageId: opts.sourceMessageId, rawText: opts.rawText, route: opts.route, capabilityId: cap.id, args, resultStatus: 'awaiting-confirm' });
    return;
  }
  await runAndReply(userId, chatId, cap, args, { messageId: opts.sourceMessageId, rawText: opts.rawText, route: opts.route, echo: opts.route === 'llm', verbose: opts.verbose });
}

/** Invoke a capability, reply with the formatted result, and audit-log success
 *  OR failure. Re-throws so the inbox row records the error + the ⚠️ notice fires. */
async function runAndReply(
  userId: string,
  chatId: string,
  cap: EffectiveCapability,
  args: Record<string, unknown>,
  meta: { messageId: number | null; rawText: string; route: string; confirmed?: boolean; echo?: boolean; verbose?: boolean },
): Promise<void> {
  try {
    const result = await cap.invoke(userId, args);
    let body = formatResult(cap.id, result, { verbose: meta.verbose });
    if (meta.echo) body = `🔎 _${cap.summary}_\n\n${body}`; // 2.3 echo: what was understood
    await enqueueOutbox(chatId, body);
    await logCmd({ userId, chatId, messageId: meta.messageId, rawText: meta.rawText, route: meta.route, capabilityId: cap.id, args, confirmed: meta.confirmed ?? false, executed: true, resultStatus: 'ok' });
  } catch (err) {
    await logCmd({ userId, chatId, messageId: meta.messageId, rawText: meta.rawText, route: meta.route, capabilityId: cap.id, args, confirmed: meta.confirmed ?? false, executed: false, resultStatus: 'error', resultSummary: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
