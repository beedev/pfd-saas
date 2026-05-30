import { NextRequest, NextResponse } from 'next/server';
import { db, vendors } from '@/db';
import { eq } from 'drizzle-orm';
import { validateGSTIN, extractStateCode } from '@/lib/validations/gstin';
import { isValidStateCode } from '@/constants/state-codes';

// GET - Fetch single vendor
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vendorId = parseInt(id, 10);

    if (isNaN(vendorId)) {
      return NextResponse.json({ error: 'Invalid vendor ID' }, { status: 400 });
    }

    const result = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, vendorId))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    }

    return NextResponse.json({ vendor: result[0] });
  } catch (error) {
    console.error('Error fetching vendor:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vendor' },
      { status: 500 }
    );
  }
}

// PUT - Update vendor
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vendorId = parseInt(id, 10);

    if (isNaN(vendorId)) {
      return NextResponse.json({ error: 'Invalid vendor ID' }, { status: 400 });
    }

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

    // Validate required fields
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

    // Validate GSTIN
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

    await db
      .update(vendors)
      .set({
        name,
        gstin: validatedGstin,
        pan: pan?.toUpperCase().trim() || null,
        stateCode,
        address: address || null,
        city: city || null,
        pincode: pincode || null,
        email: email || null,
        phone: phone || null,
        updatedAt: new Date(),
      })
      .where(eq(vendors.id, vendorId));

    const updated = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, vendorId))
      .limit(1);

    return NextResponse.json({ vendor: updated[0] });
  } catch (error) {
    console.error('Error updating vendor:', error);
    return NextResponse.json(
      { error: 'Failed to update vendor' },
      { status: 500 }
    );
  }
}

// DELETE - Delete vendor
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vendorId = parseInt(id, 10);

    if (isNaN(vendorId)) {
      return NextResponse.json({ error: 'Invalid vendor ID' }, { status: 400 });
    }

    await db.delete(vendors).where(eq(vendors.id, vendorId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    return NextResponse.json(
      { error: 'Failed to delete vendor' },
      { status: 500 }
    );
  }
}
