/**
 * FD interest auto-derivation — turns each recorded fixed deposit into per-FY
 * interest income, stored in other_sources_income tagged FD_AUTO.
 *
 * Model (agreed with the owner):
 *  - Walk each FD from start date to its effective end, splitting interest at
 *    every 31-March boundary so each financial year gets its own slice.
 *  - The TOTAL interest is the authoritative figure the rest of the app already
 *    shows: maturity − principal for a full-term cumulative FD. We distribute
 *    that total across the financial years by each FY's share of compound growth
 *    (continuous, day-based), so the per-FY slices sum EXACTLY to the maturity
 *    interest — no drift from month-rounding at the 31-March boundary. Non-
 *    cumulative (payout) FDs accrue simple interest spread linearly by days.
 *  - Premature closure (status BROKEN) truncates accrual at the closure date
 *    (we use updatedAt as the proxy — there's no explicit closure column) and
 *    ignores the penalty rate (owner: "we can live with it ignored").
 *  - Regenerate-from-source: syncFdInterest deletes every FD_AUTO row and
 *    rebuilds, so deleting/closing an FD removes its rows with no drift.
 *
 * All money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import { db, fixedDeposits, otherSourcesIncome, type FixedDeposit, type FDCompoundingFreq } from '@/db';
import { getTaxFilingYear } from './tax-filing-year';

const N_PER_YEAR: Record<FDCompoundingFreq, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  YEARLY: 1,
};

/** Years between two ISO dates on an actual/365 basis (fractional). */
function yearsBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 / 365;
}

