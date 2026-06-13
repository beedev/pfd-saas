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

/**
 * Resolve the bot token at CALL time (not module load) so a token set or
 * changed at runtime — e.g. pasted in Settings → written to
 * /data/.secrets/telegram_bot_token and applied to process.env — takes
 * effect immediately, without a restart.
 */
function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? '';
}

/** Clear the getMe username cache after a token change. */
export function resetBotUsernameCache(): void {
  cachedBotUsername = null;
}

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
  const BOT_TOKEN = botToken();
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
  const BOT_TOKEN = botToken();
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

// ─── getUpdates pairing (self-host / localhost) ──────────────────────────
// Localhost deployments can't receive webhooks, so pairing reads the bot's
// inbound `/start <code>` messages via getUpdates (outbound long-poll).
// webhook and getUpdates are mutually exclusive on a bot — callers in this
// mode must deleteWebhook first.

let cachedBotUsername: string | null = null;

/** Bot @username via getMe (cached). null when no token / API failure. */
export async function getBotUsername(): Promise<string | null> {
  const BOT_TOKEN = botToken();
  if (!BOT_TOKEN) return null;
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const j = (await res.json()) as { ok: boolean; result?: { username?: string } };
    if (j.ok && j.result?.username) cachedBotUsername = j.result.username;
    return cachedBotUsername;
  } catch (err) {
    console.error('[telegram] getMe failed:', err);
    return null;
  }
}

/** Remove any registered webhook so getUpdates is permitted (idempotent). */
export async function deleteTelegramWebhook(): Promise<void> {
  const BOT_TOKEN = botToken();
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
  } catch (err) {
    console.error('[telegram] deleteWebhook failed:', err);
  }
}

export interface TelegramInboundUpdate {
  update_id: number;
  message?: {
    chat?: { id?: number | string };
    from?: { username?: string | null };
    text?: string;
  };
}

/** Fetch inbound message updates from `offset` (non-blocking, timeout=0). */
export async function fetchTelegramUpdates(offset: number): Promise<TelegramInboundUpdate[]> {
  const BOT_TOKEN = botToken();
  if (!BOT_TOKEN) return [];
  try {
    const url =
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates` +
      `?timeout=0&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`;
    const res = await fetch(url);
    const j = (await res.json()) as {
      ok: boolean;
      result?: TelegramInboundUpdate[];
      description?: string;
    };
    if (!j.ok) {
      console.error('[telegram] getUpdates error:', j.description);
      return [];
    }
    return j.result ?? [];
  } catch (err) {
    console.error('[telegram] getUpdates failed:', err);
    return [];
  }
}
