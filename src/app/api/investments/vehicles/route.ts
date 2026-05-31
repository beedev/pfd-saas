/**
 * Vehicles — list + create.
 *
 * Each row represents a single registered vehicle (car / bike / scooter /
 * commercial). The four-table family (vehicles + insurance + PUC +
 * service-log) covers the full Indian compliance picture: RTA-mandated
 * insurance, PUC certificates with statutory expiry, and a service
 * history that doubles as a resale-value attestation.
 *
 * Money values on the wire are RUPEES (number) and are stored as PAISA
 * (integer) — same convention as every other asset module here. The
 * composite unique (user_id, registration_number) means we can return a
 * friendly 409 when a user tries to register the same plate twice; we
 * walk the Postgres error cause chain via findPgError() to detect that
 * specific SQLSTATE rather than spitting a generic 500.
 *
 * GET enriches each row with two correlated subqueries: the most recent
 * ACTIVE insurance term (insurer + renewal date + premium) and the
 * latest valid PUC. Both are intentionally inlined so the list page can
 * render renewal/PUC due chips without a second round-trip per row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import {
  db,
  vehicles,
  vehicleInsurancePolicies,
  vehiclePuc,
  type VehicleFuelType,
  type VehicleStatus,
} from '@/db';
import { auth } from '@/auth';

const VALID_FUEL_TYPES: VehicleFuelType[] = [
  'PETROL',
  'DIESEL',
  'CNG',
  'LPG',
  'ELECTRIC',
  'HYBRID',
];

const VALID_STATUSES: VehicleStatus[] = ['ACTIVE', 'SOLD', 'SCRAPPED', 'TRANSFERRED'];

/**
 * Drizzle wraps the underlying PostgresError as `cause`. Walk the
 * cause chain to find the SQLSTATE code — needed so we can map
 * unique-violation (23505) into a friendly 409 instead of a 500.
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

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    // Each row carries a summary of its most-recent active insurance term
    // and most-recent valid PUC via correlated subqueries. Selecting JSON
    // objects keeps the wire shape compact and avoids row-multiplication
    // that a LEFT JOIN would introduce when a vehicle has multiple terms.
    const rows = await db
      .select({
        vehicle: vehicles,
        activeInsurance: sql<{
          id: number;
          insurer: string;
          policyNumber: string;
          renewalDate: string;
          premiumPaisa: number;
        } | null>`(
          SELECT json_build_object(
            'id', i.id,
            'insurer', i.insurer,
            'policyNumber', i.policy_number,
            'renewalDate', i.renewal_date,
            'premiumPaisa', i.premium_paisa
          )
          FROM ${vehicleInsurancePolicies} i
          WHERE i.vehicle_id = ${vehicles.id}
            AND i.user_id = ${vehicles.userId}
            AND i.status = 'ACTIVE'
          ORDER BY i.renewal_date DESC
          LIMIT 1
        )`,
        activePuc: sql<{
          id: number;
          certificateNumber: string;
          validUntil: string;
        } | null>`(
          SELECT json_build_object(
            'id', p.id,
            'certificateNumber', p.certificate_number,
            'validUntil', p.valid_until
          )
          FROM ${vehiclePuc} p
          WHERE p.vehicle_id = ${vehicles.id}
            AND p.user_id = ${vehicles.userId}
          ORDER BY p.valid_until DESC
          LIMIT 1
        )`,
      })
      .from(vehicles)
      .where(eq(vehicles.userId, session.user.id))
      .orderBy(desc(vehicles.purchaseDate));

    const out = rows.map((r) => ({
      ...r.vehicle,
      activeInsurance: r.activeInsurance,
      activePuc: r.activePuc,
    }));
    return NextResponse.json({ vehicles: out });
  } catch (err) {
    console.error('[vehicles GET]', err);
    return NextResponse.json({ error: 'Failed to fetch vehicles' }, { status: 500 });
  }
}

interface CreateBody {
  registrationNumber?: string;
  make?: string;
  model?: string;
  variant?: string;
  year?: number;
  fuelType?: VehicleFuelType;
  transmission?: string;
  color?: string;
  bodyType?: string;
  purchaseDate?: string;
  purchasePriceRupees?: number;
  currentIdvRupees?: number;
  odometerKm?: number;
  status?: VehicleStatus;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as CreateBody;

    if (!body.registrationNumber || !body.registrationNumber.trim()) {
      return NextResponse.json({ error: 'registrationNumber is required' }, { status: 400 });
    }
    if (!body.make || !body.make.trim()) {
      return NextResponse.json({ error: 'make is required' }, { status: 400 });
    }
    if (!body.model || !body.model.trim()) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }
    // Year range guards: 1900 (no production vehicle pre-dates this) up to
    // current+1 so a buyer registering next-year's model on Dec 31 still
    // passes. Reject anything wider — almost certainly a UI typo.
    const currentYear = new Date().getFullYear();
    if (
      typeof body.year !== 'number'
      || !Number.isInteger(body.year)
      || body.year < 1900
      || body.year > currentYear + 1
    ) {
      return NextResponse.json(
        { error: `year must be between 1900 and ${currentYear + 1}` },
        { status: 400 },
      );
    }
    if (!body.fuelType || !VALID_FUEL_TYPES.includes(body.fuelType)) {
      return NextResponse.json({ error: 'fuelType is required' }, { status: 400 });
    }
    if (!body.purchaseDate) {
      return NextResponse.json({ error: 'purchaseDate is required' }, { status: 400 });
    }
    if (typeof body.purchasePriceRupees !== 'number' || !Number.isFinite(body.purchasePriceRupees)) {
      return NextResponse.json({ error: 'purchasePriceRupees is required' }, { status: 400 });
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const purchasePricePaisa = Math.round(body.purchasePriceRupees * 100);
    const currentIdvPaisa
      = typeof body.currentIdvRupees === 'number' && Number.isFinite(body.currentIdvRupees)
        ? Math.round(body.currentIdvRupees * 100)
        : null;

    const result = await db
      .insert(vehicles)
      .values({
        userId: session.user.id,
        // Registration numbers are case-insensitive in real life — store
        // upper-case so the unique index works regardless of how the user
        // typed it ("ka01ab1234" vs "KA01AB1234" collide).
        registrationNumber: body.registrationNumber.trim().toUpperCase(),
        make: body.make.trim(),
        model: body.model.trim(),
        variant: body.variant?.trim() || null,
        year: body.year,
        fuelType: body.fuelType,
        transmission: body.transmission?.trim() || null,
        color: body.color?.trim() || null,
        bodyType: body.bodyType?.trim() || null,
        purchaseDate: body.purchaseDate,
        purchasePricePaisa,
        currentIdvPaisa,
        odometerKm: typeof body.odometerKm === 'number' ? body.odometerKm : 0,
        status: body.status ?? 'ACTIVE',
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ vehicle: result[0] }, { status: 201 });
  } catch (err) {
    const { code } = findPgError(err);
    if (code === '23505') {
      return NextResponse.json(
        { error: 'That registration number is already on your list.' },
        { status: 409 },
      );
    }
    console.error('[vehicles POST]', err);
    return NextResponse.json({ error: 'Failed to create vehicle' }, { status: 500 });
  }
}
