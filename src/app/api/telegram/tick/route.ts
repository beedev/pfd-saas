/**
 * POST /api/telegram/tick — the assistant heartbeat (Phase 0.3/0.4).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (same as /api/cron/tick). Driven
 * by a tight background loop on the always-on instance. Each tick:
 *   1. polls inbound updates → telegram_inbox
 *   2. (worker — Phase 0.5 — processes inbox)
 *   3. drains telegram_outbox → Telegram
 */
import { NextRequest, NextResponse } from 'next/server';
import { pollTelegram } from '@/lib/telegram-assistant/poll';
import { drainOutbox } from '@/lib/telegram-assistant/send';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export async function POST(req: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const poll = await pollTelegram();
    // Phase 0.5: const worked = await processInbox();
    const out = await drainOutbox();
    return NextResponse.json({ ok: true, poll, out });
  } catch (err) {
    console.error('[telegram/tick]', err);
    return NextResponse.json({ error: 'tick failed' }, { status: 500 });
  }
}
