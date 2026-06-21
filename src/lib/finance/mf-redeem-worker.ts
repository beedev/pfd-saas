/**
 * Settle PENDING MF redemptions whose applicable NAV has now published.
 *
 * Runs per user. Piggybacks on the daily sip_auto_execute cron (both are
 * NAV-driven), and is also exposed as a manual trigger endpoint.
 */

import { and, eq } from 'drizzle-orm';
import { db, mfRedemptions, mutualFunds } from '@/db';
import { getSchemeCodeByIsin, getHistoricalNavOn } from '@/lib/services/amfi';
import { settleRedemption } from './mf-redeem-settle';

export async function settlePendingRedemptions(
  userId: string,
): Promise<{ settled: number; stillPending: number }> {
  const pending = await db
    .select()
    .from(mfRedemptions)
    .where(and(eq(mfRedemptions.userId, userId), eq(mfRedemptions.status, 'PENDING')));

  let settled = 0;
  for (const r of pending) {
    const [mf] = await db
      .select()
      .from(mutualFunds)
      .where(and(eq(mutualFunds.id, r.mutualFundId), eq(mutualFunds.userId, userId)))
      .limit(1);
    if (!mf) continue;
    const code = await getSchemeCodeByIsin(mf.isin);
    if (!code) continue;
    const navOn = await getHistoricalNavOn(code, r.applicableNavDate);
    if (navOn == null) continue; // not yet published — leave pending
    try {
      await settleRedemption(userId, r, navOn.navRupees, navOn.navDateIso);
      settled += 1;
    } catch (err) {
      console.error('[mf-redeem-worker] settle failed for redemption', r.id, err);
    }
  }
  return { settled, stillPending: pending.length - settled };
}
