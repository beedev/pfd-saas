/**
 * ITR-form-specific export — Sprint 4 Phase 4.
 *
 * GET /api/tax/itr-export/:form?fy=2026-27
 *   :form ∈ ITR-1 | ITR-2 | ITR-3 | ITR-4
 *
 * For ITR-1: returns a compact JSON summary
 *   { fy, salary: { gross, taxable, tds }, deductions: { 80C, 80D, others },
 *     totalIncome, recommended }
 * suitable for cross-checking against a Sahaj filing.
 *
 * For ITR-2 / ITR-3 / ITR-4: delegates to the existing /api/tax/itr3
 * filing-pack — those forms all require Schedule S + TDS + Schedule
 * 112A / Schedule BP detail which the ITR-3 module already generates.
 * We pass back a 200 with a redirect hint so the client can switch
 * routes; this keeps us from copy/pasting the ZIP generator just to
 * stamp a different label on it.
 *
 * Implementation note: the existing /tax/filing-pack endpoint already
 * builds a ZIP for "ITR-3 era" filers. Phase 4 simplification: we
 * reuse it as-is for ITR-2/3/4 and only produce a bespoke summary
 * for ITR-1 (which actually has a different shape — Sahaj fits on
 * a one-pager).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  taxDeductions,
  otherSourcesIncome,
  realEstate,
  tdsCredits,
} from '@/db';
import { auth } from '@/auth';

type ItrForm = 'ITR-1' | 'ITR-2' | 'ITR-3' | 'ITR-4';
const VALID: ItrForm[] = ['ITR-1', 'ITR-2', 'ITR-3', 'ITR-4'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ form: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { form } = await params;
    if (!VALID.includes(form as ItrForm)) {
      return NextResponse.json(
        { error: 'form must be ITR-1 / ITR-2 / ITR-3 / ITR-4' },
        { status: 400 },
      );
    }
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const userId = session.user.id;

    // For ITR-2/3/4 — point the client at the existing ZIP filing-pack.
    if (form !== 'ITR-1') {
      return NextResponse.json({
        form,
        delegate: '/api/tax/filing-pack/generate',
        message:
          'Use the existing filing-pack ZIP generator for ITR-2/3/4 — it covers Schedule S, TDS, 112A and Schedule BP needed across these forms.',
      });
    }

    // ITR-1 (Sahaj) — bespoke compact summary. The form is one pager
    // and only needs: salary breakdown, deductions, rental, interest,
    // total income, TDS.
    const [salaries, deductions, others, properties, tdsRows] = await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
      db
        .select()
        .from(taxDeductions)
        .where(and(eq(taxDeductions.userId, userId), eq(taxDeductions.financialYear, fy))),
      db
        .select()
        .from(otherSourcesIncome)
        .where(
          and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy)),
        ),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db
        .select()
        .from(tdsCredits)
        .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy))),
    ]);

    const totalGrossSalary = salaries.reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
    const totalTaxableSalary = salaries.reduce((s, r) => s + (r.taxableSalaryPaisa ?? 0), 0);
    const totalSalaryTds = salaries.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

    const byBucket: Record<string, number> = {};
    for (const d of deductions) {
      const key = (d.section ?? 'OTHER').replace('SECTION_', '');
      byBucket[key] = (byBucket[key] ?? 0) + (d.amountPaisa ?? 0);
    }

    const rentalAnnual = properties.reduce((s, r) => s + (r.monthlyRent ?? 0) * 12, 0);
    const otherIncome = others
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
    const nonSalaryTds = tdsRows.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

    const totalIncomePaisa =
      totalGrossSalary + rentalAnnual + otherIncome;

    return NextResponse.json({
      form: 'ITR-1',
      fy,
      sahajSummary: {
        salary: {
          employerCount: salaries.length,
          grossPaisa: totalGrossSalary,
          taxablePaisa: totalTaxableSalary,
          tdsPaisa: totalSalaryTds,
        },
        houseProperty: {
          count: properties.length,
          annualRentPaisa: rentalAnnual,
        },
        otherSourcesPaisa: otherIncome,
        deductionsBySection: byBucket,
        totalDeductionsPaisa: Object.values(byBucket).reduce((s, v) => s + v, 0),
        nonSalaryTdsPaisa: nonSalaryTds,
        totalIncomePaisa,
      },
    });
  } catch (err) {
    console.error('[tax/itr-export/:form GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
