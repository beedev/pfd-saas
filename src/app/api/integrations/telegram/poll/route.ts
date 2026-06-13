/**
 * POST /api/integrations/telegram/poll
 *
 * Poll-based Telegram pairing for self-host / localhost deployments, where
 * Telegram can't reach an inbound webhook. Driven by the Settings connection
 * form every few seconds while a pairing is in progress.
 *
 * In `TELEGRAM_CONNECT_MODE=getupdates`:
 *   1. Call Telegram getUpdates (outbound long-poll) from the last offset.
 *   2. For each `/start <code>` message, match <code> against any user's
 *      unexpired telegram_connect_token, write that user's telegram_chat_id +
 *      username, clear the token, and reply "Connected" to the chat.
 *   3. Multi-user safe: each pending user has a distinct code, matched to the
 *      sender's chat_id — a brand-new Telegram account pairing to any account
 *      just works.
 *
 * In `webhook` mode this endpoint performs no polling and simply reports the
 * session user's current connection state (the webhook does the writing).
 *
 * Always returns the CURRENT session user's state: { connected, username }.
 */

import { NextResponse } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { db, userPreferences } from '@/db';
import { auth } from '@/auth';
import { fetchTelegramUpdates, sendTelegramToChatId } from '@/lib/services/telegram';

const START_RE = /^\/start\s+([A-Za-z0-9-]+)\s*$/;

// Single-process state: the getUpdates offset (so updates aren't reprocessed)
// and an in-flight guard (Telegram 409s on concurrent getUpdates calls).
let lastUpdateId = 0;
let inFlight = false;

async function drainAndPair(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const updates = await fetchTelegramUpdates(lastUpdateId);
    for (const u of updates) {
      if (u.update_id >= lastUpdateId) lastUpdateId = u.update_id + 1;
      const chatId = u.message?.chat?.id;
      const match = (u.message?.text ?? '').match(START_RE);
      if (!chatId || !match) continue;

      const code = match[1];
      const rows = await db
        .select({ userId: userPreferences.userId })
        .from(userPreferences)
        .where(
          and(
            eq(userPreferences.telegramConnectToken, code),
            gt(userPreferences.telegramConnectTokenExpiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!rows.length) continue;

      await db
        .update(userPreferences)
        .set({
          telegramChatId: String(chatId),
          telegramUsername: u.message?.from?.username ?? null,
          telegramConnectToken: null,
          telegramConnectTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.userId, rows[0].userId));

      await sendTelegramToChatId(
        chatId,
        '✅ *Connected to Artha.*\n\nYou will now receive your daily digest and alerts here. To disconnect, open Settings → Telegram in the web app.',
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[telegram/poll]', err);
  } finally {
    inFlight = false;
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const mode = (process.env.TELEGRAM_CONNECT_MODE ?? 'webhook').toLowerCase();
  if (mode === 'getupdates') {
    await drainAndPair();
  }

  const me = await db
    .select({
      chatId: userPreferences.telegramChatId,
      username: userPreferences.telegramUsername,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  const chatId = me[0]?.chatId ?? null;
  return NextResponse.json({ connected: Boolean(chatId), username: me[0]?.username ?? null });
}
