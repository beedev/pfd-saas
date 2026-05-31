/**
 * Insurance terms for a specific vehicle.
 *
 *   GET   list all terms (active + expired), ordered newest-first by
 *         start_date so renewals stack chronologically
 *   POST  create a new insurance term — typically one per year per
 *         vehicle, but pre-renewal overlap is allowed (e.g. buy next
 *         year's policy 2 weeks before the current one expires).
 *
 * Both endpoints scope by BOTH vehicleId AND userId for defence in
 * depth — even though the vehicle-ownership guard above already gates
 * this resource.
 *
 * addons (e.g. ZERO_DEP, ENGINE_PROTECT, RSA) arrive as string[] and
 * are JSON-encoded into the `addons` text column on write; the GET
 * here returns them parsed back into an array so the UI doesn't need
 * to know the storage shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  vehicles,
  vehicleInsurancePolicies,
  type VehicleInsuranceType,
  type VehicleInsuranceStatus,
  type PremiumFrequency,
} from '@/db';
import { auth } from '@/auth';

const VALID_TYPES: VehicleInsuranceType[] = [
  'COMPREHENSIVE',
  'THIRD_PARTY_ONLY',
  'OWN_DAMAGE_ONLY',
];

const VALID_STATUSES: VehicleInsuranceStatus[] = ['ACTIVE', 'EXPIRED', 'CANCELLED', 'CLAIMED'];

const VALID_FREQUENCIES: PremiumFrequency[] = ['ANNUAL', 'SEMI_ANNUAL', 'QUARTERLY', 'MONTHLY'];

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Confirm the parent vehicle exists AND belongs to the caller. We only
 * select `id` because the body of the route never needs anything else
 * — keeps the network round-trip cheap.
 */
async function ensureVehicle(idRaw: string, userId: string) {
  const numericId = Number(idRaw);
  if (!Number.isFinite(numericId)) {
    return { error: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) };
  }
  const rows = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, numericId), eq(vehicles.userId, userId)))
    .limit(1);
  if (!rows.length) {
    return { error: NextResponse.json({ error: 'Vehicle not found' }, { status: 404 }) };
  }
  return { vehicleId: numericId };
}

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
    const guard = await ensureVehicle(id, session.user.id);
    if ('error' in guard) return guard.error;

    const rows = await db
      .select()
      .from(vehicleInsurancePolicies)
      .where(
        and(
          eq(vehicleInsurancePolicies.vehicleId, guard.vehicleId),
          eq(vehicleInsurancePolicies.userId, session.user.id),
        ),
      )
      .orderBy(desc(vehicleInsurancePolicies.startDate));
    return NextResponse.json({
      insurance: rows.map((p) => ({ ...p, addons: parseAddons(p.addons) })),
    });
  } catch (err) {
    console.error('[vehicles/:id/insurance GET]', err);
    return NextResponse.json({ error: 'Failed to fetch insurance' }, { status: 500 });
  }
}

interface CreateBody {
  insurer?: string;
  policyNumber?: string;
  insuranceType?: VehicleInsuranceType;
  idvRupees?: number;
  premiumRupees?: number;
  ownDamagePremiumRupees?: number;
  thirdPartyPremiumRupees?: number;
  ncbPercent?: number;
  addons?: string[];
  premiumFrequency?: PremiumFrequency;
  startDate?: string;
  renewalDate?: string;
  status?: VehicleInsuranceStatus;
  notes?: string;
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensureVehicle(id, session.user.id);
    if ('error' in guard) return guard.error;

    const body = (await request.json()) as CreateBody;

    if (!body.insurer || !body.insurer.trim()) {
      return NextResponse.json({ error: 'insurer is required' }, { status: 400 });
    }
    if (!body.policyNumber || !body.policyNumber.trim()) {
      return NextResponse.json({ error: 'policyNumber is required' }, { status: 400 });
    }
    if (!body.insuranceType || !VALID_TYPES.includes(body.insuranceType)) {
      return NextResponse.json({ error: 'insuranceType is required' }, { status: 400 });
    }
    if (typeof body.idvRupees !== 'number' || !Number.isFinite(body.idvRupees)) {
      return NextResponse.json({ error: 'idvRupees is required' }, { status: 400 });
    }
    if (typeof body.premiumRupees !== 'number' || !Number.isFinite(body.premiumRupees)) {
      return NextResponse.json({ error: 'premiumRupees is required' }, { status: 400 });
    }
    if (!body.startDate) {
      return NextResponse.json({ error: 'startDate is required' }, { status: 400 });
    }
    if (!body.renewalDate) {
      return NextResponse.json({ error: 'renewalDate is required' }, { status: 400 });
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    const freq = body.premiumFrequency ?? 'ANNUAL';
    if (!VALID_FREQUENCIES.includes(freq)) {
      return NextResponse.json({ error: 'Invalid premiumFrequency' }, { status: 400 });
    }

    const addonsEncoded
      = Array.isArray(body.addons) && body.addons.length ? JSON.stringify(body.addons) : null;

    const result = await db
      .insert(vehicleInsurancePolicies)
      .values({
        userId: session.user.id,
        vehicleId: guard.vehicleId,
        insurer: body.insurer.trim(),
        policyNumber: body.policyNumber.trim(),
        insuranceType: body.insuranceType,
        idvPaisa: Math.round(body.idvRupees * 100),
        premiumPaisa: Math.round(body.premiumRupees * 100),
        ownDamagePremiumPaisa:
          typeof body.ownDamagePremiumRupees === 'number'
            ? Math.round(body.ownDamagePremiumRupees * 100)
            : null,
        thirdPartyPremiumPaisa:
          typeof body.thirdPartyPremiumRupees === 'number'
            ? Math.round(body.thirdPartyPremiumRupees * 100)
            : null,
        ncbPercent: typeof body.ncbPercent === 'number' ? body.ncbPercent : 0,
        addons: addonsEncoded,
        premiumFrequency: freq,
        startDate: body.startDate,
        renewalDate: body.renewalDate,
        status: body.status ?? 'ACTIVE',
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const created = result[0];
    return NextResponse.json(
      { insurance: { ...created, addons: parseAddons(created.addons) } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[vehicles/:id/insurance POST]', err);
    return NextResponse.json({ error: 'Failed to create insurance' }, { status: 500 });
  }
}
