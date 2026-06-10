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
import { z } from 'zod';
import {
  cashflowEvents,
  db,
  type CashflowFrequency,
  type CashflowSourceKind,
  type CashflowTaxTreatment,
} from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';

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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
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
          eq(cashflowEvents.userId, userId),
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

// Field-diff PATCH — every key optional; absent keys leave the row untouched.
// nullable() appears only where the handler previously tolerated null.
const patchSchema = z.object({
  name: z.string().optional(),
  sourceKind: z.enum(VALID_KINDS).optional(),
  sourceId: z.number().nullable().optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  amountRupees: z.number().finite().optional(),
  frequency: z.enum(VALID_FREQUENCIES).optional(),
  growthPctPerYear: z.number().finite().optional(),
  taxTreatment: z.enum(VALID_TAX_TREATMENTS).optional(),
  goalId: z.number().nullable().optional(),
  autoDerived: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
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
          eq(cashflowEvents.userId, userId),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const parsed = await parseBody(request, patchSchema);
    if (parsed.error) return parsed.error;
    const body = parsed.data;

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
          eq(cashflowEvents.userId, userId),
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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
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
          eq(cashflowEvents.userId, userId),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[cashflow-events/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
