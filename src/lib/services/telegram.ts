/**
 * Telegram Bot API helper — per-user routing.
 *
 * Architecture: ONE bot token (env: TELEGRAM_BOT_TOKEN), MANY users.
 * Each user pairs their Telegram account with pfd-saas once via the
 * `/api/integrations/telegram/{start,webhook}` flow, which stores
 * their chat_id on user_preferences.telegram_chat_id. All cron sends
 * (daily digest, alerts) route through this module with the userId.
 *
 * Stub mode: if TELEGRAM_BOT_TOKEN is not set, we still resolve to
 * `{ ok: true }` after appending the payload to tmp/telegram-out.log
 * (tagged with userId). This keeps callers' dedup/cooldown logic
 * working in dev and self-host setups that haven't configured a bot.
 *
 * No chat_id (user hasn't paired) → `{ ok: false, reason: 'no-chat-id' }`.
 * Callers should treat this as "skip silently", NOT retry.
 */

import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, userPreferences } from '@/db';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';

const STUB_LOG = path.join(process.cwd(), 'tmp', 'telegram-out.log');

function writeStub(userId: string, text: string): void {
  const ts = new Date().toISOString();
  const banner = '─'.repeat(72);
  console.log(`\n${banner}`);
  console.log(`📨  TELEGRAM (stub — no bot token set) → user ${userId}`);
  console.log(`    ${text.split('\n').join('\n    ')}`);
  console.log(`${banner}\n`);
  try {
    fs.mkdirSync(path.dirname(STUB_LOG), { recursive: true });
    fs.appendFileSync(STUB_LOG, JSON.stringify({ ts, userId, text }) + '\n');
  } catch (err) {
    console.error('[telegram-stub] could not write telegram-out.log:', err);
  }
}

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; reason: 'no-token' | 'no-chat-id' | 'api-error'; detail?: string };

/**
 * Send a Markdown-formatted Telegram message to a specific user.
 *
 * Resolution order:
 *  1. No BOT_TOKEN env → write stub, return ok:true (dev/self-host
 *     without telegram configured).
 *  2. Look up user's telegram_chat_id. Missing → ok:false,
 *     reason:'no-chat-id' (user hasn't paired; caller should skip).
 *  3. Real send via Telegram Bot API. On HTTP / API error →
 *     ok:false, reason:'api-error'.
 */
export async function sendTelegramToUser(
  userId: string,
  text: string,
): Promise<TelegramSendResult> {
  if (!BOT_TOKEN) {
    writeStub(userId, text);
    return { ok: true };
  }

  let chatId: string | null = null;
  try {
    const rows = await db
      .select({ chatId: userPreferences.telegramChatId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    chatId = rows[0]?.chatId ?? null;
  } catch (err) {
    console.error('[telegram] failed to read user_preferences:', err);
    return { ok: false, reason: 'api-error', detail: 'db-read-failed' };
  }

  if (!chatId) {
    return { ok: false, reason: 'no-chat-id' };
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    const result = (await res.json()) as { ok: boolean; description?: string };
    if (!result.ok) {
      console.error('[telegram] API error for user', userId, ':', result.description);
      return { ok: false, reason: 'api-error', detail: result.description };
    }
    return { ok: true };
  } catch (err) {
    console.error('[telegram] fetch failed:', err);
    return { ok: false, reason: 'api-error', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Low-level helper: send a message to a raw chat_id, bypassing the
 * user_preferences lookup. Used by the webhook handler to reply to
 * the user immediately on /start (we have the chat_id from the
 * Telegram update before we write it to the DB).
 *
 * No-ops with a console warning if BOT_TOKEN is unset.
 */
export async function sendTelegramToChatId(
  chatId: string | number,
  text: string,
): Promise<TelegramSendResult> {
  if (!BOT_TOKEN) {
    console.warn('[telegram] sendTelegramToChatId: no BOT_TOKEN, dropping message');
    return { ok: false, reason: 'no-token' };
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    const result = (await res.json()) as { ok: boolean; description?: string };
    if (!result.ok) {
      console.error('[telegram] API error for chat', chatId, ':', result.description);
      return { ok: false, reason: 'api-error', detail: result.description };
    }
    return { ok: true };
  } catch (err) {
    console.error('[telegram] fetch failed:', err);
    return { ok: false, reason: 'api-error', detail: err instanceof Error ? err.message : String(err) };
  }
}
