/**
 * Telegram assistant — outbound sender (Phase 0.4).
 *
 * Drains `telegram_outbox`: sends each pending row via the bot and marks it
 * sent. A failure leaves the row pending (no `sentAt`) so it's retried on the
 * next tick — replies/confirms survive a crash between deciding and sending.
 */
import { asc, eq } from 'drizzle-orm';
import { db, telegramOutbox } from '@/db';
import { sendTelegramToChatId } from '@/lib/services/telegram';

export async function drainOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const pending = await db
    .select()
    .from(telegramOutbox)
    .where(eq(telegramOutbox.status, 'pending'))
    .orderBy(asc(telegramOutbox.id))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    const res = await sendTelegramToChatId(row.chatId, row.text, row.replyMarkup ?? undefined);
    if (res.ok) {
      await db
        .update(telegramOutbox)
        .set({ status: 'sent', sentAt: new Date(), error: null })
        .where(eq(telegramOutbox.id, row.id));
      sent++;
    } else {
      await db
        .update(telegramOutbox)
        .set({ error: res.reason })
        .where(eq(telegramOutbox.id, row.id));
      failed++;
    }
  }
  return { sent, failed };
}

/** Enqueue an outbound message (reply / confirm / notice). */
export async function enqueueOutbox(
  chatId: string,
  text: string,
  opts?: { kind?: 'reply' | 'confirm' | 'notice'; replyMarkup?: unknown },
): Promise<void> {
  await db.insert(telegramOutbox).values({
    chatId,
    text,
    kind: opts?.kind ?? 'reply',
    replyMarkup: (opts?.replyMarkup ?? null) as never,
  });
}
