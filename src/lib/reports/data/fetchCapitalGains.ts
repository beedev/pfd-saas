/**
 * Sprint 6.2b — Capital Gains report data fetcher.
 *
 * Pulls capital_gains rows for the FY and splits them into LTCG /
 * STCG buckets with per-entry detail (asset, sale date, indexed cost,
 * gain, exemption, taxable, tax).
 *
 * Indexation is already applied in the `purchasePrice` paisa value
 * for LTCG rows (caller is expected to have used the CII helper when
 * entering the row). The fetcher does not re-derive — it surfaces the
 * stored numbers verbatim. This matches the /tax/capital-gains page
 * which is the source of truth for these entries.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db, capitalGains } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import type { ReportParams } from '@/types/reports';

export interface CapitalGainsEntry {
  assetType: string;
  assetName: string;
  purchaseDate: string;
  saleDate: string;
  purchasePaisa: number;
  salePaisa: number;
  gainPaisa: number;
  exemptionPaisa: number;
  taxablePaisa: number;
  taxRate: number;
  taxPaisa: number;
  notes: string;
}

export interface CapitalGainsReportData {
  fy: string;
  ltcg: CapitalGainsEntry[];
  stcg: CapitalGainsEntry[];
  totals: {
    ltcgGainPaisa: number;
    stcgGainPaisa: number;
    totalExemptionPaisa: number;
    totalTaxablePaisa: number;
    totalTaxPaisa: number;
  };
}

function mapRow(r: typeof capitalGains.$inferSelect): CapitalGainsEntry {
  return {
    assetType: r.assetType,
    assetName: r.assetName,
    purchaseDate: r.purchaseDate || '',
    saleDate: r.saleDate,
    purchasePaisa: r.purchasePrice || 0,
    salePaisa: r.salePrice || 0,
    gainPaisa: r.capitalGain || 0,
    exemptionPaisa: r.exemptionApplied || 0,
    taxablePaisa: r.taxableGain || 0,
    taxRate: r.taxRate,
    taxPaisa: r.taxAmount || 0,
    notes: r.notes || '',
  };
}

export async function fetchCapitalGains(params: ReportParams): Promise<CapitalGainsReportData> {
  const userId = params.userId;
  const fy = params.fy || getCurrentFinancialYear();

  const rows = await db
    .select()
    .from(capitalGains)
    .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy)))
    .orderBy(desc(capitalGains.saleDate));

  const ltcg = rows.filter((r) => r.holdingPeriod === 'LTCG').map(mapRow);
  const stcg = rows.filter((r) => r.holdingPeriod === 'STCG').map(mapRow);

  const ltcgGainPaisa = ltcg.reduce((s, e) => s + e.gainPaisa, 0);
  const stcgGainPaisa = stcg.reduce((s, e) => s + e.gainPaisa, 0);
  const totalExemptionPaisa = rows.reduce((s, r) => s + (r.exemptionApplied || 0), 0);
  const totalTaxablePaisa = rows.reduce((s, r) => s + (r.taxableGain || 0), 0);
  const totalTaxPaisa = rows.reduce((s, r) => s + (r.taxAmount || 0), 0);

  return {
    fy,
    ltcg,
    stcg,
    totals: {
      ltcgGainPaisa,
      stcgGainPaisa,
      totalExemptionPaisa,
      totalTaxablePaisa,
      totalTaxPaisa,
    },
  };
}
