/**
 * Cashflow Events — single-row GET / PATCH / DELETE.
 *
 * PATCH semantics:
 *   • Field-diff — only keys present in the body are touched.
 *   • Setting `autoDerived: false` is the "promote to manual override"
 *     gesture — subsequent /derive calls will skip this row because
 *     the unique (user_id, source_kind, source_id) constraint already
 *     holds and ON CONFLICT DO NOTHING wins.
 *   • Money fields arrive in rupees, stored in paisa.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  cashflowEvents,
  db,
  type CashflowFrequency,
  type CashflowSourceKind,
  type CashflowTaxTreatment,
} from '@/db';
import { auth } from '@/auth';

const VALID_KINDS: CashflowSourceKind[] = [
  'INSURANCE_MATURITY', 'ANNUITY', 'PENSION', 'NPS_LUMPSUM', 'NPS_ANNUITY',
  'PPF_MATURITY', 'SSY_MATURITY', 'NSC_MATURITY', 'KVP_MATURITY',
  'RENTAL', 'SALARY', 'BUSINESS', 'INHERITANCE', 'OTHER',
];
const VALID_FREQUENCIES: CashflowFrequency[] = ['ONE_TIME', 'MONTHLY', 'YEARLY'];
const VALID_TAX_TREATMENTS: CashflowTaxTreatment[] = ['TAX_FREE', 'TAXABLE', 'TDS'];

interface Params {
  params: Promise<{ id: string }>;
}

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(cashflowEvents)
      .where(
        and(
          eq(cashflowEvents.id, numericId),
          eq(cashflowEvents.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ event: rows[0] });
  } catch (err) {
    console.error('[cashflow-events/:id GET]', err);
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
  }
}

interface PatchBody {
  name?: string;
  sourceKind?: CashflowSourceKind;
  sourceId?: number | null;
  startDate?: string;
  endDate?: string | null;
  amountRupees?: number;
  frequency?: CashflowFrequency;
  growthPctPerYear?: number;
  taxTreatment?: CashflowTaxTreatment;
  goalId?: number | null;
  autoDerived?: boolean;
  notes?: string | null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db
      .select()
      .from(cashflowEvents)
      .where(
        and(
          eq(cashflowEvents.id, numericId),
          eq(cashflowEvents.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    if (body.sourceKind !== undefined && !VALID_KINDS.includes(body.sourceKind)) {
      return NextResponse.json({ error: 'Invalid sourceKind' }, { status: 400 });
    }
    if (body.frequency !== undefined && !VALID_FREQUENCIES.includes(body.frequency)) {
      return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 });
    }
    if (body.taxTreatment !== undefined && !VALID_TAX_TREATMENTS.includes(body.taxTreatment)) {
      return NextResponse.json({ error: 'Invalid taxTreatment' }, { status: 400 });
    }

    const update: Partial<typeof cashflowEvents.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (body.sourceKind !== undefined) update.sourceKind = body.sourceKind;
    if (body.sourceId !== undefined) update.sourceId = body.sourceId;
    if (typeof body.startDate === 'string' && body.startDate) update.startDate = body.startDate;
    if (body.endDate !== undefined) update.endDate = body.endDate;
    const amount = rupeesToPaisa(body.amountRupees);
    if (amount !== undefined) update.amountPaisa = amount;
    if (body.frequency !== undefined) update.frequency = body.frequency;
    if (typeof body.growthPctPerYear === 'number' && Number.isFinite(body.growthPctPerYear)) {
      update.growthPctPerYear = body.growthPctPerYear;
    }
    if (body.taxTreatment !== undefined) update.taxTreatment = body.taxTreatment;
    if (body.goalId !== undefined) update.goalId = body.goalId;
    if (typeof body.autoDerived === 'boolean') update.autoDerived = body.autoDerived;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(cashflowEvents)
      .set(update)
      .where(
        and(
          eq(cashflowEvents.id, numericId),
          eq(cashflowEvents.userId, session.user.id),
        ),
      )
      .returning();
    return NextResponse.json({ event: result[0] });
  } catch (err) {
    console.error('[cashflow-events/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db
      .delete(cashflowEvents)
      .where(
        and(
          eq(cashflowEvents.id, numericId),
          eq(cashflowEvents.userId, session.user.id),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[cashflow-events/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
