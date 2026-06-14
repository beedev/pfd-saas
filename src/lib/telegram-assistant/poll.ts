/**
 * Telegram assistant — inbound poller (Phase 0.3).
 *
 * getUpdates from the last-seen offset and persist each message into
 * `telegram_inbox` BEFORE the offset effectively advances. We derive the offset
 * from MAX(update_id), so a re-fetch is harmless and the unique index on
 * update_id dedupes — nothing fetched is ever lost or double-inserted.
 *
 * Single-poller assumption: only the always-on instance should call this (one
 * getUpdates consumer per bot). See docs/PLAN-telegram-assistant.md.
 */
import { sql } from 'drizzle-orm';
import { db, telegramInbox } from '@/db';
import { fetchTelegramUpdates } from '@/lib/services/telegram';

export async function pollTelegram(): Promise<{ fetched: number; offset: number }> {
  const rows = await db
    .select({ maxId: sql<number>`COALESCE(MAX(${telegramInbox.updateId}), 0)` })
    .from(telegramInbox);
  const offset = Number(rows[0]?.maxId ?? 0) + 1;

  const updates = await fetchTelegramUpdates(offset);
  let fetched = 0;
  for (const u of updates) {
    const msg = u.message;
    const chatId = msg?.chat?.id;
    if (chatId == null) continue; // non-message updates ignored until Phase 0.6
    await db
      .insert(telegramInbox)
      .values({
        updateId: u.update_id,
        chatId: String(chatId),
        messageId: msg?.message_id ?? null,
        fromUsername: msg?.from?.username ?? null,
        text: msg?.text ?? null,
      })
      .onConflictDoNothing({ target: telegramInbox.updateId });
    fetched++;
  }
  return { fetched, offset };
}
