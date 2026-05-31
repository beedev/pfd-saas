import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, realEstate } from '@/db';
import { auth } from '@/auth';

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
