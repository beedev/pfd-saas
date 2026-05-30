import { NextRequest, NextResponse } from 'next/server';
import { db, businessProfile } from '@/db';
import { eq } from 'drizzle-orm';
import { validateGSTIN, extractPAN, extractStateCode } from '@/lib/validations/gstin';

// GET - Fetch business profile
export async function GET() {
  try {
    const profiles = await db.select().from(businessProfile).limit(1);
    const profile = profiles[0] || null;
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Error fetching business profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch business profile' },
      { status: 500 }
    );
  }
}

// POST - Create or update business profile
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      businessName,
      tradeName,
      gstin,
      address,
      city,
      pincode,
      email,
      phone,
      financialYear,
      invoicePrefix,
      invoiceStartNumber,
    } = body;

    // Validate GSTIN
    const gstinValidation = validateGSTIN(gstin);
    if (!gstinValidation.isValid) {
      return NextResponse.json(
        { error: gstinValidation.error },
        { status: 400 }
      );
    }

    // Extract PAN and state code from GSTIN
    const pan = extractPAN(gstin) || '';
    const stateCode = extractStateCode(gstin) || '';

    // Check if profile exists
    const existingProfiles = await db.select().from(businessProfile).limit(1);
    const existing = existingProfiles[0];

    const profileData = {
      businessName,
      tradeName: tradeName || null,
      gstin: gstin.toUpperCase(),
      pan,
      stateCode,
      address: address || null,
      city: city || null,
      pincode: pincode || null,
      email: email || null,
      phone: phone || null,
      financialYear,
      invoicePrefix: invoicePrefix || null,
      invoiceStartNumber: invoiceStartNumber || 1,
      updatedAt: new Date(),
    };

    let savedProfile;

    if (existing) {
      // Update existing profile
      await db
        .update(businessProfile)
        .set(profileData)
        .where(eq(businessProfile.id, existing.id));
      savedProfile = { ...existing, ...profileData };
    } else {
      // Create new profile
      const result = await db.insert(businessProfile).values({
        ...profileData,
        createdAt: new Date(),
      }).returning();
      savedProfile = result[0];
    }

    return NextResponse.json({ profile: savedProfile });
  } catch (error) {
    console.error('Error saving business profile:', error);
    return NextResponse.json(
      { error: 'Failed to save business profile' },
      { status: 500 }
    );
  }
}
