/**
 * POST /api/tax/ais-tis/upload — ingest an AIS or TIS PDF.
 *
 * The compliance-portal PDFs are PAN+DOB encrypted. We auto-derive the
 * password from the stored tax identity (business_profile.pan + .dob), try
 * both casings, and fall back to a manually-entered password. We parse only
 * aggregate totals (TIS income categories, AIS Part-B1 TDS) and upsert one
 * row per (user, FY, kind) — re-uploading refreshes the Gap Check.
 *
 * The password is used transiently for decryption only — never stored.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, businessProfile, aisImports } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseAisTis, derivePasswords } from '@/lib/finance/ais-tis-parser';

export const runtime = 'nodejs';

const MAX_BYTES = 15 * 1024 * 1024; // AIS can run to many pages

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  try {
    const form = await request.formData();
    const file = form.get('file');
    const manualPassword = ((form.get('password') as string | null) ?? '').trim() || null;
    const fyHint = ((form.get('fy') as string | null) ?? '').trim() || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Auto-derive from the stored tax identity; a manually-typed password wins.
    const [profile] = await db
      .select({ pan: businessProfile.pan, dob: businessProfile.dob })
      .from(businessProfile)
      .where(eq(businessProfile.userId, userId))
      .limit(1);
    const passwords = derivePasswords(profile?.pan, profile?.dob, manualPassword);

    let parsed;
    try {
      parsed = await parseAisTis(buffer, passwords);
    } catch (err) {
      if ((err as { code?: string })?.code === 'PDF_PASSWORD') {
        return NextResponse.json(
          {
            error: manualPassword
              ? "Couldn't unlock the PDF with that password."
              : 'This PDF is password-protected. Add your PAN + Date of Birth in settings, or enter the PDF password.',
            needsPassword: true,
          },
          { status: 400 },
        );
      }
      throw err;
    }

    const fy = parsed.fy || fyHint;
    if (!fy || !/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json(
        { error: 'Could not determine the financial year from the document.' },
        { status: 400 },
      );
    }

    // Persist the original (still-encrypted) file, userId-first per tenant convention.
    const dir = path.join(process.cwd(), 'uploads', userId, 'ais-tis');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${fy}-${parsed.kind}.pdf`), buffer);

    const [row] = await db
      .insert(aisImports)
      .values({
        userId,
        fy,
        kind: parsed.kind,
        pan: parsed.pan,
        categoriesJson: parsed.categories,
        tdsJson: parsed.tds,
        sourceFilename: file.name,
      })
      .onConflictDoUpdate({
        target: [aisImports.userId, aisImports.fy, aisImports.kind],
        set: {
          pan: parsed.pan,
          categoriesJson: parsed.categories,
          tdsJson: parsed.tds,
          sourceFilename: file.name,
          uploadedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json(
      {
        ok: true,
        kind: parsed.kind,
        fy,
        import: row,
        categories: parsed.categories.length,
        tdsSections: parsed.tds.length,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[ais-tis/upload]', err);
    return NextResponse.json({ error: 'Failed to process the document.' }, { status: 500 });
  }
}
