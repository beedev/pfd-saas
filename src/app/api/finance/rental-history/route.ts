/**
 * Rental History — list + create.
 *
 * Sprint 5.3 — backfill prior-year rental figures per property so the
 * /income YoY trend table stops dropping rental rows for past FYs.
 *
 * GET   /api/finance/rental-history
 *   Query params (any combo):
 *     • ?fy=YYYY-YY       — filter to one FY
 *     • ?propertyId=N     — filter to one property
 *   Returns rows with the inline property_name (JOIN real_estate) so
 *   the UI doesn't need a second fetch.
 *
 * POST  /api/finance/rental-history
 *   Body in RUPEES, server converts to paisa.
 *     { realEstateId: number, fy: string,
 *       rentReceivedRupees: number,
 *       monthsLet?: number, notes?: string }
 *   Validates fy format, monthsLet ∈ [1,12], and that the user owns
 *   the property. 23505 → 409 with a friendly hint.
 *
 * Money on the wire: RUPEES. Stored in paisa.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db, realEstate, rentalHistory } from '@/db';
import { auth } from '@/auth';

/** Walk the Drizzle error cause chain to find the underlying SQLSTATE
 *  code so we can map unique violations to 409. Same shape as the rest
 *  of the API. */
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

const FY_REGEX = /^\d{4}-\d{2}$/;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    const propertyIdRaw = searchParams.get('propertyId');

    const filters = [eq(rentalHistory.userId, session.user.id)];
    if (fy) {
      if (!FY_REGEX.test(fy)) {
        return NextResponse.json({ error: 'Invalid fy format — expected YYYY-YY' }, { status: 400 });
      }
      filters.push(eq(rentalHistory.fy, fy));
    }
    if (propertyIdRaw) {
      const propertyId = Number(propertyIdRaw);
      if (!Number.isInteger(propertyId)) {
        return NextResponse.json({ error: 'Invalid propertyId' }, { status: 400 });
      }
      filters.push(eq(rentalHistory.realEstateId, propertyId));
    }

    // JOIN to surface property_name inline — the detail-page and income
    // YoY widgets both want it without a second round-trip.
    const rows = await db
      .select({
        id: rentalHistory.id,
        realEstateId: rentalHistory.realEstateId,
        propertyName: realEstate.propertyName,
        fy: rentalHistory.fy,
        rentReceivedPaisa: rentalHistory.rentReceivedPaisa,
        monthsLet: rentalHistory.monthsLet,
        notes: rentalHistory.notes,
        createdAt: rentalHistory.createdAt,
        updatedAt: rentalHistory.updatedAt,
      })
      .from(rentalHistory)
      .innerJoin(realEstate, eq(realEstate.id, rentalHistory.realEstateId))
      .where(and(...filters))
      // Newest-FY-first within a property; useful for the detail-page table.
      .orderBy(asc(rentalHistory.realEstateId), asc(rentalHistory.fy));

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[rental-history GET]', err);
    return NextResponse.json({ error: 'Failed to fetch rental history' }, { status: 500 });
  }
}

interface CreateBody {
  realEstateId?: number;
  fy?: string;
  rentReceivedRupees?: number;
  monthsLet?: number;
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as CreateBody;

    if (!Number.isInteger(body.realEstateId)) {
      return NextResponse.json({ error: 'realEstateId is required' }, { status: 400 });
    }
    if (!body.fy || !FY_REGEX.test(body.fy)) {
      return NextResponse.json({ error: 'Valid fy (YYYY-YY) is required' }, { status: 400 });
    }
    if (typeof body.rentReceivedRupees !== 'number' || !Number.isFinite(body.rentReceivedRupees) || body.rentReceivedRupees < 0) {
      return NextResponse.json({ error: 'rentReceivedRupees must be a non-negative number' }, { status: 400 });
    }
    const monthsLet = body.monthsLet ?? 12;
    if (!Number.isInteger(monthsLet) || monthsLet < 1 || monthsLet > 12) {
      return NextResponse.json({ error: 'monthsLet must be an integer 1..12' }, { status: 400 });
    }

    // Verify the user owns the property before we let them write
    // history rows pointing at it. The FK + cascade would catch this at
    // delete-time, but a clean 403 here keeps the audit trail honest.
    const owned = await db
      .select({ id: realEstate.id })
      .from(realEstate)
      .where(and(eq(realEstate.id, body.realEstateId as number), eq(realEstate.userId, session.user.id)))
      .limit(1);
    if (!owned.length) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const inserted = await db
      .insert(rentalHistory)
      .values({
        userId: session.user.id,
        realEstateId: body.realEstateId as number,
        fy: body.fy,
        rentReceivedPaisa: Math.round(body.rentReceivedRupees * 100),
        monthsLet,
        notes: body.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ row: inserted[0] }, { status: 201 });
  } catch (err) {
    const { code } = findPgError(err);
    if (code === '23505') {
      return NextResponse.json(
        { error: 'Already recorded — edit the existing entry' },
        { status: 409 },
      );
    }
    console.error('[rental-history POST]', err);
    return NextResponse.json({ error: 'Failed to create rental history entry' }, { status: 500 });
  }
}
