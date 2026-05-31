/**
 * GET /api/income/summary — aggregated income view for the current user.
 *
 * Sprint 3 Phase 2. Reads from existing tables — no new schema except
 * the is_tax_exempt / tax_section additions on other_sources_income
 * landed in migration 0009.
 *
 * Returns:
 *   currentFy            string         e.g. "2026-27"
 *   stream:
 *     salary             { count, totalPaisa }
 *     otherTaxable       { count, totalPaisa }
 *     otherExempt        { count, totalPaisa }
 *     rental             { count, totalPaisa }   // sum(monthly_rent × 12)
 *     capitalGains       { ltcgPaisa, stcgPaisa, totalPaisa }
 *   totalsPaisa: { all, taxable, exempt }
 *   trend: [{ fy, salaryPaisa, otherPaisa, cgPaisa, totalPaisa }]   // last 5 FYs
 */

import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import {
  db,
  capitalGains,
  otherSourcesIncome,
  realEstate,
  salaryIncome,
} from '@/db';

function currentFy(): string {
  const d = new Date();
  const fy = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

function fyShift(fy: string, delta: number): string {
  const start = parseInt(fy.split('-')[0], 10) + delta;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function dateToFy(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 7) return null;
  const y = parseInt(iso.substring(0, 4), 10);
  const m = parseInt(iso.substring(5, 7), 10);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const userId = session.user.id;
  const fy = currentFy();

  try {
    const [salaries, others, gains, properties] = await Promise.all([
      db.select().from(salaryIncome).where(eq(salaryIncome.userId, userId)).orderBy(desc(salaryIncome.financialYear)),
      db.select().from(otherSourcesIncome).where(eq(otherSourcesIncome.userId, userId)).orderBy(desc(otherSourcesIncome.financialYear)),
      db.select().from(capitalGains).where(eq(capitalGains.userId, userId)).orderBy(desc(capitalGains.saleDate)),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
    ]);

    // Current FY aggregates
    const salaryThisFy = salaries.filter((r) => r.financialYear === fy);
    const otherThisFy = others.filter((r) => r.financialYear === fy);
    const otherTaxableRows = otherThisFy.filter((r) => !r.isTaxExempt);
    const otherExemptRows = otherThisFy.filter((r) => r.isTaxExempt);

    const salaryTotal = salaryThisFy.reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
    const otherTaxableTotal = otherTaxableRows.reduce((s, r) => s + r.amountPaisa, 0);
    const otherExemptTotal = otherExemptRows.reduce((s, r) => s + r.amountPaisa, 0);

    const tenantedProps = properties.filter((p) => (p.monthlyRent ?? 0) > 0);
    const rentalTotal = tenantedProps.reduce((s, p) => s + (p.monthlyRent ?? 0) * 12, 0);

    const cgThisFy = gains.filter((g) => dateToFy(g.saleDate) === fy);
    const ltcg = cgThisFy
      .filter((g) => g.holdingPeriod === 'LTCG')
      .reduce((s, g) => s + (g.taxableGain ?? 0), 0);
    const stcg = cgThisFy
      .filter((g) => g.holdingPeriod === 'STCG')
      .reduce((s, g) => s + (g.taxableGain ?? 0), 0);

    const allTotal = salaryTotal + otherTaxableTotal + otherExemptTotal + rentalTotal + ltcg + stcg;
    const taxableTotal = salaryTotal + otherTaxableTotal + rentalTotal + ltcg + stcg;

    // 5-FY trend
    const fyList = Array.from({ length: 5 }, (_, i) => fyShift(fy, -i));
    const trend = fyList.map((targetFy) => {
      const sal = salaries
        .filter((r) => r.financialYear === targetFy)
        .reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
      const oth = others
        .filter((r) => r.financialYear === targetFy)
        .reduce((s, r) => s + r.amountPaisa, 0);
      const cg = gains
        .filter((g) => dateToFy(g.saleDate) === targetFy)
        .reduce((s, g) => s + (g.taxableGain ?? 0), 0);
      return {
        fy: targetFy,
        salaryPaisa: sal,
        otherPaisa: oth,
        cgPaisa: cg,
        totalPaisa: sal + oth + cg,
      };
    });

    return NextResponse.json({
      currentFy: fy,
      stream: {
        salary: { count: salaryThisFy.length, totalPaisa: salaryTotal },
        otherTaxable: { count: otherTaxableRows.length, totalPaisa: otherTaxableTotal },
        otherExempt: { count: otherExemptRows.length, totalPaisa: otherExemptTotal },
        rental: { count: tenantedProps.length, totalPaisa: rentalTotal },
        capitalGains: { ltcgPaisa: ltcg, stcgPaisa: stcg, totalPaisa: ltcg + stcg },
      },
      totalsPaisa: { all: allTotal, taxable: taxableTotal, exempt: otherExemptTotal },
      trend,
    });
  } catch (err) {
    console.error('[income/summary]', err);
    return NextResponse.json({ error: 'Failed to load income summary' }, { status: 500 });
  }
}
