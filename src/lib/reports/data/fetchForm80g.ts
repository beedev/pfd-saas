/**
 * Sprint 6.2b — 80G donation log report data fetcher.
 *
 * Filters tax_deductions to the 80G section for the FY. Each row
 * carries the PAN-tagged donee, donation mode, eligibility percent,
 * and category (50_NO_LIMIT / 100_NO_LIMIT / 50_WITH_LIMIT /
 * 100_WITH_LIMIT). The report consumer renders these straight.
 *
 * We compute a simple deductible amount per row using the row's
 * `qualifyingPercent` if set, else falling back to the category-based
 * default (50 or 100). The full 80G aggregator with adjusted-gross
 * 10% cap math lives in `src/lib/finance/section-80g.ts`; this fetcher
 * intentionally surfaces raw donations + a per-row indicative
 * deductible, not the regime-aware grand total (that's what the
 * /tax/80g page shows and is referenced for the formal claim).
 */

import { and, eq } from 'drizzle-orm';
import { db, taxDeductions } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import type { ReportParams } from '@/types/reports';

export interface Form80gDonation {
  date: string;
  organization: string;
  pan: string;
  mode: string;
  category: string;
  amountPaisa: number;
  eligibilityPct: number;
  deductiblePaisa: number;
  certificate80g: string;
  notes: string;
}

export interface Form80gReportData {
  fy: string;
  donations: Form80gDonation[];
  totals: {
    grossPaisa: number;
    deductiblePaisa: number;
  };
}

/** Default eligibility for a category when the row didn't store
 *  qualifyingPercent. 100_* → 100%, 50_* → 50%. Unknown → 50% (safe). */
function defaultEligibilityForCategory(cat: string | null): number {
  if (!cat) return 50;
  if (cat.startsWith('100_')) return 100;
  if (cat.startsWith('50_')) return 50;
  return 50;
}

export async function fetchForm80g(params: ReportParams): Promise<Form80gReportData> {
  const userId = params.userId;
  const fy = params.fy || getCurrentFinancialYear();

  const rows = await db
    .select()
    .from(taxDeductions)
    .where(
      and(
        eq(taxDeductions.userId, userId),
        eq(taxDeductions.financialYear, fy),
        eq(taxDeductions.section, '80G'),
      ),
    );

  const donations: Form80gDonation[] = rows.map((r) => {
    const eligibilityPct =
      r.qualifyingPercent ?? defaultEligibilityForCategory(r.eightyGCategory);
    const amount = r.amountPaisa || r.deductibleAmount || 0;
    const deductiblePaisa = Math.round((amount * eligibilityPct) / 100);
    return {
      date: r.paymentDate || r.incurredDate || '',
      organization: r.recipientName || r.description || '',
      pan: r.recipientPan || '',
      mode: r.paymentMethod || '',
      category: r.eightyGCategory || '',
      amountPaisa: amount,
      eligibilityPct,
      deductiblePaisa,
      certificate80g: r.recipient80gNumber || '',
      notes: r.notes || '',
    };
  });

  const grossPaisa = donations.reduce((s, d) => s + d.amountPaisa, 0);
  const deductiblePaisa = donations.reduce((s, d) => s + d.deductiblePaisa, 0);

  return {
    fy,
    donations,
    totals: { grossPaisa, deductiblePaisa },
  };
}
