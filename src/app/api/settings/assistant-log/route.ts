/**
 * Assistant activity log (Phase 3.5) — observability over telegram_command_log.
 *
 *   GET ?limit=20 → { entries: [{ id, at, route, capabilityId, resultStatus,
 *                     confirmed, executed, rawText }] } for the current user,
 *                   newest first. Read-only; powers the Settings activity card.
 */
import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, telegramCommandLog } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 20));
  const rows = await db
    .select({
      id: telegramCommandLog.id,
      at: telegramCommandLog.createdAt,
      route: telegramCommandLog.route,
      capabilityId: telegramCommandLog.capabilityId,
      resultStatus: telegramCommandLog.resultStatus,
      confirmed: telegramCommandLog.confirmed,
      executed: telegramCommandLog.executed,
      rawText: telegramCommandLog.rawText,
    })
    .from(telegramCommandLog)
    .where(eq(telegramCommandLog.userId, userId))
    .orderBy(desc(telegramCommandLog.id))
    .limit(limit);

  return NextResponse.json({ entries: rows });
}
