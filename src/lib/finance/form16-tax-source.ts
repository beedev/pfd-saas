/**
 * Form 16 / 26AS as the authoritative source for salary income + TDS in
 * tax computation.
 *
 * Form 16 is the official certificate, so when one exists for an FY it
 * OVERRIDES the manually-kept books (salary_income / tds_credits) for tax
 * calculation — without mutating them. The reconciliation endpoint
 * surfaces any books-vs-Form-16 gap separately (that's the ⚠️ on the tax
 * landing page); this module is purely about which number the tax math
 * should trust.
 *
 * Precedence:
 *   salary income → Form 16 Part B (line 6) ▸ salary_income books
 *   salary TDS    → Form 16 Part A total    ▸ Form 26AS total ▸ books
 *
 * Every consumer (tax position, regime-compare, ITR summaries, the
 * "Tax Paid So Far" card) calls these so the authoritative figure is
 * resolved in exactly one place.
 *
 * Multi-tenant: every exported function takes `userId` first and scopes
 * EVERY query by `eq(table.userId, userId)` in addition to the FY filter.
 */

import { and, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  tdsCredits,
  form16Uploads,
  form26asUploads,
  incomeTaxPaid,
} from '@/db';

export type TaxSource = 'form16' | 'form26as' | 'books';

export interface ResolvedAmount {
  valuePaisa: number;
  source: TaxSource;
  /** Human-readable provenance, e.g. "Form 16 Part B (1)". */
  detail: string;
}

function sum<T>(rows: T[], pick: (r: T) => number | null | undefined): number {
  return rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
}

const hasPart = (partsPresent: string | null, p: 'A' | 'B'): boolean =>
  (partsPresent ?? '').split(',').includes(p);

/**
 * Salary income chargeable under the head "Salaries" — Form 16 Part B
 * (line 6, income chargeable) when a Part-B Form 16 exists for the FY,
 * else the salary_income books. Also returns gross for callers that show
 * the gross figure.
 */
export async function resolveSalaryIncome(
  userId: string,
  fy: string,
): Promise<ResolvedAmount & { grossSalaryPaisa: number; hraExemptionPaisa: number }> {
  const f16 = await db
    .select()
    .from(form16Uploads)
    .where(and(eq(form16Uploads.userId, userId), eq(form16Uploads.fy, fy)));
  const withB = f16.filter((r) => hasPart(r.partsPresent, 'B'));
  if (withB.length) {
    return {
      valuePaisa: sum(withB, (r) => r.taxableSalaryPaisa),
      grossSalaryPaisa: sum(withB, (r) => r.grossSalaryPaisa),
      // Form 16 Part B reports the employer-computed sec-10(13A) HRA
      // exemption directly. When the books don't carry HRA components
      // (basic/HRA/rent), this is the authoritative OLD-regime figure.
      hraExemptionPaisa: sum(withB, (r) => r.hraExemptionPaisa ?? 0),
      source: 'form16',
      detail: `Form 16 Part B (${withB.length})`,
    };
  }
  const sal = await db
    .select()
    .from(salaryIncome)
    .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy)));
  return {
    valuePaisa: sum(sal, (r) => r.taxableSalaryPaisa),
    grossSalaryPaisa: sum(sal, (r) => r.grossSalaryPaisa),
    hraExemptionPaisa: 0,
    source: 'books',
    detail: `salary_income (${sal.length})`,
  };
}

/**
 * Salary TDS — Form 16 Part A total when present, else Form 26AS total,
 * else salary_income.tds books.
 */
export async function resolveSalaryTds(userId: string, fy: string): Promise<ResolvedAmount> {
  const f16 = await db
    .select()
    .from(form16Uploads)
    .where(and(eq(form16Uploads.userId, userId), eq(form16Uploads.fy, fy)));
  const withA = f16.filter((r) => hasPart(r.partsPresent, 'A'));
  if (withA.length) {
    return {
      valuePaisa: sum(withA, (r) => r.totalTdsPaisa),
      source: 'form16',
      detail: `Form 16 Part A (${withA.length})`,
    };
  }
  const f26 = await db
    .select()
    .from(form26asUploads)
    .where(and(eq(form26asUploads.userId, userId), eq(form26asUploads.fy, fy)));
  if (f26.length) {
    return {
      valuePaisa: sum(f26, (r) => r.parsedTotalTdsPaisa),
      source: 'form26as',
      detail: `Form 26AS (${f26.length})`,
    };
  }
  const sal = await db
    .select()
    .from(salaryIncome)
    .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy)));
  return {
    valuePaisa: sum(sal, (r) => r.tdsPaisa),
    source: 'books',
    detail: `salary_income.tds (${sal.length})`,
  };
}

export interface TaxPaidBreakdown {
  /** Salary TDS, Form 16 / 26AS authoritative. */
  salaryTds: ResolvedAmount;
  /** Non-salary TDS from tds_credits (194J / 194A / 194). Excluded when
   *  salaryTds came from 26AS, since the 26AS total already includes it. */
  otherTdsPaisa: number;
  /** Advance + self-assessment payments (income_tax_paid). */
  selfPaidPaisa: number;
  /** Grand total of tax already paid for the FY. */
  totalPaisa: number;
}

/**
 * Total tax already paid for the FY = TDS (Form 16 / 26AS authoritative)
 * + other-section TDS + advance/self-assessment payments. Powers the
 * "Tax Paid So Far" surface, which previously counted only manual
 * income_tax_paid rows.
 */
export async function resolveTaxPaid(userId: string, fy: string): Promise<TaxPaidBreakdown> {
  const salaryTds = await resolveSalaryTds(userId, fy);

  const tdsRows = await db
    .select()
    .from(tdsCredits)
    .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy)));
  const otherTdsPaisa = sum(tdsRows, (r) => r.tdsPaisa);

  const paid = await db
    .select()
    .from(incomeTaxPaid)
    .where(and(eq(incomeTaxPaid.userId, userId), eq(incomeTaxPaid.financialYear, fy)));
  const selfPaidPaisa = sum(paid, (r) => r.amount);

  // A 26AS total already aggregates every section, so don't add
  // tds_credits on top of it (double-count). Form 16 Part A and books are
  // salary-only, so non-salary TDS is additive there.
  const includeOther = salaryTds.source !== 'form26as';
  const totalPaisa =
    salaryTds.valuePaisa + (includeOther ? otherTdsPaisa : 0) + selfPaidPaisa;

  return { salaryTds, otherTdsPaisa: includeOther ? otherTdsPaisa : 0, selfPaidPaisa, totalPaisa };
}
