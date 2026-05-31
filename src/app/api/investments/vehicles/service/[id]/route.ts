/**
 * Update or delete a single service log entry.
 *
 * Scope enforced by user_id on every statement — global serial IDs
 * mean userId is the only thing keeping tenants apart.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, vehicleServiceLog, type ServiceType } from '@/db';
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

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

interface PatchBody {
  serviceDate?: string;
  odometerKm?: number | null;
  serviceType?: ServiceType;
  garageName?: string | null;
  costRupees?: number;
  description?: string | null;
  nextServiceDueDate?: string | null;
  nextServiceDueKm?: number | null;
  invoicePath?: string | null;
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
      .from(vehicleServiceLog)
      .where(
        and(eq(vehicleServiceLog.id, numericId), eq(vehicleServiceLog.userId, session.user.id)),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    if (body.serviceType !== undefined && !VALID_SERVICE_TYPES.includes(body.serviceType)) {
      return NextResponse.json({ error: 'Invalid serviceType' }, { status: 400 });
    }

    const update: Partial<typeof vehicleServiceLog.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.serviceDate === 'string' && body.serviceDate) {
      update.serviceDate = body.serviceDate;
    }
    if (body.odometerKm === null) {
      update.odometerKm = null;
    } else if (typeof body.odometerKm === 'number') {
      update.odometerKm = body.odometerKm;
    }
    if (body.serviceType !== undefined) update.serviceType = body.serviceType;
    if (body.garageName !== undefined) update.garageName = body.garageName;
    const cost = rupeesToPaisa(body.costRupees);
    if (cost !== undefined) update.costPaisa = cost;
    if (body.description !== undefined) update.description = body.description;
    if (body.nextServiceDueDate !== undefined) update.nextServiceDueDate = body.nextServiceDueDate;
    if (body.nextServiceDueKm === null) {
      update.nextServiceDueKm = null;
    } else if (typeof body.nextServiceDueKm === 'number') {
      update.nextServiceDueKm = body.nextServiceDueKm;
    }
    if (body.invoicePath !== undefined) update.invoicePath = body.invoicePath;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(vehicleServiceLog)
      .set(update)
      .where(
        and(eq(vehicleServiceLog.id, numericId), eq(vehicleServiceLog.userId, session.user.id)),
      )
      .returning();
    return NextResponse.json({ service: result[0] });
  } catch (err) {
    console.error('[vehicles/service/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update service entry' }, { status: 500 });
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
      .delete(vehicleServiceLog)
      .where(
        and(eq(vehicleServiceLog.id, numericId), eq(vehicleServiceLog.userId, session.user.id)),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[vehicles/service/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete service entry' }, { status: 500 });
  }
}
