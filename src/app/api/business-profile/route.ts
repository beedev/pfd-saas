import { NextRequest, NextResponse } from 'next/server';
import { db, businessProfile } from '@/db';
import { and, eq } from 'drizzle-orm';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { validateGSTIN, extractPAN, extractStateCode } from '@/lib/validations/gstin';

// GET - Fetch business profile
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const profiles = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.userId, userId))
      .limit(1);
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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
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

    // Check if profile exists for this user
    const existingProfiles = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.userId, userId))
      .limit(1);
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
        .where(and(eq(businessProfile.id, existing.id), eq(businessProfile.userId, userId)));
      savedProfile = { ...existing, ...profileData };
    } else {
      // Create new profile
      const result = await db.insert(businessProfile).values({
        userId: userId,
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

// PATCH - lightweight update of the taxpayer's date of birth only (used with
// PAN to auto-derive the AIS/TIS PDF password). Avoids re-validating the whole
// GST profile just to set DOB.
export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const raw = typeof body.dob === 'string' ? body.dob.trim() : '';
    const dob = raw || null;
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob) && !/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(dob)) {
      return NextResponse.json(
        { error: 'Date of birth must be YYYY-MM-DD or DD/MM/YYYY' },
        { status: 400 },
      );
    }
    const [existing] = await db
      .select({ id: businessProfile.id })
      .from(businessProfile)
      .where(eq(businessProfile.userId, userId))
      .limit(1);
    if (!existing) {
      return NextResponse.json(
        { error: 'Set up your business/tax profile first.' },
        { status: 400 },
      );
    }
    await db
      .update(businessProfile)
      .set({ dob, updatedAt: new Date() })
      .where(and(eq(businessProfile.id, existing.id), eq(businessProfile.userId, userId)));
    return NextResponse.json({ ok: true, dob });
  } catch (error) {
    console.error('[business-profile PATCH dob]', error);
    return NextResponse.json({ error: 'Failed to update date of birth' }, { status: 500 });
  }
}
