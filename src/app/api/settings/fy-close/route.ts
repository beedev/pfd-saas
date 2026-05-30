import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import {
  db,
  businessProfile,
  invoices,
  taxDeductions,
  insurancePolicies,
  budgetEntries,
  budgetCategories,
  fyCloseStatus,
} from '@/db';

interface ChecklistItem {
  label: string;
  category: string;  // key for locking
  status: 'done' | 'partial' | 'pending';
  detail: string;
  isLocked: boolean;
}

function fyDates(fy: string): { start: string; end: string } {
  const startYear = parseInt(fy.split('-')[0], 10);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    if (!fy) {
      return NextResponse.json({ error: 'fy parameter required' }, { status: 400 });
    }

    const { start, end } = fyDates(fy);
    const checklist: ChecklistItem[] = [];

    // Load lock status for this FY
    const lockRows = await db
      .select()
      .from(fyCloseStatus)
      .where(eq(fyCloseStatus.financialYear, fy));
    const locks = new Map(lockRows.map((r) => [r.category, r.isLocked ?? false]));
    const isLocked = (cat: string) => locks.get(cat) ?? false;

    // 1. GST Invoices — any FINAL invoices in this FY?
    const allInvoices = await db
      .select({ id: invoices.id, status: invoices.status, invoiceDate: invoices.invoiceDate })
      .from(invoices)
      .where(and(gte(invoices.invoiceDate, start), lte(invoices.invoiceDate, end)));

    const finalInvoices = allInvoices.filter((i) => i.status === 'FINAL' || i.status === 'FILED');
    const draftInvoices = allInvoices.filter((i) => i.status === 'DRAFT');

    if (allInvoices.length === 0) {
      checklist.push({ label: 'GST Invoices', category: 'gst_invoices', status: 'pending', detail: 'No invoices for this FY', isLocked: isLocked('gst_invoices') });
    } else if (draftInvoices.length > 0) {
      checklist.push({
        label: 'GST Invoices', category: 'gst_invoices',
        status: 'partial',
        detail: `${finalInvoices.length} finalized, ${draftInvoices.length} still in draft`, isLocked: isLocked('gst_invoices'),
      });
    } else {
      checklist.push({
        label: 'GST Invoices', category: 'gst_invoices',
        status: 'done',
        detail: `All ${finalInvoices.length} invoices finalized`, isLocked: isLocked('gst_invoices'),
      });
    }

    // 2. GSTR-1 filed for all months? (check invoices have returnPeriod coverage)
    const months: string[] = [];
    const startYear = parseInt(fy.split('-')[0], 10);
    for (let m = 4; m <= 12; m++) months.push(`${String(m).padStart(2, '0')}${startYear}`);
    for (let m = 1; m <= 3; m++) months.push(`${String(m).padStart(2, '0')}${startYear + 1}`);

    const monthsWithInvoices = new Set(allInvoices.map((i) => i.invoiceDate.substring(5, 7) + i.invoiceDate.substring(0, 4)));
    // Simplified: check if there are filed invoices
    const filedInvoices = allInvoices.filter((i) => i.status === 'FILED');
    if (allInvoices.length === 0) {
      checklist.push({ label: 'GSTR-1 Filing', category: 'gstr1', status: 'pending', detail: 'No invoices to file', isLocked: isLocked('gstr1') });
    } else if (filedInvoices.length === allInvoices.length) {
      checklist.push({ label: 'GSTR-1 Filing', category: 'gstr1', status: 'done', detail: 'All invoices marked as filed', isLocked: isLocked('gstr1') });
    } else {
      checklist.push({
        label: 'GSTR-1 Filing', category: 'gstr1',
        status: filedInvoices.length > 0 ? 'partial' : 'pending',
        detail: `${filedInvoices.length}/${allInvoices.length} invoices filed`, isLocked: isLocked('gstr1'),
      });
    }

    // 3. Tax deductions entered?
    const deductions = await db
      .select({ id: taxDeductions.id, section: taxDeductions.section })
      .from(taxDeductions)
      .where(eq(taxDeductions.financialYear, fy));

    const sections = new Set(deductions.map((d) => d.section));
    if (deductions.length === 0) {
      checklist.push({ label: 'Tax Deductions (Section 80)', category: 'tax_deductions', status: 'pending', detail: 'No deductions entered for this FY', isLocked: isLocked('tax_deductions') });
    } else {
      checklist.push({
        label: 'Tax Deductions (Section 80)', category: 'tax_deductions',
        status: sections.size >= 3 ? 'done' : 'partial',
        detail: `${deductions.length} entries across ${sections.size} sections`, isLocked: isLocked('tax_deductions'),
      });
    }

    // 4. Insurance premiums paid?
    const activePolicies = await db
      .select({
        id: insurancePolicies.id,
        policyNumber: insurancePolicies.policyNumber,
        lastPremiumPaidDate: insurancePolicies.lastPremiumPaidDate,
        nextPremiumDueDate: insurancePolicies.nextPremiumDueDate,
      })
      .from(insurancePolicies)
      .where(eq(insurancePolicies.status, 'ACTIVE'));

    const paidInFy = activePolicies.filter(
      (p) => p.lastPremiumPaidDate && p.lastPremiumPaidDate >= start && p.lastPremiumPaidDate <= end,
    );
    const overdue = activePolicies.filter(
      (p) => p.nextPremiumDueDate && p.nextPremiumDueDate <= end && p.nextPremiumDueDate < new Date().toISOString().slice(0, 10),
    );

    if (activePolicies.length === 0) {
      checklist.push({ label: 'Insurance Premiums', category: 'insurance', status: 'done', detail: 'No active policies', isLocked: isLocked('insurance') });
    } else if (overdue.length > 0) {
      checklist.push({
        label: 'Insurance Premiums', category: 'insurance',
        status: 'partial',
        detail: `${paidInFy.length} paid this FY, ${overdue.length} overdue`, isLocked: isLocked('insurance'),
      });
    } else {
      checklist.push({
        label: 'Insurance Premiums', category: 'insurance',
        status: paidInFy.length > 0 ? 'done' : 'partial',
        detail: `${paidInFy.length} premiums paid this FY`, isLocked: isLocked('insurance'),
      });
    }

    // 5. Budget complete for all 12 months?
    const budgetRows = await db
      .select({ period: budgetEntries.period })
      .from(budgetEntries)
      .where(
        sql`${budgetEntries.period} IN (${sql.join(
          months.map((m) => sql`${m}`),
          sql`, `,
        )})`,
      );

    const budgetMonths = new Set(budgetRows.map((b) => b.period));
    if (budgetMonths.size === 0) {
      checklist.push({ label: 'Budget', category: 'budget', status: 'pending', detail: 'No budget entries for this FY', isLocked: isLocked('budget') });
    } else if (budgetMonths.size >= 12) {
      checklist.push({ label: 'Budget', category: 'budget', status: 'done', detail: 'All 12 months have entries', isLocked: isLocked('budget') });
    } else {
      checklist.push({
        label: 'Budget', category: 'budget',
        status: 'partial',
        detail: `${budgetMonths.size}/12 months have budget entries`, isLocked: isLocked('budget'),
      });
    }

    // 6. Business profile FY updated?
    const profile = await db.select().from(businessProfile).limit(1);
    const profileFy = profile[0]?.financialYear || '';
    const nextFyStart = parseInt(fy.split('-')[0], 10) + 1;
    const nextFy = `${nextFyStart}-${String((nextFyStart + 1) % 100).padStart(2, '0')}`;
    const fyUpdated = profileFy === nextFy || profileFy > fy;

    checklist.push({
      label: 'Business Profile', category: 'business_profile',
      status: fyUpdated ? 'done' : 'pending',
      detail: fyUpdated
        ? `Financial year set to ${profileFy}`
        : `Still set to ${profileFy || 'not set'} — should be ${nextFy}`,
      isLocked: isLocked('business_profile'),
    });

    const readyToClose = checklist.every((c) => c.status === 'done');
    const isClosed = fyUpdated && readyToClose;

    return NextResponse.json({
      fy,
      checklist,
      readyToClose,
      isClosed,
    });
  } catch (err) {
    console.error('[fy-close GET]', err);
    return NextResponse.json({ error: 'Failed to load FY status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fy } = body;
    if (!fy) {
      return NextResponse.json({ error: 'fy required' }, { status: 400 });
    }

    const startYear = parseInt(fy.split('-')[0], 10);
    const nextFy = `${startYear + 1}-${String((startYear + 2) % 100).padStart(2, '0')}`;

    // Update business profile to next FY
    await db
      .update(businessProfile)
      .set({
        financialYear: nextFy,
        invoiceStartNumber: 1, // reset invoice numbering
        updatedAt: new Date(),
      })
      .where(eq(businessProfile.id, 1));

    return NextResponse.json({
      success: true,
      previousFy: fy,
      newFy: nextFy,
      message: `FY ${fy} closed. Business profile updated to ${nextFy}. Invoice numbering reset.`,
    });
  } catch (err) {
    console.error('[fy-close POST]', err);
    return NextResponse.json({ error: 'Failed to close FY' }, { status: 500 });
  }
}

/** PATCH — lock or unlock a category for a FY */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { fy, category, lock } = body;

    if (!fy || !category || lock === undefined) {
      return NextResponse.json({ error: 'fy, category, and lock (boolean) required' }, { status: 400 });
    }

    // Upsert
    const existing = await db
      .select()
      .from(fyCloseStatus)
      .where(and(eq(fyCloseStatus.financialYear, fy), eq(fyCloseStatus.category, category)));

    if (existing.length > 0) {
      await db
        .update(fyCloseStatus)
        .set({
          isLocked: lock,
          lockedAt: lock ? new Date() : null,
        })
        .where(eq(fyCloseStatus.id, existing[0].id));
    } else {
      await db.insert(fyCloseStatus).values({
        financialYear: fy,
        category,
        isLocked: lock,
        lockedAt: lock ? new Date() : null,
      });
    }

    return NextResponse.json({
      success: true,
      message: `${category} ${lock ? 'locked' : 'unlocked'} for FY ${fy}`,
    });
  } catch (err) {
    console.error('[fy-close PATCH]', err);
    return NextResponse.json({ error: 'Failed to update lock' }, { status: 500 });
  }
}
