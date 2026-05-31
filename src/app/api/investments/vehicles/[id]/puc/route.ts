/**
 * PUC certificates for a specific vehicle.
 *
 *   GET   list all PUC certificates, ordered newest-first by validUntil
 *         so the active certificate (if any) is at the top.
 *   POST  create a PUC certificate row. Indian Motor Vehicles Act
 *         requires a valid PUC at all times for vehicles older than
 *         12 months — we don't enforce that here, just store the
 *         certificate metadata.
 *
 * Both endpoints scope by BOTH vehicleId AND userId for defence in
 * depth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, vehicles, vehiclePuc } from '@/db';
import { auth } from '@/auth';

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

    const rows = await db
      .select()
      .from(vehiclePuc)
      .where(
        and(eq(vehiclePuc.vehicleId, guard.vehicleId), eq(vehiclePuc.userId, session.user.id)),
      )
      .orderBy(desc(vehiclePuc.validUntil));
    return NextResponse.json({ puc: rows });
  } catch (err) {
    console.error('[vehicles/:id/puc GET]', err);
    return NextResponse.json({ error: 'Failed to fetch PUC certificates' }, { status: 500 });
  }
}

interface CreateBody {
  certificateNumber?: string;
  issuedDate?: string;
  validUntil?: string;
  issuingAuthority?: string;
  costRupees?: number;
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

    if (!body.certificateNumber || !body.certificateNumber.trim()) {
      return NextResponse.json({ error: 'certificateNumber is required' }, { status: 400 });
    }
    if (!body.issuedDate) {
      return NextResponse.json({ error: 'issuedDate is required' }, { status: 400 });
    }
    if (!body.validUntil) {
      return NextResponse.json({ error: 'validUntil is required' }, { status: 400 });
    }

    const result = await db
      .insert(vehiclePuc)
      .values({
        userId: session.user.id,
        vehicleId: guard.vehicleId,
        certificateNumber: body.certificateNumber.trim(),
        issuedDate: body.issuedDate,
        validUntil: body.validUntil,
        issuingAuthority: body.issuingAuthority?.trim() || null,
        costPaisa:
          typeof body.costRupees === 'number' && Number.isFinite(body.costRupees)
            ? Math.round(body.costRupees * 100)
            : 0,
        notes: body.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ puc: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[vehicles/:id/puc POST]', err);
    return NextResponse.json({ error: 'Failed to create PUC certificate' }, { status: 500 });
  }
}
