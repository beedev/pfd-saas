import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, realEstate, type RetirementTreatment } from '@/db';
import { auth } from '@/auth';

const VALID_RETIREMENT_TREATMENTS: RetirementTreatment[] = [
  'sell',
  'rental_only',
  'self_occupied',
];

interface Params {
  params: Promise<{ id: string }>;
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
    const rows = await db
      .select()
      .from(realEstate)
      .where(and(eq(realEstate.id, numericId), eq(realEstate.userId, session.user.id)))
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ property: rows[0] });
  } catch (err) {
    console.error('Failed to fetch property:', err);
    return NextResponse.json({ error: 'Failed to fetch property' }, { status: 500 });
  }
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
      .from(realEstate)
      .where(and(eq(realEstate.id, numericId), eq(realEstate.userId, session.user.id)))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const current = existing[0];
    const body = await request.json();

    // Sprint 5.12 — retirement_treatment validation. Reject any
    // non-canonical value with 400 so the UI / a stray script can't
    // silently corrupt the column to a string the projection layer
    // doesn't recognise.
    let retirementTreatment = current.retirementTreatment;
    if (typeof body.retirementTreatment === 'string') {
      if (
        !VALID_RETIREMENT_TREATMENTS.includes(
          body.retirementTreatment as RetirementTreatment,
        )
      ) {
        return NextResponse.json(
          {
            error: `Invalid retirementTreatment. Expected one of: ${VALID_RETIREMENT_TREATMENTS.join(', ')}`,
          },
          { status: 400 },
        );
      }
      retirementTreatment = body.retirementTreatment as RetirementTreatment;
    }

    const purchasePrice =
      typeof body.purchasePriceRupees === 'number'
        ? Math.round(body.purchasePriceRupees * 100)
        : current.purchasePrice;
    const currentValuation =
      typeof body.currentValuationRupees === 'number'
        ? Math.round(body.currentValuationRupees * 100)
        : current.currentValuation;
    const gainLoss = currentValuation - purchasePrice;
    const gainLossPercent = purchasePrice > 0 ? (gainLoss / purchasePrice) * 100 : 0;

    const monthlyRent =
      typeof body.monthlyRentRupees === 'number'
        ? Math.round(body.monthlyRentRupees * 100)
        : current.monthlyRent;
    const mortgageAmount =
      typeof body.mortgageAmountRupees === 'number'
        ? Math.round(body.mortgageAmountRupees * 100)
        : current.mortgageAmount;

    const result = await db
      .update(realEstate)
      .set({
        propertyName: typeof body.propertyName === 'string' ? body.propertyName : current.propertyName,
        type: typeof body.type === 'string' ? body.type : current.type,
        status: typeof body.status === 'string' ? body.status : current.status,
        address: typeof body.address === 'string' ? body.address : current.address,
        city: typeof body.city === 'string' ? body.city : current.city,
        state: typeof body.state === 'string' ? body.state : current.state,
        pincode: typeof body.pincode === 'string' ? (body.pincode || null) : current.pincode,
        purchasePrice,
        currentValuation,
        valuationDate: typeof body.valuationDate === 'string' ? body.valuationDate : current.valuationDate,
        gainLoss,
        gainLossPercent,
        monthlyRent,
        mortgageAmount,
        mortgageLender: typeof body.mortgageLender === 'string' ? (body.mortgageLender || null) : current.mortgageLender,
        notes: typeof body.notes === 'string' ? body.notes : current.notes,
        // Sprint 5.1a — housing-loan + 80EEA fields
        isSelfOccupied: typeof body.isSelfOccupied === 'boolean' ? body.isSelfOccupied : current.isSelfOccupied,
        homeLoanInterestPaidPaisa:
          typeof body.homeLoanInterestPaidRupees === 'number'
            ? Math.round(body.homeLoanInterestPaidRupees * 100)
            : current.homeLoanInterestPaidPaisa,
        homeLoanDisbursedDate:
          typeof body.homeLoanDisbursedDate === 'string'
            ? (body.homeLoanDisbursedDate || null)
            : current.homeLoanDisbursedDate,
        isFirstHome: typeof body.isFirstHome === 'boolean' ? body.isFirstHome : current.isFirstHome,
        stampValuePaisa:
          typeof body.stampValueRupees === 'number'
            ? Math.round(body.stampValueRupees * 100)
            : current.stampValuePaisa,
        carpetAreaSqft:
          typeof body.carpetAreaSqft === 'number' ? body.carpetAreaSqft : current.carpetAreaSqft,
        // Sprint 5.12 — retirement intent (sell/rental_only/self_occupied)
        retirementTreatment,
        updatedAt: new Date(),
      })
      .where(and(eq(realEstate.id, numericId), eq(realEstate.userId, session.user.id)))
      .returning();
    return NextResponse.json({ property: result[0] });
  } catch (err) {
    console.error('Failed to update property:', err);
    return NextResponse.json({ error: 'Failed to update property' }, { status: 500 });
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
    await db.delete(realEstate).where(and(eq(realEstate.id, numericId), eq(realEstate.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete property:', err);
    return NextResponse.json({ error: 'Failed to delete property' }, { status: 500 });
  }
}
