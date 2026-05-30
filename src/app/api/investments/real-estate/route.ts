import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db, realEstate, type PropertyType, type PropertyStatus } from '@/db';

const VALID_TYPES: PropertyType[] = ['RESIDENTIAL', 'COMMERCIAL', 'LAND', 'PLOT'];

export async function GET() {
  try {
    const rows = await db.select().from(realEstate).orderBy(desc(realEstate.createdAt));
    return NextResponse.json({ properties: rows });
  } catch (err) {
    console.error('Failed to fetch properties:', err);
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }
}

interface CreateBody {
  propertyName?: string;
  type?: PropertyType;
  status?: PropertyStatus;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  area?: number;
  builtUpArea?: number;
  purchasePriceRupees?: number;
  purchaseDate?: string;
  currentValuationRupees?: number;
  valuationDate?: string;
  valuationMethod?: string;
  hasLoan?: boolean;
  mortgageAmountRupees?: number;
  mortgageEmiRupees?: number;
  mortgageRate?: number;
  mortgageLender?: string;
  mortgageEndDate?: string;
  isRented?: boolean;
  monthlyRentRupees?: number;
  notes?: string;
  isUnderConstruction?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody;
    if (!body.propertyName) {
      return NextResponse.json({ error: 'propertyName is required' }, { status: 400 });
    }
    if (!body.type || !VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }
    if (!body.address || !body.city || !body.state) {
      return NextResponse.json({ error: 'address, city, state are required' }, { status: 400 });
    }
    if (typeof body.area !== 'number' || body.area <= 0) {
      return NextResponse.json({ error: 'area must be > 0' }, { status: 400 });
    }
    if (!body.purchaseDate) {
      return NextResponse.json({ error: 'purchaseDate is required' }, { status: 400 });
    }

    const purchasePrice = Math.round((body.purchasePriceRupees ?? 0) * 100);
    const currentValuation = Math.round((body.currentValuationRupees ?? body.purchasePriceRupees ?? 0) * 100);
    const gainLoss = currentValuation - purchasePrice;
    const gainLossPercent = purchasePrice > 0 ? (gainLoss / purchasePrice) * 100 : 0;

    const status: PropertyStatus = body.isUnderConstruction
      ? 'UNDER_CONSTRUCTION'
      : body.hasLoan
      ? 'MORTGAGED'
      : body.isRented
      ? 'RENTED'
      : 'OWNED';

    const result = await db
      .insert(realEstate)
      .values({
        propertyName: body.propertyName.trim(),
        type: body.type,
        status,
        address: body.address.trim(),
        city: body.city.trim(),
        state: body.state.trim(),
        pincode: body.pincode || null,
        area: body.area,
        areaUnit: 'sqft',
        builtUpArea: body.builtUpArea || null,
        purchasePrice,
        purchaseDate: body.purchaseDate,
        currentValuation,
        valuationDate: body.valuationDate || new Date().toISOString().slice(0, 10),
        gainLoss,
        gainLossPercent,
        mortgageAmount: body.hasLoan ? Math.round((body.mortgageAmountRupees ?? 0) * 100) : null,
        mortgageLender: body.hasLoan ? body.mortgageLender || null : null,
        mortgageRate: body.hasLoan ? body.mortgageRate || null : null,
        mortgageEndDate: body.hasLoan ? body.mortgageEndDate || null : null,
        monthlyRent: body.isRented ? Math.round((body.monthlyRentRupees ?? 0) * 100) : null,
        notes:
          [
            body.notes,
            body.valuationMethod ? `Valuation: ${body.valuationMethod}` : '',
            body.mortgageEmiRupees ? `EMI: ₹${body.mortgageEmiRupees}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ property: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create property';
    console.error('Failed to create property:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
