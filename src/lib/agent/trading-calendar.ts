/**
 * NSE trading-calendar gate — the analyst pipeline should run on TRADING DAYS only.
 * On weekends (and NSE holidays) the market is closed: morning picks would run on
 * stale Friday data and never get bought, and snapshots would just duplicate
 * Friday's equity. Gating here keeps the forward-test record clean.
 */

const istFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const istWeekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });

/** Today's date in IST as YYYY-MM-DD. */
export const istDate = (): string => istFmt.format(new Date());

/**
 * NSE trading holidays (YYYY-MM-DD, IST). Extend for the study window — the fixed
 * national holidays are seeded; add the variable-date ones (Diwali, Holi, Eid,
 * etc.) from the NSE calendar as the year's list is published.
 */
export const NSE_HOLIDAYS = new Set<string>([
  '2026-08-15', // Independence Day
  '2026-10-02', // Gandhi Jayanti
  '2026-12-25', // Christmas
  '2027-01-26', // Republic Day
  // TODO: add Diwali/Holi/Eid/Mahashivratri etc. for 2026-27 from the NSE calendar.
]);

const isNonTradingDate = (d: Date): boolean => {
  const wd = istWeekdayFmt.format(d);
  return wd === 'Sat' || wd === 'Sun' || NSE_HOLIDAYS.has(istFmt.format(d));
};

/** True only on an NSE trading day (weekday, not a listed holiday) — evaluated in IST now. */
export function isTradingDayNow(): boolean {
  return !isNonTradingDate(new Date());
}

/**
 * How far back the trading-day news window should reach — spans the gap since the
 * PREVIOUS trading session so a Monday (or post-holiday) run consolidates the whole
 * weekend's catalysts, not just the last overnight. ~30h on a normal weekday,
 * ~78h after a weekend, more after a long weekend. Capped at 120h.
 */
export function newsLookbackHours(): number {
  let nonTrading = 0;
  for (let back = 1; back <= 6; back++) {
    if (isNonTradingDate(new Date(Date.now() - back * 86400000))) nonTrading++;
    else break;
  }
  return Math.min(120, 24 * (nonTrading + 1) + 6);
}
