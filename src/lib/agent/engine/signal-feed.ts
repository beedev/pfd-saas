/**
 * Signal feed — the manual-trading bridge. When a PROMOTED bucket (emitSignals =
 * true) opens a position in the daily run, push an advisory Telegram message with
 * the entry and the exit path, for the user to act on by hand. Paper stays paper;
 * this is just "here's a possibility + how to get out." Fires once per day (the
 * daily run is idempotent), so no duplicate pings.
 */

import { and, eq } from 'drizzle-orm';
import { db, agentPositions, type AgentSleeve, type AgentStrategy } from '@/db';
import { sendTelegramToUser } from '@/lib/services/telegram';

const EXIT_HINT: Partial<Record<AgentStrategy, string>> = {
  RS_ROTATION: 'hold while it stays a top relative-strength name; exit when it drops out of the top ranks or the market turns risk-off',
  TREND: 'exit on the trailing channel break (stop shown)',
  XS_MOMENTUM: 'hold while momentum leads; exit on rank drop',
  WATCHLIST: 'exit at the target/stop shown',
  MEAN_REVERSION: 'exit at the target/stop shown, or on the bounce',
};
const rs = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Emit Telegram signals for positions this sleeve opened today (if it's promoted). */
export async function emitSleeveSignals(userId: string, sleeve: AgentSleeve, runDate: string): Promise<void> {
  if (!sleeve.emitSignals) return;
  const opened = await db.select().from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeve.id), eq(agentPositions.openedDate, runDate)));
  if (!opened.length) return;

  const lines = opened.map((p) => {
    const tgt = p.targetPaisa ? ` · target ${rs(p.targetPaisa)}` : '';
    const stp = p.stopPaisa ? ` · stop ${rs(p.stopPaisa)}` : '';
    return `• BUY ${p.name} ~${rs(p.avgPricePaisa)}${tgt}${stp}`;
  });
  const msg = [
    `📊 *Signal — ${sleeve.name}*`,
    ...lines,
    `_Exit: ${EXIT_HINT[sleeve.strategy] ?? 'exit at the target/stop shown'}_`,
    `_Paper signal — your call, act manually._`,
  ].join('\n');
  await sendTelegramToUser(userId, msg);
}
