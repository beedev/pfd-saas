/**
 * POST /api/integrations/telegram/webhook
 *
 * PUBLIC endpoint — Telegram's servers post here when a user sends a
 * message to the bot. There is no Auth.js session; instead we gate on
 * `X-Telegram-Bot-Api-Secret-Token` matching TELEGRAM_WEBHOOK_SECRET
 * (this header is set when we register the webhook via
 *  scripts/telegram-set-webhook.sh, and Telegram echoes it back on
 *  every update).
 *
 * Behaviour:
 *
 *   - `/start <token>` payload — look up the user with a matching,
 *     unexpired telegram_connect_token. Found → write chat_id +
 *     username, clear the token, reply "Connected".
 *     Token missing / expired → reply with re-pair instructions.
 *
 *   - Any other message — short hint reply. No state change.
 *
 * This route must be in src/proxy.ts PUBLIC_PREFIXES so the edge
 * cookie check doesn't redirect Telegram to /login.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { db, userPreferences } from '@/db';
import { sendTelegramToChatId } from '@/lib/services/telegram';

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number; username?: string; first_name?: string };
    text?: string;
    date?: number;
  };
}

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

// Constant-time string compare — avoids leaking the secret's contents
// through response-timing differences. Length check first because
// timingSafeEqual throws on unequal-length buffers.
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expectedSecret) {
    // Loud, NOT silent — if Telegram is posting here without us having
    // configured the secret, that's a setup bug. Refuse.
    console.error('[telegram/webhook] TELEGRAM_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 401 });
  }

  const receivedSecret = request.headers.get(SECRET_HEADER);
  if (!receivedSecret || !safeCompare(receivedSecret, expectedSecret)) {
    console.warn('[telegram/webhook] secret mismatch (or missing header)');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text ?? '';

  // We only care about chats with an id and a /start <token> message.
  if (!chatId) {
    return NextResponse.json({ ok: true, ignored: 'no chat_id' });
  }

  // Match /start <token> exactly. Telegram sends this on first contact
  // when the user clicks our deep link (https://t.me/bot?start=token).
  const startMatch = text.match(/^\/start\s+([A-Za-z0-9-]+)\s*$/);
  if (startMatch) {
    const token = startMatch[1];
    try {
      const rows = await db
        .select({ userId: userPreferences.userId })
        .from(userPreferences)
        .where(
          and(
            eq(userPreferences.telegramConnectToken, token),
            gt(userPreferences.telegramConnectTokenExpiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!rows.length) {
        await sendTelegramToChatId(
          chatId,
          '⚠️ *Pairing token expired or invalid.*\n\nOpen Settings → Telegram in pfd-saas and click *Connect Telegram* again.',
        );
        return NextResponse.json({ ok: true, paired: false, reason: 'token-not-found' });
      }

      const userId = rows[0].userId;
      const username = msg?.from?.username ?? null;

      await db
        .update(userPreferences)
        .set({
          telegramChatId: String(chatId),
          telegramUsername: username,
          telegramConnectToken: null,
          telegramConnectTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.userId, userId));

      await sendTelegramToChatId(
        chatId,
        '✅ *Connected to pfd-saas.*\n\nYou will now receive your daily digest and alerts here. To disconnect, open Settings → Telegram in pfd-saas.',
      );
      return NextResponse.json({ ok: true, paired: true });
    } catch (err) {
      console.error('[telegram/webhook] pairing failed:', err);
      // Don't surface internal errors to the bot user — but ack to
      // Telegram so it doesn't retry forever.
      await sendTelegramToChatId(
        chatId,
        '⚠️ Something went wrong pairing your account. Please try again from Settings.',
      ).catch(() => {});
      return NextResponse.json({ ok: true, paired: false, reason: 'error' });
    }
  }

  // Any other inbound message — minimal hint.
  if (text === '/start') {
    await sendTelegramToChatId(
      chatId,
      'Hi! To connect this Telegram account to pfd-saas, open Settings → Telegram in the web app and click *Connect Telegram*.',
    );
  }
  // Silently ack everything else — we're not a chatbot, just a one-way
  // notifier. Returning 200 stops Telegram retries.
  return NextResponse.json({ ok: true });
}
