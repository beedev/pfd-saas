/**
 * GET /api/income/summary — aggregated income view for the current user.
 *
 * Sprint 3 Phase 2 (initial) + Sprint 5.3 (historical rental track).
 * Reads from existing tables — no new schema except the is_tax_exempt
 * / tax_section additions on other_sources_income landed in migration
 * 0009, and rental_history landed in 0027.
 *
 * Returns:
 *   currentFy            string         e.g. "2026-27"
 *   stream:
 *     salary             { count, totalPaisa }
 *     otherTaxable       { count, totalPaisa }
 *     otherExempt        { count, totalPaisa }
 *     rental             { count, totalPaisa, source }
 *                        // source='history'      → from rental_history
 *                        // source='current_rate' → from monthly_rent × 12 fallback
 *     capitalGains       { ltcgPaisa, stcgPaisa, totalPaisa }
 *   totalsPaisa: { all, taxable, exempt }
 *   trend: [{ fy, salaryPaisa, freelancePaisa, otherPaisa, rentalPaisa, cgPaisa, totalPaisa }]
 *     • last 5 FYs (newest first)
 *     • rentalPaisa: number | null — null means "no rental_history rows
 *       for that FY" so the UI can render "—" instead of a misleading ₹0.
 *       The current FY uses history if present, else the monthly_rent
 *       fallback (matches the stream.rental block).
 */

import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import {
  db,
  capitalGains,
  invoices,
  otherSourcesIncome,
  realEstate,
  rentalHistory,
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

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const userId = session.user.id;
  // Accept ?fy=YYYY-YY to view prior-year roll-ups. Defaults to the
  // current Indian FY. Validate format strictly — a bad value would
  // silently return an empty roll-up which looks like a bug.
  const fyParam = new URL(request.url).searchParams.get('fy');
  const fy = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : currentFy();

  try {
    const [salaries, others, gains, properties, invs, rentalRows] = await Promise.all([
      db.select().from(salaryIncome).where(eq(salaryIncome.userId, userId)).orderBy(desc(salaryIncome.financialYear)),
      db.select().from(otherSourcesIncome).where(eq(otherSourcesIncome.userId, userId)).orderBy(desc(otherSourcesIncome.financialYear)),
      db.select().from(capitalGains).where(eq(capitalGains.userId, userId)).orderBy(desc(capitalGains.saleDate)),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      // Finalised GST invoices = freelance / consulting / business income.
      // taxable_amount (not total_amount) is the actual earnings; total
      // includes GST collected on behalf of govt.
      db.select().from(invoices).where(eq(invoices.userId, userId)).orderBy(desc(invoices.invoiceDate)),
      // Sprint 5.3 — per-FY historical rental track. Backfills the YoY
      // table that used to drop rental entirely.
      db.select().from(rentalHistory).where(eq(rentalHistory.userId, userId)),
    ]);

    // Current FY aggregates
    const salaryThisFy = salaries.filter((r) => r.financialYear === fy);
    const otherThisFy = others.filter((r) => r.financialYear === fy);
    const otherTaxableRows = otherThisFy.filter((r) => !r.isTaxExempt);
    const otherExemptRows = otherThisFy.filter((r) => r.isTaxExempt);

    const salaryTotal = salaryThisFy.reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
    const otherTaxableTotal = otherTaxableRows.reduce((s, r) => s + r.amountPaisa, 0);
    const otherExemptTotal = otherExemptRows.reduce((s, r) => s + r.amountPaisa, 0);

    // Rental — history-first, current-rate fallback.
    //   • If any rental_history rows exist for the *current* FY, sum
    //     them across all properties → source='history'.
    //   • Otherwise fall back to today's monthly_rent × 12 per tenanted
    //     property → source='current_rate'. This keeps brand-new users
    //     (zero history) seeing their rental income immediately.
    const rentalRowsCurrentFy = rentalRows.filter((r) => r.fy === fy);
    let rentalTotal: number;
    let rentalCount: number;
    let rentalSource: 'history' | 'current_rate';
    if (rentalRowsCurrentFy.length > 0) {
      rentalTotal = rentalRowsCurrentFy.reduce((s, r) => s + (r.rentReceivedPaisa ?? 0), 0);
      rentalCount = rentalRowsCurrentFy.length;
      rentalSource = 'history';
    } else {
      const tenantedProps = properties.filter((p) => (p.monthlyRent ?? 0) > 0);
      rentalTotal = tenantedProps.reduce((s, p) => s + (p.monthlyRent ?? 0) * 12, 0);
      rentalCount = tenantedProps.length;
      rentalSource = 'current_rate';
    }

    const cgThisFy = gains.filter((g) => dateToFy(g.saleDate) === fy);
    const ltcg = cgThisFy
      .filter((g) => g.holdingPeriod === 'LTCG')
      .reduce((s, g) => s + (g.taxableGain ?? 0), 0);
    const stcg = cgThisFy
      .filter((g) => g.holdingPeriod === 'STCG')
      .reduce((s, g) => s + (g.taxableGain ?? 0), 0);

    // Finalised invoices issued in the current FY. Status='FINAL' filters
    // out drafts. taxableAmount = pre-GST income.
    const invsThisFy = invs.filter((i) => i.status === 'FINAL' && dateToFy(i.invoiceDate) === fy);
    const freelanceTotal = invsThisFy.reduce((s, i) => s + (i.taxableAmount ?? 0), 0);

    const allTotal = salaryTotal + otherTaxableTotal + otherExemptTotal + rentalTotal + ltcg + stcg + freelanceTotal;
    const taxableTotal = salaryTotal + otherTaxableTotal + rentalTotal + ltcg + stcg + freelanceTotal;

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
      const free = invs
        .filter((i) => i.status === 'FINAL' && dateToFy(i.invoiceDate) === targetFy)
        .reduce((s, i) => s + (i.taxableAmount ?? 0), 0);
      // Rental — trend uses rental_history exclusively for prior FYs.
      // For the current FY we re-use whichever source the stream block
      // picked so the two stay in sync.
      const rentalForFyHistory = rentalRows.filter((r) => r.fy === targetFy);
      let rentalPaisa: number | null;
      if (rentalForFyHistory.length > 0) {
        rentalPaisa = rentalForFyHistory.reduce((s, r) => s + (r.rentReceivedPaisa ?? 0), 0);
      } else if (targetFy === fy && rentalSource === 'current_rate') {
        // No history for the *current* FY → reuse the current-rate fallback
        // total. (Pre-computed above; safe to reference.)
        rentalPaisa = rentalTotal;
      } else {
        // No history for a prior FY → render "—" (null) instead of 0,
        // which would falsely look like "user had no rental that year".
        rentalPaisa = null;
      }
      return {
        fy: targetFy,
        salaryPaisa: sal,
        freelancePaisa: free,
        otherPaisa: oth,
        rentalPaisa,
        cgPaisa: cg,
        totalPaisa: sal + free + oth + (rentalPaisa ?? 0) + cg,
      };
    });

    return NextResponse.json({
      currentFy: fy,
      stream: {
        salary: { count: salaryThisFy.length, totalPaisa: salaryTotal },
        freelance: { count: invsThisFy.length, totalPaisa: freelanceTotal },
        otherTaxable: { count: otherTaxableRows.length, totalPaisa: otherTaxableTotal },
        otherExempt: { count: otherExemptRows.length, totalPaisa: otherExemptTotal },
        rental: { count: rentalCount, totalPaisa: rentalTotal, source: rentalSource },
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
