/**
 * Sprint 6.2b — Income Summary report data fetcher.
 *
 * FY-scoped income across every source the app tracks:
 *   • Salary — sum of salary_income rows for the FY
 *   • Business — businessProfile (single row per user)
 *   • Capital gains — capital_gains rows for the FY (split LTCG/STCG)
 *   • Other income — otherSourcesIncome rows for the FY (interest,
 *     dividends, rental, other)
 *
 * The shape is canonical — PDF/Excel/CSV consume it identically.
 *
 * Missing data degrades gracefully — empty buckets surface as 0.
 */

import { and, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  businessProfile,
  capitalGains,
  otherSourcesIncome,
} from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import type { ReportParams } from '@/types/reports';

export interface IncomeSummaryReportData {
  fy: string;
  salary: {
    grossPaisa: number;
    exemptionsPaisa: number;
    taxablePaisa: number;
    tdsPaisa: number;
    employers: { employerName: string; employerTan: string; grossPaisa: number }[];
  };
  business: {
    receiptsPaisa: number;
    expensesPaisa: number;
    netPaisa: number;
    profileNames: string[];
  };
  capitalGains: {
    ltcgPaisa: number;
    stcgPaisa: number;
    totalTaxPaisa: number;
    entries: number;
  };
  otherIncome: {
    interestPaisa: number;
    dividendsPaisa: number;
    rentalPaisa: number;
    otherPaisa: number;
    totalPaisa: number;
  };
  totals: {
    grandTotalPaisa: number;
  };
}

export async function fetchIncomeSummary(params: ReportParams): Promise<IncomeSummaryReportData> {
  const userId = params.userId;
  const fy = params.fy || getCurrentFinancialYear();

  const [salaryRows, bizRows, cgRows, otherRows] = await Promise.all([
    db
      .select()
      .from(salaryIncome)
      .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
    db.select().from(businessProfile).where(eq(businessProfile.userId, userId)),
    db
      .select()
      .from(capitalGains)
      .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy))),
    db
      .select()
      .from(otherSourcesIncome)
      .where(
        and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy)),
      ),
  ]);

  // ── Salary aggregation ────────────────────────────────────────────
  const grossPaisa = salaryRows.reduce((s, r) => s + (r.grossSalaryPaisa || 0), 0);
  const exemptionsPaisa = salaryRows.reduce((s, r) => s + (r.exemptionsPaisa || 0), 0);
  const taxablePaisa = salaryRows.reduce((s, r) => s + (r.taxableSalaryPaisa || 0), 0);
  const tdsPaisa = salaryRows.reduce((s, r) => s + (r.tdsPaisa || 0), 0);

  // ── Business aggregation ──────────────────────────────────────────
  // businessProfile is the user's GST/business meta; for income we
  // surface the count of profiles and their names. Receipts/expenses
  // aren't tracked at this layer (GST invoices + purchaseInvoices
  // are the source of truth and require an FY join). We default to
  // zero and let downstream consumers know it's a placeholder. The
  // GST invoice rollup is intentionally deferred to a later sprint —
  // this report still ships with salary + capital gains + other income
  // populated, which is the more common need.
  const bizNames = bizRows.map((b) => b.businessName || 'Business');

  // ── Capital Gains aggregation ─────────────────────────────────────
  const ltcgPaisa = cgRows
    .filter((r) => r.holdingPeriod === 'LTCG')
    .reduce((s, r) => s + (r.capitalGain || 0), 0);
  const stcgPaisa = cgRows
    .filter((r) => r.holdingPeriod === 'STCG')
    .reduce((s, r) => s + (r.capitalGain || 0), 0);
  const totalTaxPaisa = cgRows.reduce((s, r) => s + (r.taxAmount || 0), 0);

  // ── Other Sources ─────────────────────────────────────────────────
  // `otherSourcesIncome.source` is the enum (BANK_INTEREST, DIVIDEND,
  // etc.). We collapse all *_INTEREST sources into a single interest
  // bucket; DIVIDEND stays its own bucket. Rental income doesn't have
  // a dedicated other-sources value — it lives in the property's
  // rental_history table — so the bucket here is always 0; the user-
  // facing income summary still shows the row for completeness.
  const INTEREST_SOURCES = new Set(['BANK_INTEREST', 'FD_INTEREST', 'PF_INTEREST']);
  const interestPaisa = otherRows
    .filter((r) => INTEREST_SOURCES.has(r.source))
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  const dividendsPaisa = otherRows
    .filter((r) => r.source === 'DIVIDEND')
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  const rentalPaisa = 0;
  const otherPaisa = otherRows
    .filter((r) => !INTEREST_SOURCES.has(r.source) && r.source !== 'DIVIDEND')
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  const otherTotalPaisa = interestPaisa + dividendsPaisa + rentalPaisa + otherPaisa;

  const grandTotalPaisa =
    grossPaisa + ltcgPaisa + stcgPaisa + otherTotalPaisa;

  return {
    fy,
    salary: {
      grossPaisa,
      exemptionsPaisa,
      taxablePaisa,
      tdsPaisa,
      employers: salaryRows.map((r) => ({
        employerName: r.employerName,
        employerTan: r.employerTan,
        grossPaisa: r.grossSalaryPaisa || 0,
      })),
    },
    business: {
      receiptsPaisa: 0,
      expensesPaisa: 0,
      netPaisa: 0,
      profileNames: bizNames,
    },
    capitalGains: {
      ltcgPaisa,
      stcgPaisa,
      totalTaxPaisa,
      entries: cgRows.length,
    },
    otherIncome: {
      interestPaisa,
      dividendsPaisa,
      rentalPaisa,
      otherPaisa,
      totalPaisa: otherTotalPaisa,
    },
    totals: { grandTotalPaisa },
  };
}
