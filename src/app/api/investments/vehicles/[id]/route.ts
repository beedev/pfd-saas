/**
 * Vehicle — detail bundle (with insurance terms + PUC certs + service
 * log), partial update, delete.
 *
 * GET returns the vehicle plus all three child collections in a single
 * round-trip (four SELECTs — Drizzle's relational query builder isn't
 * configured for these tables and four queries against a hot connection
 * are faster than wrangling json_agg + LEFT JOIN groupings).
 *
 * PATCH only touches fields actually present in the body so callers can
 * ship a single-field diff (e.g. `{status:'SOLD'}`) without clobbering
 * the rest. When status flips to SOLD/TRANSFERRED the caller is expected
 * to also send soldDate + salePriceRupees — we don't enforce that here
 * because partial editing flows (e.g. record the date now, the amount
 * later) are legitimate.
 *
 * DELETE relies on FK ON DELETE CASCADE for insurance / PUC / service
 * log — a single statement collapses the entire subtree.
 *
 * `addons` field on insurance is text storing a JSON-encoded string[].
 * We parse it back into an array before handing it to the client so the
 * UI never has to know about the storage representation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  db,
  vehicles,
  vehicleInsurancePolicies,
  vehiclePuc,
  vehicleServiceLog,
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

interface Params {
  params: Promise<{ id: string }>;
}

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

/** Parse the JSON-encoded addons text column back into a string array. */
function parseAddons(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
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

    const vehicleRows = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, numericId), eq(vehicles.userId, session.user.id)))
      .limit(1);
    if (!vehicleRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // All three children scoped by BOTH vehicleId AND userId — defence in
    // depth in case a stale FK ever survives a delete race.
    const insurance = await db
      .select()
      .from(vehicleInsurancePolicies)
      .where(
        and(
          eq(vehicleInsurancePolicies.vehicleId, numericId),
          eq(vehicleInsurancePolicies.userId, session.user.id),
        ),
      )
      .orderBy(desc(vehicleInsurancePolicies.startDate));

    const puc = await db
      .select()
      .from(vehiclePuc)
      .where(
        and(eq(vehiclePuc.vehicleId, numericId), eq(vehiclePuc.userId, session.user.id)),
      )
      .orderBy(desc(vehiclePuc.validUntil));

    const service = await db
      .select()
      .from(vehicleServiceLog)
      .where(
        and(
          eq(vehicleServiceLog.vehicleId, numericId),
          eq(vehicleServiceLog.userId, session.user.id),
        ),
      )
      .orderBy(desc(vehicleServiceLog.serviceDate), asc(vehicleServiceLog.id));

    return NextResponse.json({
      vehicle: vehicleRows[0],
      insurance: insurance.map((p) => ({ ...p, addons: parseAddons(p.addons) })),
      puc,
      service,
    });
  } catch (err) {
    console.error('[vehicles/:id GET]', err);
    return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 });
  }
}

interface PatchBody {
  registrationNumber?: string;
  make?: string;
  model?: string;
  variant?: string | null;
  year?: number;
  fuelType?: VehicleFuelType;
  transmission?: string | null;
  color?: string | null;
  bodyType?: string | null;
  purchaseDate?: string;
  purchasePriceRupees?: number;
  currentIdvRupees?: number | null;
  odometerKm?: number;
  status?: VehicleStatus;
  soldDate?: string | null;
  salePriceRupees?: number | null;
  rcDocumentPath?: string | null;
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
      .from(vehicles)
      .where(and(eq(vehicles.id, numericId), eq(vehicles.userId, session.user.id)))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    if (body.fuelType !== undefined && !VALID_FUEL_TYPES.includes(body.fuelType)) {
      return NextResponse.json({ error: 'Invalid fuelType' }, { status: 400 });
    }
    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (body.year !== undefined) {
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(body.year) || body.year < 1900 || body.year > currentYear + 1) {
        return NextResponse.json(
          { error: `year must be between 1900 and ${currentYear + 1}` },
          { status: 400 },
        );
      }
    }

    const update: Partial<typeof vehicles.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.registrationNumber === 'string' && body.registrationNumber.trim()) {
      update.registrationNumber = body.registrationNumber.trim().toUpperCase();
    }
    if (typeof body.make === 'string' && body.make.trim()) update.make = body.make.trim();
    if (typeof body.model === 'string' && body.model.trim()) update.model = body.model.trim();
    if (body.variant !== undefined) update.variant = body.variant;
    if (body.year !== undefined) update.year = body.year;
    if (body.fuelType !== undefined) update.fuelType = body.fuelType;
    if (body.transmission !== undefined) update.transmission = body.transmission;
    if (body.color !== undefined) update.color = body.color;
    if (body.bodyType !== undefined) update.bodyType = body.bodyType;
    if (typeof body.purchaseDate === 'string' && body.purchaseDate) {
      update.purchaseDate = body.purchaseDate;
    }
    const purchasePrice = rupeesToPaisa(body.purchasePriceRupees);
    if (purchasePrice !== undefined) update.purchasePricePaisa = purchasePrice;
    if (body.currentIdvRupees === null) {
      update.currentIdvPaisa = null;
    } else {
      const idv = rupeesToPaisa(body.currentIdvRupees);
      if (idv !== undefined) update.currentIdvPaisa = idv;
    }
    if (typeof body.odometerKm === 'number') update.odometerKm = body.odometerKm;
    if (body.status !== undefined) update.status = body.status;
    if (body.soldDate !== undefined) update.soldDate = body.soldDate;
    if (body.salePriceRupees === null) {
      update.salePricePaisa = null;
    } else {
      const sale = rupeesToPaisa(body.salePriceRupees);
      if (sale !== undefined) update.salePricePaisa = sale;
    }
    if (body.rcDocumentPath !== undefined) update.rcDocumentPath = body.rcDocumentPath;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(vehicles)
      .set(update)
      .where(and(eq(vehicles.id, numericId), eq(vehicles.userId, session.user.id)))
      .returning();
    return NextResponse.json({ vehicle: result[0] });
  } catch (err) {
    console.error('[vehicles/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
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
    // FK ON DELETE CASCADE handles insurance/puc/service automatically.
    await db
      .delete(vehicles)
      .where(and(eq(vehicles.id, numericId), eq(vehicles.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[vehicles/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete vehicle' }, { status: 500 });
  }
}
