/**
 * Service log entries for a specific vehicle.
 *
 *   GET   list all service entries, ordered by service_date desc (most
 *         recent at the top — matches how the detail page shows them).
 *   POST  create a service entry. `nextServiceDueDate` and
 *         `nextServiceDueKm` are optional projections — the alerts cron
 *         (separate concern) reads these to surface upcoming service
 *         reminders.
 *
 * Both endpoints scope by BOTH vehicleId AND userId for defence in
 * depth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, vehicles, vehicleServiceLog, type ServiceType } from '@/db';
import { auth } from '@/auth';

const VALID_SERVICE_TYPES: ServiceType[] = [
  'REGULAR',
  'REPAIR',
  'ACCIDENT',
  'BREAKDOWN',
  'TYRE_CHANGE',
  'BATTERY',
  'OTHER',
];

interface Params {
  params: Promise<{ id: string }>;
}

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

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensureVehicle(id, session.user.id);
    if ('error' in guard) return guard.error;

    // Tie-break on id-asc to give a stable order when two services share
    // the same date (e.g. a regular service + battery replacement at the
    // same garage on the same day).
    const rows = await db
      .select()
      .from(vehicleServiceLog)
      .where(
        and(
          eq(vehicleServiceLog.vehicleId, guard.vehicleId),
          eq(vehicleServiceLog.userId, session.user.id),
        ),
      )
      .orderBy(desc(vehicleServiceLog.serviceDate), asc(vehicleServiceLog.id));
    return NextResponse.json({ service: rows });
  } catch (err) {
    console.error('[vehicles/:id/service GET]', err);
    return NextResponse.json({ error: 'Failed to fetch service log' }, { status: 500 });
  }
}

interface CreateBody {
  serviceDate?: string;
  odometerKm?: number;
  serviceType?: ServiceType;
  garageName?: string;
  costRupees?: number;
  description?: string;
  nextServiceDueDate?: string;
  nextServiceDueKm?: number;
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

    if (!body.serviceDate) {
      return NextResponse.json({ error: 'serviceDate is required' }, { status: 400 });
    }
    if (!body.serviceType || !VALID_SERVICE_TYPES.includes(body.serviceType)) {
      return NextResponse.json({ error: 'serviceType is required' }, { status: 400 });
    }
    if (typeof body.costRupees !== 'number' || !Number.isFinite(body.costRupees)) {
      return NextResponse.json({ error: 'costRupees is required' }, { status: 400 });
    }

    const result = await db
      .insert(vehicleServiceLog)
      .values({
        userId: session.user.id,
        vehicleId: guard.vehicleId,
        serviceDate: body.serviceDate,
        odometerKm: typeof body.odometerKm === 'number' ? body.odometerKm : null,
        serviceType: body.serviceType,
        garageName: body.garageName?.trim() || null,
        costPaisa: Math.round(body.costRupees * 100),
        description: body.description?.trim() || null,
        nextServiceDueDate: body.nextServiceDueDate || null,
        nextServiceDueKm:
          typeof body.nextServiceDueKm === 'number' ? body.nextServiceDueKm : null,
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ service: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[vehicles/:id/service POST]', err);
    return NextResponse.json({ error: 'Failed to create service entry' }, { status: 500 });
  }
}
