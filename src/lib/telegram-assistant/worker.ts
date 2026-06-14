/**
 * Telegram assistant — worker (Phase 0.5/0.6/0.7).
 *
 * Drains telegram_inbox in update_id order. Per message: authz (chat_id →
 * user), resolve a pending confirm, else slash-route → required-param check →
 * (write ⇒ confirm; read ⇒ invoke) → format → enqueue reply. Every step is
 * audit-logged. dataIntegrity=true writes dedupe by the original message_id.
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
import { CAPABILITIES, findCapability } from './registry';
import { formatResult } from './format';
import { routeWithLLM } from './llm';

const CONFIRM_TTL_MS = 10 * 60 * 1000;

/** Enqueue a write confirmation + persist pending state (shared by the slash
 *  and LLM paths). */
async function enqueueConfirm(
  chatId: string,
  capabilityId: string,
  args: Record<string, unknown>,
  sourceMessageId: number | null,
): Promise<void> {
  const cap = findCapability(capabilityId);
  const summary = cap?.summary ?? capabilityId;
  const preview =
    `*Confirm:* ${summary}\n` +
    Object.entries(args).map(([k, v]) => `• ${k}: ${v}`).join('\n') +
    `\n\nReply *yes* to confirm, anything else cancels.`;
  const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS);
  await db
    .insert(telegramConversations)
    .values({ chatId, pendingCapability: capabilityId, collectedArgs: args as never, awaiting: 'confirm', sourceMessageId, expiresAt })
    .onConflictDoUpdate({
      target: telegramConversations.chatId,
      set: { pendingCapability: capabilityId, collectedArgs: args as never, awaiting: 'confirm', sourceMessageId, expiresAt, updatedAt: new Date() },
    });
  await enqueueOutbox(chatId, preview, { kind: 'confirm' });
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

function helpText(): string {
  const lines = CAPABILITIES.filter((c) => c.slashCommand).map((c) => {
    const p = c.params.map((x) => `<${x.name}>`).join(' ');
    return `${c.slashCommand} ${p} — ${c.summary}`;
  });
  return `*Artha assistant*\n${lines.join('\n')}`;
}

export async function processInbox(limit = 10): Promise<{ processed: number }> {
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
        `⚠️ ${err instanceof Error ? err.message : 'Something went wrong.'}`,
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

  // 2. resolve a pending confirm
  const pend = await db
    .select()
    .from(telegramConversations)
    .where(eq(telegramConversations.chatId, chatId))
    .limit(1);
  const pending = pend[0];
  if (pending?.awaiting === 'confirm' && pending.expiresAt && pending.expiresAt > new Date()) {
    await db.delete(telegramConversations).where(eq(telegramConversations.chatId, chatId));
    const cap = pending.pendingCapability ? findCapability(pending.pendingCapability) : undefined;
    if (!/^(yes|y|confirm|ok)$/i.test(text) || !cap) {
      await enqueueOutbox(chatId, 'Cancelled.');
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, capabilityId: pending.pendingCapability, confirmed: false, resultStatus: 'cancelled' });
      return;
    }
    if (cap.dataIntegrity && pending.sourceMessageId) {
      const dup = await db
        .select({ id: telegramCommandLog.id })
        .from(telegramCommandLog)
        .where(
          and(
            eq(telegramCommandLog.messageId, pending.sourceMessageId),
            eq(telegramCommandLog.capabilityId, cap.id),
            eq(telegramCommandLog.executed, true),
          ),
        )
        .limit(1);
      if (dup.length) {
        await enqueueOutbox(chatId, 'ℹ️ Already done.');
        return;
      }
    }
    const result = await cap.invoke(userId, (pending.collectedArgs ?? {}) as Record<string, unknown>);
    await enqueueOutbox(chatId, formatResult(cap.id, result));
    await logCmd({ userId, chatId, messageId: pending.sourceMessageId, rawText: text, route: 'slash', capabilityId: cap.id, args: pending.collectedArgs, confirmed: true, executed: true, resultStatus: 'ok' });
    return;
  }

  // 3. help / start
  if (text === '/start' || text === '/help') {
    await enqueueOutbox(chatId, helpText(), { kind: 'notice' });
    return;
  }

  // 4. free text → LLM route (Phase 2). Only dataIntegrity=false capabilities
  //    are LLM-reachable; integrity writes always require a slash command.
  if (!text.startsWith('/')) {
    const route = await routeWithLLM(text);
    if (!route.capabilityId) {
      await enqueueOutbox(chatId, route.clarify || ('I didn’t catch a request.\n' + helpText()), { kind: 'notice' });
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', resultStatus: 'no-match' });
      return;
    }
    const cap = findCapability(route.capabilityId);
    if (!cap || cap.dataIntegrity) {
      await enqueueOutbox(chatId, 'That action needs a slash command for safety. Try /help.', { kind: 'notice' });
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', capabilityId: route.capabilityId, resultStatus: 'blocked-integrity' });
      return;
    }
    const miss = cap.params.filter((p) => p.required && route.args[p.name] == null);
    if (miss.length) {
      await enqueueOutbox(chatId, `I need: ${miss.map((p) => p.name).join(', ')}. For now, try ${cap.slashCommand ?? 'a slash command'}.`, { kind: 'notice' });
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', capabilityId: cap.id, resultStatus: 'missing-params' });
      return;
    }
    if (cap.kind === 'write') {
      await enqueueConfirm(chatId, cap.id, route.args, row.messageId ?? null);
      await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', capabilityId: cap.id, args: route.args, resultStatus: 'awaiting-confirm' });
      return;
    }
    const result = await cap.invoke(userId, route.args);
    await enqueueOutbox(chatId, formatResult(cap.id, result));
    await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'llm', capabilityId: cap.id, args: route.args, executed: true, resultStatus: 'ok' });
    return;
  }
  const parsed = parseSlash(text);
  if (!parsed) {
    await enqueueOutbox(chatId, 'Unknown command.\n' + helpText(), { kind: 'notice' });
    return;
  }
  const { capability, args } = parsed;

  // 5. required params
  const missing = capability.params.filter((p) => p.required && !args[p.name]);
  if (missing.length) {
    await enqueueOutbox(chatId, `Usage: ${capability.slashCommand} <${capability.params.map((p) => p.name).join('> <')}>`, { kind: 'notice' });
    await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'slash', capabilityId: capability.id, resultStatus: 'missing-params' });
    return;
  }

  // 6. write → confirm
  if (capability.kind === 'write') {
    await enqueueConfirm(chatId, capability.id, args, row.messageId ?? null);
    await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'slash', capabilityId: capability.id, args, resultStatus: 'awaiting-confirm' });
    return;
  }

  // 7. read → invoke now
  const result = await capability.invoke(userId, args);
  await enqueueOutbox(chatId, formatResult(capability.id, result));
  await logCmd({ userId, chatId, messageId: row.messageId, rawText: text, route: 'slash', capabilityId: capability.id, args, executed: true, resultStatus: 'ok' });
}
