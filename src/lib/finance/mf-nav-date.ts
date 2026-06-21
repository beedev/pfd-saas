/**
 * MF redemption NAV-date engine (SEBI cutoff rule).
 *
 * A redemption raised BEFORE the fund's cutoff on a business day gets
 * THAT day's NAV; AFTER cutoff (or on a non-business day) it gets the
 * NEXT business day's NAV. A day's NAV is only published the following
 * day, so the applicable NAV may not exist at request time — the caller
 * treats that as PENDING and settles once it publishes.
 *
 * Calendar: weekends-only (Sat/Sun). Exchange holidays are NOT modelled
 * yet; a redemption landing on a weekday holiday settles off the nearest
 * published NAV via the settlement worker's fallback. All dates are IST
 * calendar dates (YYYY-MM-DD).
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

function isWeekend(iso: string): boolean {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 Sun … 6 Sat
  return day === 0 || day === 6;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Roll forward to the next business day (skips Sat/Sun). */
export function rollToBusinessDay(iso: string): string {
  let d = iso;
  while (isWeekend(d)) d = addDaysIso(d, 1);
  return d;
}

/**
 * Applicable NAV date for a redemption.
 * @param requestDate YYYY-MM-DD — IST calendar date the request was raised
 * @param afterCutoff whether it was raised after the fund's cutoff time
 */
export function resolveApplicableNavDate(requestDate: string, afterCutoff: boolean): string {
  const base = afterCutoff ? addDaysIso(requestDate, 1) : requestDate;
  return rollToBusinessDay(base);
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