/** FY string ("2025-26") containing an ISO date (Apr–Mar). */
function fyForIso(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** ISO bounds of a FY string. */
function fyBounds(fy: string): { start: string; end: string } {
  const startYear = Number(fy.slice(0, 4));
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

function nextFy(fy: string): string {
  const ny = Number(fy.slice(0, 4)) + 1;
  return `${ny}-${String((ny + 1) % 100).padStart(2, '0')}`;
}

function toIsoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

const minIso = (a: string, b: string) => (a <= b ? a : b);

export interface FdFyInterest {
  fy: string;
  interestPaisa: number;
}

/**
 * Total interest over the FD's (possibly truncated) life. For a full-term
 * cumulative FD this is the authoritative `maturity − principal` the rest of the
 * app shows. For a prematurely-closed or non-cumulative FD there is no stored
 * figure, so we compute it: compound accrual to the close date (cumulative) or
 * simple interest by days (non-cumulative).
 */
function totalInterestPaisa(fd: FixedDeposit, end: string): number {
  const P = fd.principalPaisa;
  const rate = fd.interestRate;
  const comp = fd.compoundingFreq ?? 'QUARTERLY';
  const cumulative = (fd.interestType ?? 'CUMULATIVE') === 'CUMULATIVE';

  if (cumulative) {
    // Full term + a stored maturity → use it verbatim (authoritative).
    if (end === fd.maturityDate && fd.maturityAmountPaisa != null && fd.maturityAmountPaisa > P) {
      return fd.maturityAmountPaisa - P;
    }
    // Truncated (BROKEN before maturity) → continuous compound accrual to `end`.
    const n = N_PER_YEAR[comp];
    const accrued = P * Math.pow(1 + rate / 100 / n, n * yearsBetween(fd.startDate, end));
    return Math.round(accrued) - P;
  }
  // Non-cumulative (payout): simple interest, not reflected in stored maturity.
  return Math.round(P * (rate / 100) * yearsBetween(fd.startDate, end));
}

/**
 * Interest income each FY for one FD. Empty if the FD has no usable dates.
 * Slices sum EXACTLY to the FD's total interest (the last slice absorbs any
 * rounding residue).
 */
export function fdInterestByFy(fd: FixedDeposit): FdFyInterest[] {
  const start = fd.startDate;
  let end = fd.maturityDate;
  if (!start || !end) return [];

  // Premature closure stops accrual at the closure date (updatedAt proxy).
  if (fd.status === 'BROKEN') {
    const broken = toIsoDate(fd.updatedAt);
    if (broken) end = minIso(end, broken);
  }
  if (end <= start) return [];

  const P = fd.principalPaisa;
  const rate = fd.interestRate;
  if (P <= 0 || rate <= 0) return [];
  const comp = fd.compoundingFreq ?? 'QUARTERLY';
  const cumulative = (fd.interestType ?? 'CUMULATIVE') === 'CUMULATIVE';

  const totalInterest = totalInterestPaisa(fd, end);
  if (totalInterest <= 0) return [];

  // Fraction of total interest realised by date `d`:
  //  cumulative → share of compound growth (back-loaded, economically correct);
  //  non-cumulative → linear by days (interest paid evenly over the term).
  const n = N_PER_YEAR[comp];
  const growth = (d: string) => Math.pow(1 + rate / 100 / n, n * yearsBetween(start, d)) - 1;
  const totalGrowth = growth(end);
  const totalDays = yearsBetween(start, end);
  const fracAt = (d: string): number => {
    if (cumulative) return totalGrowth > 0 ? growth(d) / totalGrowth : 0;
    return totalDays > 0 ? yearsBetween(start, d) / totalDays : 0;
  };

  const out: FdFyInterest[] = [];
  const lastFy = fyForIso(end);
  let fy = fyForIso(start);
  let prevFrac = 0;
  for (let guard = 0; guard < 120; guard++) {
    const { end: fyE } = fyBounds(fy);
    const winEnd = minIso(end, fyE);
    const frac = fracAt(winEnd);
    const slice = Math.round(totalInterest * (frac - prevFrac));
    if (slice > 0) out.push({ fy, interestPaisa: slice });
    prevFrac = frac;
    if (fy === lastFy) break;
    fy = nextFy(fy);
  }
  // Make the slices reconcile to the exact total (absorb rounding in the last).
  const sum = out.reduce((s, x) => s + x.interestPaisa, 0);
  if (out.length && sum !== totalInterest) {
    out[out.length - 1].interestPaisa += totalInterest - sum;
  }
  return out.filter((s) => s.interestPaisa > 0);
}

/**
 * Regenerate every FD_AUTO interest row for a user from the current FDs.
 * Idempotent: deletes all FD_AUTO rows first, so closing/deleting an FD drops
 * its rows automatically. Call after any FD mutation and on-demand.
 */
export async function syncFdInterest(
  userId: string,
): Promise<{ created: number; deleted: number }> {
  const fds = await db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, userId));

  const deleted = await db
    .delete(otherSourcesIncome)
    .where(
      and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.sourceKind, 'FD_AUTO')),
    )
    .returning({ id: otherSourcesIncome.id });

  // Only book interest up to the tax filing year — never surface a year you
  // haven't started filing as earned income (owner's rule: don't show next year
  // until the previous one is closed). Closing 2025-26 advances this to 2026-27,
  // which then reveals 2026-27's interest. FY strings sort lexically, so "≤" works.
  const cutoffFy = await getTaxFilingYear(userId);
  const rows = fds.flatMap((fd) =>
    fdInterestByFy(fd)
      .filter((slice) => slice.fy <= cutoffFy)
      .map((slice) => ({
        userId,
        financialYear: slice.fy,
        source: 'FD_INTEREST' as const,
        description: `FD interest — ${fd.bankName}${fd.accountNumber ? ` ${fd.accountNumber}` : ''}`,
        amountPaisa: slice.interestPaisa,
        isTaxExempt: false,
        sourceKind: 'FD_AUTO' as const,
        sourceRefId: fd.id,
      })),
  );

  if (rows.length) await db.insert(otherSourcesIncome).values(rows);
  return { created: rows.length, deleted: deleted.length };
}
