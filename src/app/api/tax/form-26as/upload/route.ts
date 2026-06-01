/**
 * Form 26AS PDF upload — Sprint 4 Phase 2.
 *
 * Multipart POST. Stores the PDF on disk under
 *   uploads/form-26as/<userId>/<fy>-<epoch>.pdf
 * then attempts a best-effort regex sweep over the extracted text to
 * find headline TDS / total-income numbers.
 *
 * The parse is intentionally fragile-tolerant. Form 26AS PDF templates
 * differ across years and tax-filer types (individual vs business);
 * column extraction is unreliable. We just look for the highest-value
 * rupee amount that follows "Total Tax Deducted" / "Amount of Tax
 * Deducted" / "Grand Total" markers. If we can't find anything, we
 * still record the upload with parsed totals NULL so the user can
 * manually reconcile.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, form26asUploads } from '@/db';
import { auth } from '@/auth';
import { extractPdfText } from '@/lib/services/statement-parsers/pdf-text';

/** Pull a rupee amount out of "Total Tax Deducted ... ₹12,34,567.00". */
function parseTotals(text: string): {
  totalTdsPaisa: number | null;
  totalIncomePaisa: number | null;
  notes: string;
} {
  const notes: string[] = [];
  // Indian-format numbers: 12,34,567.00 or 1,234,567.00 or plain 1234567
  const numRe = /(?:₹|Rs\.?|INR)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;

  function findAfter(markers: string[]): number | null {
    for (const marker of markers) {
      const idx = text.toLowerCase().indexOf(marker.toLowerCase());
      if (idx < 0) continue;
      // Scan the next ~120 chars for the largest plausible rupee figure.
      const window = text.slice(idx, idx + 240);
      const matches = [...window.matchAll(numRe)];
      const candidates = matches
        .map((m) => parseFloat(m[1].replace(/,/g, '')))
        .filter((n) => Number.isFinite(n) && n >= 100); // skip page numbers / line nums
      if (candidates.length > 0) {
        // First plausible figure after the marker is usually the answer.
        // (Largest can be off when the marker is followed by row indices.)
        return Math.round(candidates[0] * 100);
      }
    }
    return null;
  }

  const totalTdsPaisa = findAfter([
    'Total Tax Deducted',
    'Total of Amount of Tax Deducted',
    'Total of Tax Deducted',
    'Amount of Tax Deducted',
    'Grand Total',
  ]);
  if (totalTdsPaisa == null) notes.push('Could not locate TDS total marker.');

  const totalIncomePaisa = findAfter([
    'Total Amount Paid/Credited',
    'Amount Paid/Credited',
    'Total Amount Credited',
  ]);
  if (totalIncomePaisa == null) notes.push('Could not locate income total marker.');

  return {
    totalTdsPaisa,
    totalIncomePaisa,
    notes: notes.join(' '),
  };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const fy = formData.get('fy') as string | null;

    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });
    if (!/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json({ error: 'fy must be YYYY-YY' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Per-user dir so account deletion can `rm -rf uploads/form-26as/<id>`
    const userId = session.user.id;
    const dir = path.join(process.cwd(), 'uploads', 'form-26as', userId);
    await fs.promises.mkdir(dir, { recursive: true });
    const ts = Date.now();
    const ext = path.extname(file.name) || '.pdf';
    const absPath = path.join(dir, `${fy}-${ts}${ext}`);
    await fs.promises.writeFile(absPath, buffer);
    const relPath = path.relative(process.cwd(), absPath);

    // Best-effort PDF text extraction + total-TDS detection. Failure is
    // logged but never blocks the upload — the user always has the
    // manual reconciliation flow.
    let parsedTotalTdsPaisa: number | null = null;
    let parsedTotalIncomePaisa: number | null = null;
    let parseNotes = '';
    try {
      const text = await extractPdfText(buffer);
      const parsed = parseTotals(text);
      parsedTotalTdsPaisa = parsed.totalTdsPaisa;
      parsedTotalIncomePaisa = parsed.totalIncomePaisa;
      parseNotes = parsed.notes;
    } catch (err) {
      parseNotes = `Parse failed: ${err instanceof Error ? err.message : 'unknown'}`;
      console.error('[tax/form-26as/upload parse]', err);
    }

    const [row] = await db
      .insert(form26asUploads)
      .values({
        userId,
        fy,
        filePath: relPath,
        parsedTotalTdsPaisa,
        parsedTotalIncomePaisa,
        parsedAt: new Date(),
        parseNotes: parseNotes || null,
      })
      .returning();

    return NextResponse.json({ upload: row }, { status: 201 });
  } catch (err) {
    console.error('[tax/form-26as/upload POST]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

/** Used by the page to delete an erroneous upload + ON DELETE SET NULL
 *  the FK on tds_credits.reconciled_via_upload_id. */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    // Look up to confirm ownership and to delete the file from disk.
    const [existing] = await db
      .select()
      .from(form26asUploads)
      .where(
        and(eq(form26asUploads.id, id), eq(form26asUploads.userId, session.user.id)),
      )
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    try {
      const abs = path.join(process.cwd(), existing.filePath);
      await fs.promises.unlink(abs);
    } catch {
      // File may already be gone — don't fail the API call.
    }

    await db
      .delete(form26asUploads)
      .where(
        and(eq(form26asUploads.id, id), eq(form26asUploads.userId, session.user.id)),
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[tax/form-26as/upload DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
