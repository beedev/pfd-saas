/**
 * Cashflow Events — list + create (manual).
 *
 * GET   /api/cashflow-events?year=YYYY&source_kind=X
 *   List all events for the user. Optional filters:
 *     • year=YYYY        — only events active during that calendar year
 *                          (start_date ≤ Dec 31 of year AND
 *                           (end_date is null OR end_date ≥ Jan 1 of year))
 *     • source_kind=X    — exact match on source_kind
 *   Ordered by start_date ascending.
 *
 * POST  /api/cashflow-events
 *   Create a manual event (auto_derived=false). Body is in rupees;
 *   we store paisa. Useful for inheritance, side-gigs, expected
 *   bonuses that the derivation layer can't infer.
 *
 * Money on the wire: RUPEES. Server multiplies by 100 to paisa.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
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

/**
 * Walk the Drizzle error cause chain to find the underlying SQLSTATE
 * code so we can map unique violations to 409. Same shape as the rest
 * of the API.
 */
function findPgError(err: unknown): { code?: string; detail?: string } {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const c = cur as { code?: unknown; detail?: unknown; cause?: unknown };
      if (typeof c.code === 'string') {
        return {
          code: c.code,
          detail: typeof c.detail === 'string' ? c.detail : '',
        };
      }
      cur = c.cause;
    } else {
      break;
    }
  }
  return {};
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const kindParam = searchParams.get('source_kind');

    const filters = [eq(cashflowEvents.userId, userId)];
    if (yearParam) {
      const y = Number(yearParam);
      if (!Number.isInteger(y) || y < 1900 || y > 2200) {
        return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
      }
      const yearStart = `${y}-01-01`;
      const yearEnd = `${y}-12-31`;
      // Event is active in year Y if it started on or before Dec 31 AND
      // (it has no end date OR ends on or after Jan 1).
      filters.push(lte(cashflowEvents.startDate, yearEnd));
      filters.push(
        or(
          isNull(cashflowEvents.endDate),
          gte(cashflowEvents.endDate, yearStart),
        )!,
      );
    }
    if (kindParam) {
      if (!VALID_KINDS.includes(kindParam as CashflowSourceKind)) {
        return NextResponse.json({ error: 'Invalid source_kind' }, { status: 400 });
      }
      filters.push(eq(cashflowEvents.sourceKind, kindParam as CashflowSourceKind));
    }

    const events = await db
      .select()
      .from(cashflowEvents)
      .where(and(...filters))
      .orderBy(asc(cashflowEvents.startDate));

    return NextResponse.json({ events });
  } catch (err) {
    console.error('[cashflow-events GET]', err);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().refine((s) => s.trim().length > 0, 'name is required'),
  sourceKind: z.enum(VALID_KINDS),
  sourceId: z.number().nullable().optional(),
  startDate: z.string().min(1),
  endDate: z.string().nullable().optional(),
  amountRupees: z.number().finite(),
  frequency: z.enum(VALID_FREQUENCIES),
  growthPctPerYear: z.number().finite().nullable().optional(),
  // null was tolerated pre-zod (fell through to the TAXABLE default).
  taxTreatment: z.enum(VALID_TAX_TREATMENTS).nullable().optional(),
  goalId: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const parsed = await parseBody(request, createSchema);
    if (parsed.error) return parsed.error;
    const body = parsed.data;

    const result = await db
      .insert(cashflowEvents)
      .values({
        userId: userId,
        name: body.name.trim(),
        sourceKind: body.sourceKind,
        sourceId: body.sourceId ?? null,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        amountPaisa: Math.round(body.amountRupees * 100),
        frequency: body.frequency,
        growthPctPerYear: body.growthPctPerYear ?? 0,
        taxTreatment: body.taxTreatment ?? 'TAXABLE',
        goalId: body.goalId ?? null,
        autoDerived: false,
        notes: body.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ event: result[0] }, { status: 201 });
  } catch (err) {
    const { code } = findPgError(err);
    if (code === '23505') {
      return NextResponse.json(
        { error: 'A cashflow event for this source already exists.' },
        { status: 409 },
      );
    }
    console.error('[cashflow-events POST]', err);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
