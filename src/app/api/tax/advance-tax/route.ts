/**
 * Advance tax planner — Sprint 4 Phase 3.
 *
 * GET /api/tax/advance-tax?fy=2026-27
 *
 * Returns the 4 quarterly installments for the FY, auto-seeding rows
 * on first read. Each row carries:
 *   • due_date       — fixed by law (15 Jun / 15 Sep / 15 Dec / 15 Mar)
 *   • due_pct        — cumulative % of annual tax (15 / 45 / 75 / 100)
 *   • expectedDuePaisa = round(projectedAnnualTax × due_pct / 100)
 *   • paid_amount_paisa / paid_date / notes
 *   • status         — UPCOMING / DUE / PAID / OVERDUE
 *
 * Also returns the projected_annual_tax + a flag for the 234B/234C
 * underpayment warning (triggered if cumulative paid is >10% short
 * vs cumulative-due as of today).
 *
 * The projected annual tax comes from src/lib/finance/tax-projection.ts
 * which mirrors /api/tax/regime-compare's logic. We always pick the
 * RECOMMENDED regime's totalTax so the user is paying advance tax
 * against the regime they're likely to file under.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, advanceTaxInstallments } from '@/db';
import { auth } from '@/auth';
import { projectAnnualTax } from '@/lib/finance/tax-projection';
import { resolveTaxPaid } from '@/lib/finance/form16-tax-source';

/** Quarterly schedule fixed by Section 211 of the Income Tax Act. */
const SCHEDULE: Array<{ order: number; monthOfDueDay: number; isNextYear: boolean; pct: number }> = [
  { order: 1, monthOfDueDay: 6,  isNextYear: false, pct: 15 },
  { order: 2, monthOfDueDay: 9,  isNextYear: false, pct: 45 },
  { order: 3, monthOfDueDay: 12, isNextYear: false, pct: 75 },
  { order: 4, monthOfDueDay: 3,  isNextYear: true,  pct: 100 },
];

function fyStartYear(fy: string): number | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Build the canonical YYYY-MM-15 due date string for a slot. */
function dueDateFor(fy: string, slot: { monthOfDueDay: number; isNextYear: boolean }): string {
  const startYear = fyStartYear(fy)!;
  const year = slot.isNextYear ? startYear + 1 : startYear;
  return `${year}-${String(slot.monthOfDueDay).padStart(2, '0')}-15`;
}

/** Status: PAID if paid >= expected; OVERDUE if past due_date with shortfall;
 *  DUE if within 30 days of due_date; UPCOMING otherwise. */
function statusFor(
  paidPaisa: number,
  expectedPaisa: number,
  dueDate: string,
  today: Date,
): 'UPCOMING' | 'DUE' | 'PAID' | 'OVERDUE' {
  if (paidPaisa >= expectedPaisa && expectedPaisa > 0) return 'PAID';
  const due = new Date(dueDate + 'T23:59:59');
  const ms = due.getTime() - today.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 0) return 'OVERDUE';
  if (days <= 30) return 'DUE';
  return 'UPCOMING';
}

async function seedIfMissing(userId: string, fy: string): Promise<void> {
  if (!fyStartYear(fy)) return;
  const existing = await db
    .select({ id: advanceTaxInstallments.id, order: advanceTaxInstallments.installmentOrder })
    .from(advanceTaxInstallments)
    .where(and(eq(advanceTaxInstallments.userId, userId), eq(advanceTaxInstallments.fy, fy)));
  const seenOrders = new Set(existing.map((r) => r.order));
  const toInsert = SCHEDULE
    .filter((s) => !seenOrders.has(s.order))
    .map((s) => ({
      userId,
      fy,
      installmentOrder: s.order,
      dueDate: dueDateFor(fy, s),
      duePct: s.pct,
      paidAmountPaisa: 0,
    }));
  if (toInsert.length === 0) return;
  // The unique index on (user_id, fy, order) guards against races between
  // concurrent GETs seeding the same FY.
  await db.insert(advanceTaxInstallments).values(toInsert).onConflictDoNothing();
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });
    if (!fyStartYear(fy)) {
      return NextResponse.json({ error: 'fy must be YYYY-YY' }, { status: 400 });
    }

    const userId = session.user.id;
    await seedIfMissing(userId, fy);

    const [rows, projection, taxPaid] = await Promise.all([
      db
        .select()
        .from(advanceTaxInstallments)
        .where(
          and(eq(advanceTaxInstallments.userId, userId), eq(advanceTaxInstallments.fy, fy)),
        ),
      projectAnnualTax(userId, fy),
      resolveTaxPaid(userId, fy),
    ]);

    const projectedAnnualTaxPaisa = projection?.projectedAnnualTaxPaisa ?? 0;
    // Advance-tax obligation is on ASSESSED tax = total tax − tax deducted
    // at source. TDS (salary Part-A + 194x on receipts) is credited
    // automatically; only the residual is payable as advance tax. Without
    // this the card showed the full liability as "due" and raised a false
    // 234B/234C alarm for a salaried/professional filer whose employer and
    // payers already deducted most of the tax. Self-assessment payments are
    // NOT netted here — those are tracked per-installment via paid_amount.
    const tdsCreditedPaisa =
      (taxPaid?.salaryTds.valuePaisa ?? 0) + (taxPaid?.otherTdsPaisa ?? 0);
    const assessedTaxPaisa = Math.max(0, projectedAnnualTaxPaisa - tdsCreditedPaisa);
    const today = new Date();

    const sorted = rows.sort((a, b) => a.installmentOrder - b.installmentOrder);
    let cumulativePaid = 0;
    let cumulativeDueAsOfToday = 0;

    const installments = sorted.map((r) => {
      const expectedDuePaisa = Math.round((assessedTaxPaisa * r.duePct) / 100);
      const paid = r.paidAmountPaisa ?? 0;
      cumulativePaid += paid;
      // Only count this slot in cumulative-due if today has already crossed its due date
      if (new Date(r.dueDate + 'T23:59:59').getTime() <= today.getTime()) {
        cumulativeDueAsOfToday = Math.max(cumulativeDueAsOfToday, expectedDuePaisa);
      }
      return {
        id: r.id,
        installmentOrder: r.installmentOrder,
        dueDate: r.dueDate,
        duePct: r.duePct,
        expectedDuePaisa,
        paidAmountPaisa: paid,
        paidDate: r.paidDate,
        notes: r.notes,
        status: statusFor(paid, expectedDuePaisa, r.dueDate, today),
      };
    });

    const totalExpected = assessedTaxPaisa;
    const totalPaid = cumulativePaid;
    const pending = Math.max(0, totalExpected - totalPaid);

    // 234B/234C interest warning — fires when cumulative-paid is <90%
    // of cumulative-due as of today (govt tolerance is 90%).
    const shortfallPaisa = Math.max(0, cumulativeDueAsOfToday - totalPaid);
    const triggers234BC = cumulativeDueAsOfToday > 0
      ? totalPaid < cumulativeDueAsOfToday * 0.9
      : false;

    return NextResponse.json({
      fy,
      projectedAnnualTaxPaisa,
      // TDS already deducted at source + the residual advance-tax base.
      tdsCreditedPaisa,
      assessedTaxPaisa,
      recommendedRegime: projection?.recommendation ?? null,
      installments,
      totals: {
        expectedPaisa: totalExpected,
        paidPaisa: totalPaid,
        pendingPaisa: pending,
        cumulativeDueAsOfTodayPaisa: cumulativeDueAsOfToday,
        shortfallPaisa,
        triggers234BC,
      },
    });
  } catch (err) {
    console.error('[tax/advance-tax GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
