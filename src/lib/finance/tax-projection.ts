/**
 * Tax-projection helper — Sprint 4 Phase 3.
 *
 * Mirrors /api/tax/regime-compare's income aggregation + slab math but
 * exposes it as a server-callable function so the advance-tax route
 * can compute "expected annual tax" without going through the HTTP
 * round-trip (which would require its own session cookie).
 *
 * Kept narrow on purpose — the only consumer right now is advance-tax.
 * If goal-projection or retirement also need this in Phase 5, we'll
 * promote it then.
 */

import { and, eq, gte, lte } from 'drizzle-orm';
import {
  db,
  taxSlabs,
  taxRegimeConfig,
  taxDeductions,
  salaryIncome,
  otherSourcesIncome,
  capitalGains,
  realEstate,
  invoices,
  type TaxRegime,
} from '@/db';
import { compareRegimes, type RegimeCompareResult } from './tax-slabs';

/** "2026-27" → { start: '2026-04-01', end: '2027-03-31' }. */
function fyBounds(fy: string): { start: string; end: string } | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

export interface TaxProjection {
  fy: string;
  grossIncomePaisa: number;
  oldDeductionsPaisa: number;
  newDeductionsPaisa: number;
  comparison: RegimeCompareResult;
  /** Projected annual tax under the recommended regime. */
  projectedAnnualTaxPaisa: number;
  /** Effective tax rate under the recommended regime — used as a
   *  conservative proxy for "marginal rate" in Phase 5 simplification. */
  effectiveRatePct: number;
}

/** Compute projected annual tax for a user / FY using the same data
 *  sources as /api/tax/regime-compare. Returns null if slab data for
 *  the FY hasn't been seeded yet. */
export async function projectAnnualTax(
  userId: string,
  fy: string,
): Promise<TaxProjection | null> {
  const bounds = fyBounds(fy);
  if (!bounds) return null;

  const [slabs, configs] = await Promise.all([
    db.select().from(taxSlabs).where(eq(taxSlabs.fy, fy)),
    db.select().from(taxRegimeConfig).where(eq(taxRegimeConfig.fy, fy)),
  ]);

  if (slabs.length === 0 || configs.length < 2) return null;

  const slabsByRegime = (regime: TaxRegime) =>
    slabs.filter((s) => s.regime === regime);
  const configByRegime = (regime: TaxRegime) => {
    const cfg = configs.find((c) => c.regime === regime);
    if (!cfg) throw new Error(`Missing config for regime ${regime} in FY ${fy}`);
    return cfg;
  };

  const [salaries, others, _caps, properties, gstInvoices, deductions] =
    await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
      db
        .select()
        .from(otherSourcesIncome)
        .where(
          and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy)),
        ),
      db
        .select()
        .from(capitalGains)
        .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy))),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.userId, userId),
            gte(invoices.invoiceDate, bounds.start),
            lte(invoices.invoiceDate, bounds.end),
            eq(invoices.status, 'FINAL'),
          ),
        ),
      db
        .select()
        .from(taxDeductions)
        .where(
          and(eq(taxDeductions.userId, userId), eq(taxDeductions.financialYear, fy)),
        ),
    ]);
  void _caps; // capital gains tracked separately — different slab rules

  const salaryPaisa = salaries.reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
  const otherPaisa = others
    .filter((r) => !r.isTaxExempt)
    .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
  const businessPaisa = gstInvoices.reduce((s, r) => s + (r.taxableAmount ?? 0), 0);
  const rentalPaisa = properties.reduce((s, r) => s + (r.monthlyRent ?? 0) * 12, 0);
  const grossIncomePaisa = salaryPaisa + otherPaisa + businessPaisa + rentalPaisa;
  const oldDeductionsPaisa = deductions.reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

  const comparison = compareRegimes({
    grossIncomePaisa,
    oldRegimeDeductionsPaisa: oldDeductionsPaisa,
    newRegimeDeductionsPaisa: 0,
    oldSlabs: slabsByRegime('OLD'),
    oldConfig: configByRegime('OLD'),
    newSlabs: slabsByRegime('NEW'),
    newConfig: configByRegime('NEW'),
  });

  const chosen =
    comparison.recommendation === 'NEW' ? comparison.new : comparison.old;

  return {
    fy,
    grossIncomePaisa,
    oldDeductionsPaisa,
    newDeductionsPaisa: 0,
    comparison,
    projectedAnnualTaxPaisa: chosen.totalTaxPaisa,
    effectiveRatePct: chosen.effectiveRatePct,
  };
}
