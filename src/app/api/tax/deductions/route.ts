import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, taxDeductions, taxDocuments } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { auth } from '@/auth';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || searchParams.get('financialYear');
  const section = searchParams.get('section');

  try {
    const conds = [eq(taxDeductions.userId, session.user.id)] as ReturnType<typeof eq>[];
    if (fy) conds.push(eq(taxDeductions.financialYear, fy));
    if (section) conds.push(eq(taxDeductions.section, section));
    const rows = await db
      .select()
      .from(taxDeductions)
      .where(and(...conds))
      .orderBy(desc(taxDeductions.createdAt));
    return NextResponse.json({ deductions: rows });
  } catch (err) {
    console.error('[tax/deductions GET]', err);
    return NextResponse.json({ error: 'Failed to fetch deductions' }, { status: 500 });
  }
}

interface CreateBody {
  financialYear?: string;
  section?: string;
  subType?: string;
  description?: string;
  amountRupees?: number;
  paymentDate?: string;
  paymentMethod?: string;
  recipientName?: string;
  recipientPan?: string;
  recipient80gNumber?: string;
  qualifyingPercent?: number;
  hasUpperLimit?: boolean;
  linkedAssetType?: string;
  linkedAssetId?: number;
  notes?: string;
  // Sprint 5.1c — explicit category/bucket. When omitted on 80G, we
  // derive from (qualifyingPercent + hasUpperLimit) for backward compat.
  eightyGCategory?: '50_NO_LIMIT' | '100_NO_LIMIT' | '50_WITH_LIMIT' | '100_WITH_LIMIT';
  eightyDBucket?: 'SELF_FAMILY' | 'PARENTS';
  /** Sprint 5.1c — explicit override for NEW-regime eligibility. */
  eligibleUnderNew?: boolean;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    // Sprint 5.2 commit 2 — support multipart/form-data so the wizard
    // can submit deduction + receipt/certificate atomically. Falls
    // through to the JSON path for backward-compat with the old POSTs.
    const contentType = request.headers.get('content-type') || '';
    let body: CreateBody;
    let receiptFile: File | null = null;
    let certificateFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const fd = await request.formData();
      const payload = fd.get('payload');
      if (typeof payload !== 'string') {
        return NextResponse.json(
          { error: 'multipart body requires JSON `payload` field' },
          { status: 400 },
        );
      }
      body = JSON.parse(payload) as CreateBody;
      const r = fd.get('receipt');
      const c = fd.get('certificate');
      if (r instanceof File && r.size > 0) receiptFile = r;
      if (c instanceof File && c.size > 0) certificateFile = c;
    } else {
      body = (await request.json()) as CreateBody;
    }

    if (!body.section) {
      return NextResponse.json({ error: 'section is required' }, { status: 400 });
    }
    if (typeof body.amountRupees !== 'number' || body.amountRupees < 0) {
      return NextResponse.json({ error: 'amountRupees must be a non-negative number' }, { status: 400 });
    }
    const amountPaisa = Math.round(body.amountRupees * 100);
    const fy = body.financialYear || getCurrentFinancialYear();

    // Sprint 5.1c — derive eightyGCategory if not provided explicitly.
    let eightyGCategory: string | null = body.eightyGCategory ?? null;
    if (!eightyGCategory && body.section === '80G' && body.qualifyingPercent != null) {
      const pct = body.qualifyingPercent === 100 ? '100' : '50';
      const limit = body.hasUpperLimit ? 'WITH_LIMIT' : 'NO_LIMIT';
      eightyGCategory = `${pct}_${limit}`;
    }
    const eightyDBucket: string | null = body.eightyDBucket ?? null;

    // 80CCD(2) (employer NPS) auto-eligible under NEW. Override via body.
    const sectionUpper = body.section.toUpperCase();
    const auto80ccd2 = sectionUpper.includes('80CCD(2)') || sectionUpper === '80CCD_2';
    const eligibleUnderNew = body.eligibleUnderNew ?? auto80ccd2;

    const result = await db
      .insert(taxDeductions)
      .values({
        userId: session.user.id,
        section: body.section,
        description: body.description || body.section,
        deductibleAmount: amountPaisa,
        availableLimit: 0,
        utilizableAmount: amountPaisa,
        incurredDate: body.paymentDate || new Date().toISOString().slice(0, 10),
        financialYear: fy,
        subType: body.subType || null,
        amountPaisa,
        paymentDate: body.paymentDate || null,
        paymentMethod: body.paymentMethod || null,
        recipientName: body.recipientName || null,
        recipientPan: body.recipientPan || null,
        recipient80gNumber: body.recipient80gNumber || null,
        qualifyingPercent: body.qualifyingPercent ?? null,
        hasUpperLimit: body.hasUpperLimit ?? false,
        linkedAssetType: body.linkedAssetType || null,
        linkedAssetId: body.linkedAssetId ?? null,
        notes: body.notes || null,
        eightyGCategory,
        eightyDBucket,
        eligibleUnderNew,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const deduction = result[0];

    // Sprint 5.2 — if multipart, upload files now. We don't get a real
    // PG transaction across deduction + filesystem writes, so on file
    // failure we roll back manually by deleting the deduction row +
    // any partially-written files.
    if (receiptFile || certificateFile) {
      const uploadedPaths: string[] = [];
      try {
        const baseDir = path.join(
          process.cwd(),
          'uploads',
          'tax-deductions',
          session.user.id,
        );
        await fs.promises.mkdir(baseDir, { recursive: true });

        for (const [file, kind, category] of [
          [receiptFile, 'receipt', 'DEDUCTION_RECEIPT'],
          [certificateFile, 'certificate', '80G_CERTIFICATE'],
        ] as const) {
          if (!file) continue;
          const ext = path.extname(file.name) || '.pdf';
          const safeExt = ext.replace(/[^.A-Za-z0-9]/g, '');
          const filename = `${deduction.id}-${kind}-${crypto.randomBytes(4).toString('hex')}${safeExt}`;
          const fullPath = path.join(baseDir, filename);
          const arrayBuffer = await file.arrayBuffer();
          await fs.promises.writeFile(fullPath, Buffer.from(arrayBuffer));
          uploadedPaths.push(fullPath);

          await db.insert(taxDocuments).values({
            userId: session.user.id,
            category,
            financialYear: fy,
            title: `${body.recipientName ?? body.section} — ${kind}`,
            filePath: fullPath,
            deductionId: deduction.id,
            uploadedAt: new Date(),
          });
        }
      } catch (uploadErr) {
        // Rollback: delete files + deduction row
        for (const p of uploadedPaths) {
          await fs.promises.unlink(p).catch(() => {});
        }
        await db
          .delete(taxDeductions)
          .where(eq(taxDeductions.id, deduction.id))
          .catch(() => {});
        console.error('[tax/deductions POST upload]', uploadErr);
        return NextResponse.json(
          { error: 'Deduction saved but document upload failed; rolled back' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ deduction }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create deduction';
    console.error('[tax/deductions POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
