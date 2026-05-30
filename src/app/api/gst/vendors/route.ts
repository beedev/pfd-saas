import { NextRequest, NextResponse } from 'next/server';
import { db, vendors } from '@/db';
import { desc } from 'drizzle-orm';
import { validateGSTIN, extractStateCode } from '@/lib/validations/gstin';
import { isValidStateCode } from '@/constants/state-codes';

// GET - List all vendors
export async function GET() {
  try {
    const allVendors = await db
      .select()
      .from(vendors)
      .orderBy(desc(vendors.createdAt));

    return NextResponse.json({ vendors: allVendors });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vendors' },
      { status: 500 }
    );
  }
}

// POST - Create new vendor
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      gstin,
      pan,
      stateCode,
      address,
      city,
      pincode,
      email,
      phone,
    } = body;

    // Validate required fields - GSTIN is required for vendors (for ITC claims)
    if (!name || !gstin || !stateCode) {
      return NextResponse.json(
        { error: 'Name, GSTIN, and state code are required for vendors' },
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

    // Validate GSTIN (required for vendors)
    const validatedGstin = gstin.toUpperCase().trim();
    const gstinValidation = validateGSTIN(validatedGstin);
    if (!gstinValidation.isValid) {
      return NextResponse.json(
        { error: `Invalid GSTIN: ${gstinValidation.error}` },
        { status: 400 }
      );
    }

    // Verify GSTIN state code matches provided state code
    const gstinStateCode = extractStateCode(validatedGstin);
    if (gstinStateCode !== stateCode) {
      return NextResponse.json(
        { error: 'GSTIN state code does not match selected state' },
        { status: 400 }
      );
    }

    const result = await db.insert(vendors).values({
      name,
      gstin: validatedGstin,
      pan: pan?.toUpperCase().trim() || null,
      stateCode,
      address: address || null,
      city: city || null,
      pincode: pincode || null,
      email: email || null,
      phone: phone || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    return NextResponse.json({ vendor: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Error creating vendor:', error);
    return NextResponse.json(
      { error: 'Failed to create vendor' },
      { status: 500 }
    );
  }
}
