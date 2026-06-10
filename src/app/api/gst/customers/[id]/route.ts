import { NextRequest, NextResponse } from 'next/server';
import { db, customers, type SupplyType } from '@/db';
import { and, eq } from 'drizzle-orm';
import { validateGSTIN, extractStateCode } from '@/lib/validations/gstin';
import { isValidStateCode } from '@/constants/state-codes';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';
import { customerBodySchema } from '../schema';

// GET - Fetch single customer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
    }

    const result = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.userId, userId)))
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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
    }

    const parsed = await parseBody(request, customerBodySchema);
    if (parsed.error) return parsed.error;
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
    } = parsed.data;

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

    // Validate supply type (unknown values silently coerce to REGULAR, as before)
    const validSupplyTypes: readonly string[] = ['REGULAR', 'EXPORT_WITH_IGST', 'EXPORT_LUT', 'SEZ'];
    const validatedSupplyType: SupplyType =
      supplyType && validSupplyTypes.includes(supplyType) ? (supplyType as SupplyType) : 'REGULAR';

    // Sprint A.1 — TDS deduction config. Only patch when the client
    // actually sends the field; absent → keep existing DB value.
    const tdsPatch: { tdsRatePct?: number; tdsSection?: string } = {};
    if (typeof tdsRatePct === 'number' && Number.isFinite(tdsRatePct) && tdsRatePct >= 0 && tdsRatePct <= 100) {
      tdsPatch.tdsRatePct = tdsRatePct;
    }
    if (typeof tdsSection === 'string' && tdsSection.trim().length > 0) {
      tdsPatch.tdsSection = tdsSection.trim().toUpperCase();
    }

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
        ...tdsPatch,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, customerId), eq(customers.userId, userId)));

    const updated = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.userId, userId)))
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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const customerId = parseInt(id, 10);

    if (isNaN(customerId)) {
      return NextResponse.json({ error: 'Invalid customer ID' }, { status: 400 });
    }

    await db.delete(customers).where(and(eq(customers.id, customerId), eq(customers.userId, userId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return NextResponse.json(
      { error: 'Failed to delete customer' },
      { status: 500 }
    );
  }
}
