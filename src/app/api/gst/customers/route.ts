import { NextRequest, NextResponse } from 'next/server';
import { db, customers } from '@/db';
import { desc, eq } from 'drizzle-orm';
import { validateGSTIN, extractStateCode } from '@/lib/validations/gstin';
import { isValidStateCode } from '@/constants/state-codes';
import { auth } from '@/auth';

// GET - List all customers
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const allCustomers = await db
      .select()
      .from(customers)
      .where(eq(customers.userId, session.user.id))
      .orderBy(desc(customers.createdAt));

    return NextResponse.json({ customers: allCustomers });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

// POST - Create new customer
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const {
      name,
      gstin,
      pan,
      stateCode,
      supplyType,
      address,
      city,
      pincode,
      email,
      phone,
      tdsRatePct,
      tdsSection,
    } = body;

    // Validate required fields
    if (!name || !stateCode) {
      return NextResponse.json(
        { error: 'Name and state code are required' },
        { status: 400 }
      );
    }

    // Validate state code
    if (!isValidStateCode(stateCode)) {
      return NextResponse.json(
        { error: 'Invalid state code' },
        { status: 400 }
      );
    }

    // Determine if B2B based on GSTIN
    let isB2B = false;
    let validatedGstin = gstin?.toUpperCase().trim() || null;

    if (validatedGstin) {
      const gstinValidation = validateGSTIN(validatedGstin);
      if (!gstinValidation.isValid) {
        return NextResponse.json(
          { error: `Invalid GSTIN: ${gstinValidation.error}` },
          { status: 400 }
        );
      }
      isB2B = true;

      // Verify GSTIN state code matches provided state code
      const gstinStateCode = extractStateCode(validatedGstin);
      if (gstinStateCode !== stateCode) {
        return NextResponse.json(
          { error: 'GSTIN state code does not match selected state' },
          { status: 400 }
        );
      }
    }

    // Validate supply type
    const validSupplyTypes = ['REGULAR', 'EXPORT_WITH_IGST', 'EXPORT_LUT', 'SEZ'];
    const validatedSupplyType = validSupplyTypes.includes(supplyType) ? supplyType : 'REGULAR';

    // Sprint A.1 — TDS deduction config. Normalise to safe defaults so
    // legacy clients that don't send these fields still get usable values
    // (10% / '194J' matches the most common consulting case).
    const normalisedTdsRate =
      typeof tdsRatePct === 'number' && Number.isFinite(tdsRatePct) && tdsRatePct >= 0 && tdsRatePct <= 100
        ? tdsRatePct
        : 10;
    const normalisedTdsSection =
      typeof tdsSection === 'string' && tdsSection.trim().length > 0
        ? tdsSection.trim().toUpperCase()
        : '194J';

    const result = await db.insert(customers).values({
      userId: session.user.id,
      name,
      gstin: validatedGstin,
      pan: pan?.toUpperCase().trim() || null,
      stateCode,
      supplyType: validatedSupplyType,
      address: address || null,
      city: city || null,
      pincode: pincode || null,
      email: email || null,
      phone: phone || null,
      isB2B,
      tdsRatePct: normalisedTdsRate,
      tdsSection: normalisedTdsSection,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    return NextResponse.json({ customer: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}
