/**
 * Update or delete a single vehicle insurance term.
 *
 * The userId scope is enforced on every statement — the term-id alone
 * isn't sufficient because IDs are global serials.
 *
 * `addons` arrives as `string[] | null`; we JSON-encode on write and
 * parse back on the response so the client never has to learn the
 * storage representation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
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

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
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

interface PatchBody {
  insurer?: string;
  policyNumber?: string;
  insuranceType?: VehicleInsuranceType;
  idvRupees?: number;
  premiumRupees?: number;
  ownDamagePremiumRupees?: number | null;
  thirdPartyPremiumRupees?: number | null;
  ncbPercent?: number;
  addons?: string[] | null;
  premiumFrequency?: PremiumFrequency;
  startDate?: string;
  renewalDate?: string;
  claimsMadeCount?: number;
  status?: VehicleInsuranceStatus;
  policyDocumentPath?: string | null;
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
      .from(vehicleInsurancePolicies)
      .where(
        and(
          eq(vehicleInsurancePolicies.id, numericId),
          eq(vehicleInsurancePolicies.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    if (body.insuranceType !== undefined && !VALID_TYPES.includes(body.insuranceType)) {
      return NextResponse.json({ error: 'Invalid insuranceType' }, { status: 400 });
    }
    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (
      body.premiumFrequency !== undefined
      && !VALID_FREQUENCIES.includes(body.premiumFrequency)
    ) {
      return NextResponse.json({ error: 'Invalid premiumFrequency' }, { status: 400 });
    }

    const update: Partial<typeof vehicleInsurancePolicies.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.insurer === 'string' && body.insurer.trim()) update.insurer = body.insurer.trim();
    if (typeof body.policyNumber === 'string' && body.policyNumber.trim()) {
      update.policyNumber = body.policyNumber.trim();
    }
    if (body.insuranceType !== undefined) update.insuranceType = body.insuranceType;
    const idv = rupeesToPaisa(body.idvRupees);
    if (idv !== undefined) update.idvPaisa = idv;
    const premium = rupeesToPaisa(body.premiumRupees);
    if (premium !== undefined) update.premiumPaisa = premium;
    if (body.ownDamagePremiumRupees === null) {
      update.ownDamagePremiumPaisa = null;
    } else {
      const od = rupeesToPaisa(body.ownDamagePremiumRupees);
      if (od !== undefined) update.ownDamagePremiumPaisa = od;
    }
    if (body.thirdPartyPremiumRupees === null) {
      update.thirdPartyPremiumPaisa = null;
    } else {
      const tp = rupeesToPaisa(body.thirdPartyPremiumRupees);
      if (tp !== undefined) update.thirdPartyPremiumPaisa = tp;
    }
    if (typeof body.ncbPercent === 'number') update.ncbPercent = body.ncbPercent;
    if (body.addons === null) {
      update.addons = null;
    } else if (Array.isArray(body.addons)) {
      update.addons = body.addons.length ? JSON.stringify(body.addons) : null;
    }
    if (body.premiumFrequency !== undefined) update.premiumFrequency = body.premiumFrequency;
    if (typeof body.startDate === 'string' && body.startDate) update.startDate = body.startDate;
    if (typeof body.renewalDate === 'string' && body.renewalDate) {
      update.renewalDate = body.renewalDate;
    }
    if (typeof body.claimsMadeCount === 'number') update.claimsMadeCount = body.claimsMadeCount;
    if (body.status !== undefined) update.status = body.status;
    if (body.policyDocumentPath !== undefined) update.policyDocumentPath = body.policyDocumentPath;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(vehicleInsurancePolicies)
      .set(update)
      .where(
        and(
          eq(vehicleInsurancePolicies.id, numericId),
          eq(vehicleInsurancePolicies.userId, session.user.id),
        ),
      )
      .returning();
    const updated = result[0];
    return NextResponse.json({
      insurance: { ...updated, addons: parseAddons(updated.addons) },
    });
  } catch (err) {
    console.error('[vehicles/insurance/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update insurance' }, { status: 500 });
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
      .delete(vehicleInsurancePolicies)
      .where(
        and(
          eq(vehicleInsurancePolicies.id, numericId),
          eq(vehicleInsurancePolicies.userId, session.user.id),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[vehicles/insurance/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete insurance' }, { status: 500 });
  }
}
