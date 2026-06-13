/**
 * POST /api/integrations/telegram/start
 *
 * Initiates the per-user Telegram pairing flow.
 *
 *   1. Generate a UUIDv4 pairing token, stamp it on the user's
 *      user_preferences row with a 10-minute expiry.
 *   2. Return the Telegram deep link:
 *        https://t.me/<bot-username>?start=<token>
 *      where bot-username comes from process.env.TELEGRAM_BOT_USERNAME
 *      (no leading @).
 *
 * The UI opens this link in a new tab. The user presses /start in
 * Telegram; the bot posts an update to /api/integrations/telegram/webhook
 * which matches the token, writes telegram_chat_id, clears the token.
 *
 * The UI polls GET /api/user-preferences every few seconds until the
 * chat_id appears.
 *
 * Failure modes:
 *   - 401 if no session
 *   - 500 if TELEGRAM_BOT_USERNAME isn't configured (clear error,
 *     not a silent broken deep link)
 *   - 404 if the user has no user_preferences row yet (they haven't
 *     completed onboarding)
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, userPreferences } from '@/db';
import { auth } from '@/auth';
import { getBotUsername, deleteTelegramWebhook } from '@/lib/services/telegram';

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  // Self-host/localhost can't receive webhooks → 'getupdates' mode pairs by
  // polling the bot's inbound messages instead. Default 'webhook' keeps the
  // public SaaS flow unchanged.
  const mode = (process.env.TELEGRAM_CONNECT_MODE ?? 'webhook').toLowerCase();

  // Prefer the explicit env username; otherwise resolve it from the token via
  // getMe (so a self-host only needs TELEGRAM_BOT_TOKEN).
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || (await getBotUsername()) || '';
  if (!botUsername) {
    return NextResponse.json(
      {
        error:
          'Telegram bot not configured. Set TELEGRAM_BOT_TOKEN (and optionally TELEGRAM_BOT_USERNAME).',
      },
      { status: 500 },
    );
  }

  // getUpdates and webhook are mutually exclusive on a bot — clear any webhook
  // so poll-based pairing can read the inbound /start message.
  if (mode === 'getupdates') await deleteTelegramWebhook();

  try {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    const result = await db
      .update(userPreferences)
      .set({
        telegramConnectToken: token,
        telegramConnectTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userPreferences.userId, session.user.id))
      .returning({ userId: userPreferences.userId });

    if (!result.length) {
      return NextResponse.json(
        { error: 'No user_preferences row found. Complete onboarding first.' },
        { status: 404 },
      );
    }

    const deepLink = `https://t.me/${botUsername}?start=${token}`;
    return NextResponse.json({
      deepLink,
      code: token,
      botUsername,
      mode,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[telegram/start]', err);
    return NextResponse.json({ error: 'Failed to initialise pairing' }, { status: 500 });
  }
}
