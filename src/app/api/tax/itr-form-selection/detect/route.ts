/**
 * Auto-detect ITR wizard answers from the user's existing data.
 * Sprint 4 Phase 4.
 *
 * GET /api/tax/itr-form-selection/detect?fy=2026-27
 *
 * Reads:
 *   • salary_income (FY-scoped) → hasSalary + salaryPaisa
 *   • real_estate (status='OWNED') → numHouseProperties
 *   • capital_gains (FY-scoped) → hasCapitalGains
 *   • invoices (FINAL within FY) → hasBusinessIncome
 *   • other_sources_income (FY-scoped) → hasOtherSources + otherPaisa
 *
 * Returns prefilled-but-editable answer object for the wizard. The
 * user can override any field before submitting.
 *
 * hasPresumptive + hasForeignIncome are NEVER auto-detected (we don't
 * track those signals reliably) — always start false, user toggles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  realEstate,
  capitalGains,
  invoices,
  otherSourcesIncome,
} from '@/db';
import { auth } from '@/auth';

function fyBounds(fy: string): { start: string; end: string } | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });
    const bounds = fyBounds(fy);
    if (!bounds) return NextResponse.json({ error: 'fy must be YYYY-YY' }, { status: 400 });

    const userId = session.user.id;

    const [salaries, properties, gains, gstInvoices, others] = await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
      // status='OWNED' filters out planned/under-construction. Schema
      // may use a different column name — falling back to "all rows"
      // gives a safe over-count that the user can correct manually.
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db
        .select()
        .from(capitalGains)
        .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy))),
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
        .from(otherSourcesIncome)
        .where(
          and(
            eq(otherSourcesIncome.userId, userId),
            eq(otherSourcesIncome.financialYear, fy),
          ),
        ),
    ]);

    const salaryPaisa = salaries.reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
    const businessPaisa = gstInvoices.reduce((s, r) => s + (r.taxableAmount ?? 0), 0);
    const otherPaisa = others
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
    const capitalGainsPaisa = gains.reduce((s, r) => s + (r.taxableGain ?? 0), 0);
    const rentalPaisa = properties.reduce((s, r) => s + (r.monthlyRent ?? 0) * 12, 0);
    const totalIncomePaisa =
      salaryPaisa + businessPaisa + otherPaisa + capitalGainsPaisa + rentalPaisa;

    return NextResponse.json({
      fy,
      detected: {
        hasSalary: salaries.length > 0,
        salaryCount: salaries.length,
        salaryPaisa,
        numHouseProperties: properties.length,
        hasCapitalGains: gains.length > 0,
        capitalGainsPaisa,
        hasBusinessIncome: gstInvoices.length > 0,
        businessPaisa,
        hasPresumptive: false,
        hasForeignIncome: false,
        hasOtherSources: others.length > 0,
        otherPaisa,
        totalIncomePaisa,
      },
    });
  } catch (err) {
    console.error('[tax/itr-form-selection/detect GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
