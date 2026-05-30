import { NextRequest, NextResponse } from 'next/server';
import { db, customers } from '@/db';
import { eq } from 'drizzle-orm';
import { validateGSTIN, extractStateCode } from '@/lib/validations/gstin';
import { isValidStateCode } from '@/constants/state-codes';

// GET - Fetch single customer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
    }

    const result = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    return NextResponse.json({ customer: result[0] });
  } catch (error) {
    console.error('Error fetching customer:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customer' },
      { status: 500 }
    );
  }
}

// PUT - Update customer
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
    }

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

    await db
      .update(customers)
      .set({
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
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId));

    const updated = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    return NextResponse.json({ customer: updated[0] });
  } catch (error) {
    console.error('Error updating customer:', error);
    return NextResponse.json(
      { error: 'Failed to update customer' },
      { status: 500 }
    );
  }
}

// DELETE - Delete customer
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
    }

    await db.delete(customers).where(eq(customers.id, customerId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return NextResponse.json(
      { error: 'Failed to delete customer' },
      { status: 500 }
    );
  }
}
