/**
 * Form 16 upload — Sprint B (saas back-port).
 *
 * Two modes:
 *   - multipart/form-data with file + fy → parse PDF, store as 'PDF'
 *   - application/json body with fields → store as 'MANUAL'
 *
 * The Part-B parser lives in lib/services/statement-parsers/form16.ts
 * (row-anchored; see that file). Failure to parse is non-fatal — the
 * upload still persists so the user can fall back to the /tax/form-16/[id]
 * edit page, which is the canonical place to correct anything.
 *
 * Multi-tenant: every row is user-scoped. Uploaded PDFs land under
 *   uploads/<userId>/form-16/<fy>-<epoch>.pdf
 * The two-part MERGE keys on (userId, employerTan, fy) so a second part
 * (either order) fills the missing half of an existing row instead of
 * creating a duplicate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, form16Uploads } from '@/db';
import { auth } from '@/auth';
import { extractPdfText, extractPdfRows } from '@/lib/services/statement-parsers/pdf-text';
import {
  parseForm16,
  rupeesNumberToPaisa,
  type Form16ParseResult,
} from '@/lib/services/statement-parsers/form16';

const MAX_BYTES = 5 * 1024 * 1024;

// ─── handlers ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;
  try {
    const contentType = request.headers.get('content-type') || '';

    // Manual entry — application/json
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const fy: string | undefined = body.fy;
      if (!fy || !/^\d{4}-\d{2}$/.test(fy)) {
        return NextResponse.json({ error: 'fy must be YYYY-YY' }, { status: 400 });
      }
      const employerName = String(body.employerName || '').trim();
      const employerTan = String(body.employerTan || '').trim().toUpperCase();
      if (!employerName) {
        return NextResponse.json({ error: 'employerName required' }, { status: 400 });
      }
      if (!employerTan) {
        return NextResponse.json({ error: 'employerTan required' }, { status: 400 });
      }

      const [row] = await db
        .insert(form16Uploads)
        .values({
          userId,
          fy,
          employerName,
          employerTan,
          sourceKind: 'MANUAL',
          sourceFilename: null,
          grossSalaryPaisa: rupeesNumberToPaisa(body.grossSalaryRupees ?? 0),
          hraExemptionPaisa: rupeesNumberToPaisa(body.hraExemptionRupees ?? 0),
          exemptAllowancesPaisa: rupeesNumberToPaisa(body.exemptAllowancesRupees ?? 0),
          standardDeductionPaisa: rupeesNumberToPaisa(body.standardDeductionRupees ?? 0),
          professionalTaxPaisa: rupeesNumberToPaisa(body.professionalTaxRupees ?? 0),
          taxableSalaryPaisa: rupeesNumberToPaisa(body.taxableSalaryRupees ?? 0),
          totalTaxableIncomePaisa: rupeesNumberToPaisa(body.totalTaxableIncomeRupees ?? 0),
          taxOnTotalIncomePaisa: rupeesNumberToPaisa(body.taxOnTotalIncomeRupees ?? 0),
          netTaxPayablePaisa: rupeesNumberToPaisa(body.netTaxPayableRupees ?? 0),
          totalTdsPaisa: rupeesNumberToPaisa(body.totalTdsRupees ?? 0),
          quarterlyTdsQ1Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ1Rupees ?? 0),
          quarterlyTdsQ2Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ2Rupees ?? 0),
          quarterlyTdsQ3Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ3Rupees ?? 0),
          quarterlyTdsQ4Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ4Rupees ?? 0),
          partsPresent: [
            body.taxableSalaryRupees || body.grossSalaryRupees ? 'B' : null,
            body.totalTdsRupees || body.quarterlyTdsQ1Rupees ? 'A' : null,
          ]
            .filter(Boolean)
            .join(','),
          notes: body.notes || null,
        })
        .returning();

      return NextResponse.json({ upload: row, parsed: null, manual: true }, { status: 201 });
    }

    // PDF — multipart/form-data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const fy = formData.get('fy') as string | null;

    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });
    if (!/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json({ error: 'fy must be YYYY-YY' }, { status: 400 });
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Per-tenant dir so account deletion can `rm -rf uploads/<userId>`
    const dir = path.join(process.cwd(), 'uploads', userId, 'form-16');
    await fs.promises.mkdir(dir, { recursive: true });
    const ts = Date.now();
    const absPath = path.join(dir, `${fy}-${ts}.pdf`);
    await fs.promises.writeFile(absPath, buffer);
    const relPath = path.relative(process.cwd(), absPath);

    let parsed: Form16ParseResult | null = null;
    let rawText: string | null = null;
    let parseError: string | null = null;
    try {
      const [rows, flat] = await Promise.all([
        extractPdfRows(buffer),
        extractPdfText(buffer),
      ]);
      rawText = flat;
      parsed = parseForm16(rows, flat);
    } catch (err) {
      parseError = `Parse failed: ${err instanceof Error ? err.message : 'unknown'}`;
      console.error('[tax/form-16/upload parse]', err);
    }

    // ── Merge model ──
    // One record per (userId, employer TAN, FY). Part A supplies TDS; Part
    // B supplies salary/tax. Uploading the second part (either order) fills
    // in the missing half instead of creating a duplicate. We only set the
    // fields the parsed part actually carries (non-null), so a Part A
    // upload never zeroes Part B's salary and vice versa.
    const part = parsed?.sourcePart ?? 'UNKNOWN';
    const tan = parsed?.employerTan || null;

    /** Only-if-present: undefined values are skipped by Drizzle .set(). */
    const onlyIf = <T,>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);
    const provided = {
      employerName: onlyIf(parsed?.employerName),
      grossSalaryPaisa: onlyIf(parsed?.grossSalaryPaisa),
      hraExemptionPaisa: onlyIf(parsed?.hraExemptionPaisa),
      exemptAllowancesPaisa: onlyIf(parsed?.exemptAllowancesPaisa),
      standardDeductionPaisa: onlyIf(parsed?.standardDeductionPaisa),
      professionalTaxPaisa: onlyIf(parsed?.professionalTaxPaisa),
      taxableSalaryPaisa: onlyIf(parsed?.taxableSalaryPaisa),
      totalTaxableIncomePaisa: onlyIf(parsed?.totalTaxableIncomePaisa),
      taxOnTotalIncomePaisa: onlyIf(parsed?.taxOnTotalIncomePaisa),
      netTaxPayablePaisa: onlyIf(parsed?.netTaxPayablePaisa),
      totalTdsPaisa: onlyIf(parsed?.totalTdsPaisa),
      quarterlyTdsQ1Paisa: onlyIf(parsed?.quarterlyTdsQ1Paisa),
      quarterlyTdsQ2Paisa: onlyIf(parsed?.quarterlyTdsQ2Paisa),
      quarterlyTdsQ3Paisa: onlyIf(parsed?.quarterlyTdsQ3Paisa),
      quarterlyTdsQ4Paisa: onlyIf(parsed?.quarterlyTdsQ4Paisa),
    };

    const mergeParts = (prev: string, p: string): string => {
      const set = new Set((prev || '').split(',').filter(Boolean));
      if (p === 'A' || p === 'B') set.add(p);
      return [...set].sort().join(',');
    };

    const existing =
      tan && tan !== 'UNKNOWN' && part !== 'UNKNOWN'
        ? (
            await db
              .select()
              .from(form16Uploads)
              .where(
                and(
                  eq(form16Uploads.userId, userId),
                  eq(form16Uploads.employerTan, tan),
                  eq(form16Uploads.fy, fy),
                ),
              )
              .limit(1)
          )[0]
        : undefined;

    let row;
    let merged = false;
    if (existing) {
      merged = true;
      [row] = await db
        .update(form16Uploads)
        .set({
          ...provided,
          sourceKind: 'PDF',
          sourceFilename: relPath,
          partsPresent: mergeParts(existing.partsPresent ?? '', part),
          rawText,
          notes: parseError || parsed?.notes || existing.notes || null,
        })
        .where(and(eq(form16Uploads.id, existing.id), eq(form16Uploads.userId, userId)))
        .returning();
    } else {
      [row] = await db
        .insert(form16Uploads)
        .values({
          userId,
          fy,
          // Fall back to "Unknown" — user is expected to fix via edit page.
          employerName: parsed?.employerName || 'Unknown — please edit',
          employerTan: parsed?.employerTan || 'UNKNOWN',
          sourceKind: 'PDF',
          sourceFilename: relPath,
          partsPresent: part === 'A' || part === 'B' ? part : '',
          grossSalaryPaisa: parsed?.grossSalaryPaisa ?? 0,
          hraExemptionPaisa: parsed?.hraExemptionPaisa ?? 0,
          exemptAllowancesPaisa: parsed?.exemptAllowancesPaisa ?? 0,
          standardDeductionPaisa: parsed?.standardDeductionPaisa ?? 0,
          professionalTaxPaisa: parsed?.professionalTaxPaisa ?? 0,
          taxableSalaryPaisa: parsed?.taxableSalaryPaisa ?? 0,
          totalTaxableIncomePaisa: parsed?.totalTaxableIncomePaisa ?? 0,
          taxOnTotalIncomePaisa: parsed?.taxOnTotalIncomePaisa ?? 0,
          netTaxPayablePaisa: parsed?.netTaxPayablePaisa ?? 0,
          totalTdsPaisa: parsed?.totalTdsPaisa ?? 0,
          quarterlyTdsQ1Paisa: parsed?.quarterlyTdsQ1Paisa ?? 0,
          quarterlyTdsQ2Paisa: parsed?.quarterlyTdsQ2Paisa ?? 0,
          quarterlyTdsQ3Paisa: parsed?.quarterlyTdsQ3Paisa ?? 0,
          quarterlyTdsQ4Paisa: parsed?.quarterlyTdsQ4Paisa ?? 0,
          rawText,
          notes: parseError || parsed?.notes || null,
        })
        .returning();
    }

    return NextResponse.json({ upload: row, parsed, merged, manual: false }, { status: 201 });
  } catch (err) {
    console.error('[tax/form-16/upload POST]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
