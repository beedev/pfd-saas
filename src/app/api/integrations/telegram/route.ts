/**
 * DELETE /api/integrations/telegram
 *
 * Disconnects the user's Telegram pairing — clears telegram_chat_id +
 * telegram_username on user_preferences. Subsequent cron sends will
 * skip the user (sendTelegramToUser returns reason:'no-chat-id').
 *
 * The user can pair again via POST /api/integrations/telegram/start.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, userPreferences } from '@/db';
import { auth } from '@/auth';

export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const result = await db
      .update(userPreferences)
      .set({
        telegramChatId: null,
        telegramUsername: null,
        telegramConnectToken: null,
        telegramConnectTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(userPreferences.userId, session.user.id))
      .returning({ userId: userPreferences.userId });

    if (!result.length) {
      return NextResponse.json({ error: 'No user_preferences row found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[telegram DELETE]', err);
    return NextResponse.json({ error: 'Failed to disconnect Telegram' }, { status: 500 });
  }
}
