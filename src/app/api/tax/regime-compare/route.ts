/**
 * GET /api/tax/regime-compare?fy=2026-27
 *
 * Computes tax under BOTH regimes side-by-side using the user's
 * gross income + deductions for the given FY, returns the
 * recommendation + savings delta.
 *
 * Gross income sources (summed for the FY):
 *   • salary_income (gross_monthly_paisa × 12 over months in FY)
 *   • other_sources_income — non-exempt rows
 *   • capital gains realised in the FY (LTCG + STCG) — NOTE: slabs do
 *     NOT apply to LTCG/STCG (separate flat rates). For now we pass
 *     only slab-applicable income; LTCG/STCG handling is a Phase 2
 *     refinement.
 *   • GST invoice income (taxable_amount on FINAL invoices)
 *   • real_estate.monthly_rent × 12
 *
 * Deductions:
 *   • OLD regime — sum from tax_deductions table (all eligible Section 80
 *     entries for the FY) + standard deduction (handled by lib)
 *   • NEW regime — basically zero for most users (NPS Tier-I employer
 *     contribution under 80CCD(2) is the main one allowed; user can
 *     mark deductions with `regime: 'NEW' | 'BOTH'` in a later phase).
 *     For now we pass 0 for new-regime deductions — conservative.
 *
 * Auth-gated, user-scoped. The slab tables are NOT user-scoped (govt
 * data) so reads are global.
 */

import { NextRequest, NextResponse } from 'next/server';
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
import { compareRegimes } from '@/lib/finance/tax-slabs';
import { auth } from '@/auth';

/** Convert FY string "2026-27" → { start: '2026-04-01', end: '2027-03-31' }. */
function fyBounds(fy: string): { start: string; end: string } | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  return { start, end };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy') ?? defaultCurrentFY();
    const bounds = fyBounds(fy);
    if (!bounds) {
      return NextResponse.json({ error: 'Invalid fy format, use YYYY-YY' }, { status: 400 });
    }

    // Slab + config rows — govt data, not user-scoped.
    const [slabs, configs] = await Promise.all([
      db.select().from(taxSlabs).where(eq(taxSlabs.fy, fy)),
      db.select().from(taxRegimeConfig).where(eq(taxRegimeConfig.fy, fy)),
    ]);

    if (slabs.length === 0 || configs.length < 2) {
      return NextResponse.json(
        { error: `No slab data for FY ${fy}. Seed first.` },
        { status: 404 },
      );
    }

    const slabsByRegime = (regime: TaxRegime) =>
      slabs.filter((s) => s.regime === regime);
    const configByRegime = (regime: TaxRegime) => {
      const cfg = configs.find((c) => c.regime === regime);
      if (!cfg) throw new Error(`Missing config for regime ${regime} in FY ${fy}`);
      return cfg;
    };

    // Income sources — all user-scoped. Aggregate gross in paisa.
    const userId = session.user.id;
    const [
      salaries,
      others,
      caps,
      properties,
      gstInvoices,
      deductions,
    ] = await Promise.all([
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
          and(
            eq(taxDeductions.userId, userId),
            eq(taxDeductions.financialYear, fy),
          ),
        ),
    ]);

    // Salary: sum gross annual across all rows (multiple employers possible).
    // Note: schema has gross_salary_paisa + taxable_salary_paisa. We use
    // gross_salary so the lib's standard-deduction step does the right
    // thing — taxable_salary_paisa already has section-16 deductions
    // applied and would double-count.
    const salaryPaisa = salaries.reduce(
      (s, r) => s + (r.grossSalaryPaisa ?? 0),
      0,
    );

    // Other sources — exclude rows flagged tax-exempt (PPF interest etc.).
    const otherPaisa = others
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

    // GST invoices — taxable_amount is post-GST-component, the freelance
    // / consulting income before tax. Falls under business income.
    const businessPaisa = gstInvoices.reduce(
      (s, r) => s + (r.taxableAmount ?? 0),
      0,
    );

    // Rental — monthly_rent × 12 across tenanted properties.
    const rentalPaisa = properties.reduce(
      (s, r) => s + (r.monthlyRent ?? 0) * 12,
      0,
    );

    // Capital gains — LTCG/STCG have their own slab rates and don't go
    // through the income-tax slab. Track separately. Phase 2 will add
    // a proper LTCG/STCG calculator.
    const capitalGainsTaxablePaisa = caps.reduce(
      (s, r) => s + (r.taxableGain ?? 0),
      0,
    );

    const grossSlabIncomePaisa =
      salaryPaisa + otherPaisa + businessPaisa + rentalPaisa;

    // Sum chapter-VI-A deductions. ALL eligible for OLD regime; we'll
    // narrow for NEW once Sprint 4.5 adds the per-section regime flags.
    const oldDeductionsPaisa = deductions.reduce(
      (s, r) => s + (r.amountPaisa ?? 0),
      0,
    );

    const result = compareRegimes({
      grossIncomePaisa: grossSlabIncomePaisa,
      oldRegimeDeductionsPaisa: oldDeductionsPaisa,
      newRegimeDeductionsPaisa: 0,
      oldSlabs: slabsByRegime('OLD'),
      oldConfig: configByRegime('OLD'),
      newSlabs: slabsByRegime('NEW'),
      newConfig: configByRegime('NEW'),
    });

    return NextResponse.json({
      fy,
      income: {
        salary: salaryPaisa,
        other: otherPaisa,
        business: businessPaisa,
        rental: rentalPaisa,
        gross: grossSlabIncomePaisa,
        // Surfaced separately — slab tax doesn't include this
        capitalGainsTaxable: capitalGainsTaxablePaisa,
      },
      deductions: {
        oldRegime: oldDeductionsPaisa,
        newRegime: 0,
      },
      comparison: result,
    });
  } catch (err) {
    console.error('[tax/regime-compare GET]', err);
    return NextResponse.json({ error: 'Failed to compute' }, { status: 500 });
  }
}

/** Returns the current Indian FY as a string. April–March cycle. */
function defaultCurrentFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
