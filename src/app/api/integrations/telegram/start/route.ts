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

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim();
  if (!botUsername) {
    return NextResponse.json(
      {
        error:
          'TELEGRAM_BOT_USERNAME not configured. Set it in .env.local to the bot username (no @).',
      },
      { status: 500 },
    );
  }

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
    return NextResponse.json({ deepLink, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error('[telegram/start]', err);
    return NextResponse.json({ error: 'Failed to initialise pairing' }, { status: 500 });
  }
}
