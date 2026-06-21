/**
 * MF redemption NAV-date engine (SEBI cutoff rule).
 *
 * A redemption raised BEFORE the fund's cutoff gets the request day's NAV;
 * AFTER cutoff it gets the next calendar day's NAV. We apply ONLY the cutoff
 * rule here — we do NOT model weekends or holidays. Resolving a non-business day
 * to a real NAV is the NAV lookup's job: it returns the first NAV published on
 * or after the target date, so the published NAV dates are the single source of
 * truth for the business calendar (no weekend/holiday table to keep in sync).
 *
 * A day's NAV is only published the following day, so the applicable NAV may not
 * exist at request time — the caller treats that as PENDING and settles once it
 * publishes. All dates are IST calendar dates (YYYY-MM-DD).
 */

import type { MutualFundType } from '@/db';

/** Cutoff (minutes since IST midnight) by fund type. Liquid funds cut
 *  off earlier (1:30 PM); everything else at 3:00 PM. */
export function cutoffMinutesIST(fundType: MutualFundType): number {
  return fundType === 'LIQUID' ? 13 * 60 + 30 : 15 * 60;
}

export function cutoffLabel(fundType: MutualFundType): string {
  return fundType === 'LIQUID' ? '1:30 PM' : '3:00 PM';
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Applicable NAV date for a redemption — the cutoff rule only. Weekends and
 * holidays are intentionally NOT rolled here; the NAV lookup resolves this
 * target to the first NAV published on or after it.
 * @param requestDate YYYY-MM-DD — IST calendar date the request was raised
 * @param afterCutoff whether it was raised after the fund's cutoff time
 */
export function resolveApplicableNavDate(requestDate: string, afterCutoff: boolean): string {
  return afterCutoff ? addDaysIso(requestDate, 1) : requestDate;
}

/** Current IST wall-clock as { dateIso, minutes-since-midnight }. */
export function nowIST(): { dateIso: string; minutes: number } {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(istMs);
  return {
    dateIso: ist.toISOString().slice(0, 10),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

/** Was "now" (IST) after the fund's cutoff? For the "redeem now" path. */
export function isAfterCutoffNow(fundType: MutualFundType): boolean {
  return nowIST().minutes >= cutoffMinutesIST(fundType);
}
