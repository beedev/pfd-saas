/**
 * Form 16 single-upload endpoints — Sprint B (saas back-port).
 *
 * GET    /api/tax/form-16/[id] — fetch a single upload
 * PATCH  /api/tax/form-16/[id] — manual edit (any subset of fields)
 * DELETE /api/tax/form-16/[id] — delete + unlink PDF file
 *
 * Multi-tenant: every query scoped by session.user.id, including the
 * file unlink (which only operates on paths under
 * uploads/<userId>/form-16/).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, form16Uploads } from '@/db';
import { auth } from '@/auth';

function rupeesToPaisa(n: unknown): number | undefined {
  if (n === '' || n == null) return undefined;
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return Math.round(v * 100);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const uploadId = Number(id);
    if (!Number.isFinite(uploadId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const [row] = await db
      .select()
      .from(form16Uploads)
      .where(and(eq(form16Uploads.id, uploadId), eq(form16Uploads.userId, session.user.id)))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ upload: row });
  } catch (err) {
    console.error('[tax/form-16/[id] GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const uploadId = Number(id);
    if (!Number.isFinite(uploadId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await req.json();
    const patch: Record<string, unknown> = {};

    // Identification
    if (typeof body.fy === 'string' && /^\d{4}-\d{2}$/.test(body.fy)) {
      patch.fy = body.fy;
    }
    if (typeof body.employerName === 'string' && body.employerName.trim()) {
      patch.employerName = body.employerName.trim();
    }
    if (typeof body.employerTan === 'string' && body.employerTan.trim()) {
      patch.employerTan = body.employerTan.trim().toUpperCase();
    }
    if (typeof body.notes === 'string') patch.notes = body.notes || null;

    // Money fields — body sends rupees, we store paisa.
    const moneyFields: Array<[string, string]> = [
      ['grossSalaryRupees', 'grossSalaryPaisa'],
      ['hraExemptionRupees', 'hraExemptionPaisa'],
      ['exemptAllowancesRupees', 'exemptAllowancesPaisa'],
      ['standardDeductionRupees', 'standardDeductionPaisa'],
      ['professionalTaxRupees', 'professionalTaxPaisa'],
      ['taxableSalaryRupees', 'taxableSalaryPaisa'],
      ['totalTaxableIncomeRupees', 'totalTaxableIncomePaisa'],
      ['taxOnTotalIncomeRupees', 'taxOnTotalIncomePaisa'],
      ['netTaxPayableRupees', 'netTaxPayablePaisa'],
      ['totalTdsRupees', 'totalTdsPaisa'],
      ['quarterlyTdsQ1Rupees', 'quarterlyTdsQ1Paisa'],
      ['quarterlyTdsQ2Rupees', 'quarterlyTdsQ2Paisa'],
      ['quarterlyTdsQ3Rupees', 'quarterlyTdsQ3Paisa'],
      ['quarterlyTdsQ4Rupees', 'quarterlyTdsQ4Paisa'],
    ];
    for (const [inKey, dbKey] of moneyFields) {
      if (body[inKey] !== undefined) {
        const paisa = rupeesToPaisa(body[inKey]);
        if (paisa !== undefined) patch[dbKey] = paisa;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await db
      .update(form16Uploads)
      .set(patch)
      .where(and(eq(form16Uploads.id, uploadId), eq(form16Uploads.userId, session.user.id)));

    const [updated] = await db
      .select()
      .from(form16Uploads)
      .where(and(eq(form16Uploads.id, uploadId), eq(form16Uploads.userId, session.user.id)))
      .limit(1);

    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ upload: updated });
  } catch (err) {
    console.error('[tax/form-16/[id] PATCH]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const uploadId = Number(id);
    if (!Number.isFinite(uploadId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(form16Uploads)
      .where(and(eq(form16Uploads.id, uploadId), eq(form16Uploads.userId, session.user.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (existing.sourceFilename) {
      try {
        const abs = path.join(process.cwd(), existing.sourceFilename);
        await fs.promises.unlink(abs);
      } catch {
        // File may already be gone — non-fatal.
      }
    }

    await db
      .delete(form16Uploads)
      .where(and(eq(form16Uploads.id, uploadId), eq(form16Uploads.userId, session.user.id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[tax/form-16/[id] DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
