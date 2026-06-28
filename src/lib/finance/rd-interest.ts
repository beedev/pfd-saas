/**
 * RD interest auto-derivation — turns each recurring deposit into taxable
 * interest income stored in other_sources_income tagged RD_AUTO.
 *
 * Model (owner's choice): unlike FD interest (which we accrue per financial
 * year), RD interest is recognised in a SINGLE lump in the financial year the
 * deposit MATURES — "add the interest income to tax once matured". The total
 * interest is `maturity − total deposited`.
 *  - A prematurely-closed RD (status BROKEN) books the interest accrued up to
 *    the closure date (updatedAt proxy) in the closure FY instead.
 *  - Only surfaced up to the current tax filing year (same cutoff as FD), so a
 *    not-yet-matured / not-yet-filing RD contributes nothing.
 *  - Regenerate-from-source: syncRdInterest deletes every RD_AUTO row and
 *    rebuilds, so deleting/closing an RD removes its row with no drift.
 *
 * All money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import { db, recurringDeposits, otherSourcesIncome, type RecurringDeposit } from '@/db';
import { getTaxFilingYear } from './tax-filing-year';
import { calculateRdMaturityPaisa, rdTotalDepositPaisa } from './rd';
import { monthsBetween } from './fd';

/** FY string ("2025-26") containing an ISO date (Apr–Mar). */
function fyForIso(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function toIsoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

export interface RdRealisedInterest {
  fy: string;
  interestPaisa: number;
}

/**
 * The single FY + interest amount an RD realises, or null if it realises
 * nothing yet. Full-term → entire interest in the maturity FY. Broken early →
 * interest accrued to the closure date, in the closure FY.
 */
export function rdInterestRealised(rd: RecurringDeposit): RdRealisedInterest | null {
  const start = rd.startDate;
  const maturity = rd.maturityDate;
  if (!start || !maturity) return null;

  const install = rd.monthlyInstallmentPaisa;
  const tenure = rd.tenureMonths;
  const rate = rd.interestRate;
  if (install <= 0 || tenure <= 0 || rate <= 0) return null;
  const comp = rd.compoundingFreq ?? 'QUARTERLY';

  // Premature closure: recognise interest accrued over the installments paid
  // up to the closure date, booked in the closure FY.
  if (rd.status === 'BROKEN') {
    const broken = toIsoDate(rd.updatedAt);
    if (broken && broken < maturity) {
      const elapsed = Math.max(0, Math.min(tenure, monthsBetween(start, broken)));
      if (elapsed <= 0) return null;
      const grown = calculateRdMaturityPaisa(install, rate, elapsed, comp);
      const interest = Math.max(0, grown - rdTotalDepositPaisa(install, elapsed));
      if (interest <= 0) return null;
      return { fy: fyForIso(broken), interestPaisa: interest };
    }
  }

  const maturityPaisa =
    rd.maturityAmountPaisa ?? calculateRdMaturityPaisa(install, rate, tenure, comp);
  const interest = Math.max(0, maturityPaisa - rdTotalDepositPaisa(install, tenure));
  if (interest <= 0) return null;
  return { fy: fyForIso(maturity), interestPaisa: interest };
}

/**
 * Regenerate every RD_AUTO interest row for a user from the current RDs.
 * Idempotent: deletes all RD_AUTO rows first. Call after any RD mutation.
 */
export async function syncRdInterest(
  userId: string,
): Promise<{ created: number; deleted: number }> {
  const rds = await db
    .select()
    .from(recurringDeposits)
    .where(eq(recurringDeposits.userId, userId));

  const deleted = await db
    .delete(otherSourcesIncome)
    .where(
      and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.sourceKind, 'RD_AUTO')),
    )
    .returning({ id: otherSourcesIncome.id });

  // Only book interest up to the tax filing year — never surface a maturity
  // year you haven't started filing. FY strings sort lexically, so "≤" works.
  const cutoffFy = await getTaxFilingYear(userId);
  const rows = rds.flatMap((rd) => {
    const realised = rdInterestRealised(rd);
    if (!realised || realised.fy > cutoffFy) return [];
    return [
      {
        userId,
        financialYear: realised.fy,
        source: 'RD_INTEREST' as const,
        description: `RD interest — ${rd.bankName}${rd.accountNumber ? ` ${rd.accountNumber}` : ''}`,
        amountPaisa: realised.interestPaisa,
        isTaxExempt: false,
        sourceKind: 'RD_AUTO' as const,
        sourceRefId: rd.id,
      },
    ];
  });

  if (rows.length) await db.insert(otherSourcesIncome).values(rows);
  return { created: rows.length, deleted: deleted.length };
}
