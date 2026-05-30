import { NextRequest, NextResponse } from 'next/server';
import { db, holdings } from '@/db';
import { eq } from 'drizzle-orm';

interface Params {
  params: Promise<{ id: string }>;
}

// GET /api/investments/stocks/:id
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const result = await db
      .select()
      .from(holdings)
      .where(eq(holdings.id, numericId))
      .limit(1);

    if (!result.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ holding: result[0] });
  } catch (error) {
    console.error('Error fetching holding:', error);
    return NextResponse.json(
      { error: 'Failed to fetch holding' },
      { status: 500 }
    );
  }
}

// PATCH /api/investments/stocks/:id — partial update (quantity/averagePrice/notes/etc)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const existing = await db
      .select()
      .from(holdings)
      .where(eq(holdings.id, numericId))
      .limit(1);

    if (!existing.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const current = existing[0];

    const quantity =
      typeof body.quantity === 'number' ? body.quantity : current.quantity;
    const averagePricePaisa =
      typeof body.averagePrice === 'number'
        ? Math.round(body.averagePrice * 100)
        : current.averagePrice;
    const currentPricePaisa =
      typeof body.currentPrice === 'number'
        ? Math.round(body.currentPrice * 100)
        : current.currentPrice;

    const totalInvestment = Math.round(quantity * averagePricePaisa);
    const currentValue = Math.round(quantity * currentPricePaisa);
    const gainLoss = currentValue - totalInvestment;
    const gainLossPercent =
      totalInvestment > 0 ? (gainLoss / totalInvestment) * 100 : 0;

    const result = await db
      .update(holdings)
      .set({
        quantity,
        averagePrice: averagePricePaisa,
        currentPrice: currentPricePaisa,
        totalInvestment,
        currentValue,
        gainLoss,
        gainLossPercent,
        purchaseDate: body.purchaseDate ?? current.purchaseDate,
        notes: body.notes ?? current.notes,
        updatedAt: new Date(),
      })
      .where(eq(holdings.id, numericId))
      .returning();

    return NextResponse.json({ holding: result[0] });
  } catch (error) {
    console.error('Error updating holding:', error);
    return NextResponse.json(
      { error: 'Failed to update holding' },
      { status: 500 }
    );
  }
}

// DELETE /api/investments/stocks/:id
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    await db.delete(holdings).where(eq(holdings.id, numericId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting holding:', error);
    return NextResponse.json(
      { error: 'Failed to delete holding' },
      { status: 500 }
    );
  }
}
