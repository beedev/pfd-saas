/**
 * Form 16 upload — Sprint B (saas back-port).
 *
 * Two modes:
 *   - multipart/form-data with file + fy → parse PDF, store as 'PDF'
 *   - application/json body with fields → store as 'MANUAL'
 *
 * Parser is best-effort. Form 16 Part A (TRACES-generated) has a
 * reasonably stable structure that yields quarterly TDS + employer
 * TAN + name. Part B varies a lot across employers — we extract what
 * we can and leave 0s where we can't. The /tax/form-16/[id] edit page
 * is the canonical place to correct anything.
 *
 * Failure to parse is non-fatal — the upload still persists so the
 * user can fall back to manual editing.
 *
 * Multi-tenant: every row is user-scoped. Uploaded PDFs land under
 *   uploads/<userId>/form-16/<fy>-<epoch>.pdf
 * (note: tenant-folder-first, matching form-26as convention).
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db, form16Uploads } from '@/db';
import { auth } from '@/auth';
import { extractPdfText } from '@/lib/services/statement-parsers/pdf-text';

// ─── small utils ────────────────────────────────────────────────────────

function rupeesNumberToPaisa(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Find the next rupee-formatted number within `window` chars after the
 *  first match of any marker. Returns paisa, or null if nothing matched. */
function findAmountAfter(text: string, markers: string[], window = 200): number | null {
  const numRe = /(?:₹|Rs\.?|INR)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  for (const marker of markers) {
    const idx = text.toLowerCase().indexOf(marker.toLowerCase());
    if (idx < 0) continue;
    const chunk = text.slice(idx, idx + window);
    const matches = [...chunk.matchAll(numRe)];
    for (const m of matches) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(v) && v >= 100) return rupeesNumberToPaisa(v);
    }
  }
  return null;
}

/** Pull the employer TAN — TAN is 4 letters + 5 digits + 1 letter. */
function findTan(text: string): string | null {
  const labelled = text.match(
    /(?:TAN|TAN of (?:the )?Deductor|Tax Deduction.*Number)[^A-Z0-9]{0,20}([A-Z]{4}[0-9]{5}[A-Z])/i,
  );
  if (labelled) return labelled[1].toUpperCase();
  const any = text.match(/\b([A-Z]{4}[0-9]{5}[A-Z])\b/);
  return any ? any[1].toUpperCase() : null;
}

/** Pull the employer name — try a few label patterns; conservative. */
function findEmployerName(text: string): string | null {
  const m = text.match(
    /Name (?:and address )?of (?:the )?(?:Employer|Deductor)[\s:]*([A-Z0-9][^\n]{2,80})/i,
  );
  if (!m) return null;
  return m[1].split(/\s+(?:PAN|TAN|Address|TAN of)/i)[0].trim().slice(0, 120);
}

interface ParseResult {
  employerName: string | null;
  employerTan: string | null;
  grossSalaryPaisa: number | null;
  exemptAllowancesPaisa: number | null;
  standardDeductionPaisa: number | null;
  professionalTaxPaisa: number | null;
  taxableSalaryPaisa: number | null;
  totalTdsPaisa: number | null;
  quarterlyTdsQ1Paisa: number | null;
  quarterlyTdsQ2Paisa: number | null;
  quarterlyTdsQ3Paisa: number | null;
  quarterlyTdsQ4Paisa: number | null;
  notes: string;
}

function parseForm16(text: string): ParseResult {
  const notes: string[] = [];

  const employerName = findEmployerName(text);
  if (!employerName) notes.push('Could not locate employer name.');

  const employerTan = findTan(text);
  if (!employerTan) notes.push('Could not locate employer TAN.');

  // Part B headline buckets — labels vary, try a few.
  const grossSalaryPaisa = findAmountAfter(text, [
    'Gross Salary',
    'Salary as per provisions',
    'Total amount of salary received',
    'Total Salary',
  ]);
  const exemptAllowancesPaisa = findAmountAfter(text, [
    'Less: Allowances to the extent exempt',
    'Allowances exempt under section 10',
    'Exempt under section 10',
  ]);
  const standardDeductionPaisa = findAmountAfter(text, [
    'Standard deduction under section 16(ia)',
    'Standard deduction',
  ]);
  const professionalTaxPaisa = findAmountAfter(text, [
    'Tax on employment under section 16(iii)',
    'Professional tax',
  ]);
  const taxableSalaryPaisa = findAmountAfter(text, [
    'Income chargeable under the head Salaries',
    'Income from Salaries',
    'Taxable salary',
  ]);

  // Part A — quarterly TDS.
  const totalTdsPaisa = findAmountAfter(text, [
    'Total (Rs.)',
    'Total Tax Deducted',
    'Total TDS',
    'Grand Total',
  ]);
  const quarterlyTdsQ1Paisa = findAmountAfter(text, ['Quarter 1', 'Q1', 'Q-1'], 240);
  const quarterlyTdsQ2Paisa = findAmountAfter(text, ['Quarter 2', 'Q2', 'Q-2'], 240);
  const quarterlyTdsQ3Paisa = findAmountAfter(text, ['Quarter 3', 'Q3', 'Q-3'], 240);
  const quarterlyTdsQ4Paisa = findAmountAfter(text, ['Quarter 4', 'Q4', 'Q-4'], 240);

  if (totalTdsPaisa == null) notes.push('Could not locate total TDS.');
  if (
    quarterlyTdsQ1Paisa == null &&
    quarterlyTdsQ2Paisa == null &&
    quarterlyTdsQ3Paisa == null &&
    quarterlyTdsQ4Paisa == null
  ) {
    notes.push('Quarterly TDS breakdown not detected — Part A may be in image form.');
  }

  return {
    employerName,
    employerTan,
    grossSalaryPaisa,
    exemptAllowancesPaisa,
    standardDeductionPaisa,
    professionalTaxPaisa,
    taxableSalaryPaisa,
    totalTdsPaisa,
    quarterlyTdsQ1Paisa,
    quarterlyTdsQ2Paisa,
    quarterlyTdsQ3Paisa,
    quarterlyTdsQ4Paisa,
    notes: notes.join(' '),
  };
}

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
          exemptAllowancesPaisa: rupeesNumberToPaisa(body.exemptAllowancesRupees ?? 0),
          standardDeductionPaisa: rupeesNumberToPaisa(body.standardDeductionRupees ?? 0),
          professionalTaxPaisa: rupeesNumberToPaisa(body.professionalTaxRupees ?? 0),
          taxableSalaryPaisa: rupeesNumberToPaisa(body.taxableSalaryRupees ?? 0),
          totalTdsPaisa: rupeesNumberToPaisa(body.totalTdsRupees ?? 0),
          quarterlyTdsQ1Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ1Rupees ?? 0),
          quarterlyTdsQ2Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ2Rupees ?? 0),
          quarterlyTdsQ3Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ3Rupees ?? 0),
          quarterlyTdsQ4Paisa: rupeesNumberToPaisa(body.quarterlyTdsQ4Rupees ?? 0),
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Per-tenant dir so account deletion can `rm -rf uploads/<userId>`
    const dir = path.join(process.cwd(), 'uploads', userId, 'form-16');
    await fs.promises.mkdir(dir, { recursive: true });
    const ts = Date.now();
    const ext = path.extname(file.name) || '.pdf';
    const absPath = path.join(dir, `${fy}-${ts}${ext}`);
    await fs.promises.writeFile(absPath, buffer);
    const relPath = path.relative(process.cwd(), absPath);

    let parsed: ParseResult | null = null;
    let rawText: string | null = null;
    let parseError: string | null = null;
    try {
      rawText = await extractPdfText(buffer);
      parsed = parseForm16(rawText);
    } catch (err) {
      parseError = `Parse failed: ${err instanceof Error ? err.message : 'unknown'}`;
      console.error('[tax/form-16/upload parse]', err);
    }

    const [row] = await db
      .insert(form16Uploads)
      .values({
        userId,
        fy,
        // Fall back to "Unknown" — user is expected to fix via edit page.
        employerName: parsed?.employerName || 'Unknown — please edit',
        employerTan: parsed?.employerTan || 'UNKNOWN',
        sourceKind: 'PDF',
        sourceFilename: relPath,
        grossSalaryPaisa: parsed?.grossSalaryPaisa ?? 0,
        exemptAllowancesPaisa: parsed?.exemptAllowancesPaisa ?? 0,
        standardDeductionPaisa: parsed?.standardDeductionPaisa ?? 0,
        professionalTaxPaisa: parsed?.professionalTaxPaisa ?? 0,
        taxableSalaryPaisa: parsed?.taxableSalaryPaisa ?? 0,
        totalTdsPaisa: parsed?.totalTdsPaisa ?? 0,
        quarterlyTdsQ1Paisa: parsed?.quarterlyTdsQ1Paisa ?? 0,
        quarterlyTdsQ2Paisa: parsed?.quarterlyTdsQ2Paisa ?? 0,
        quarterlyTdsQ3Paisa: parsed?.quarterlyTdsQ3Paisa ?? 0,
        quarterlyTdsQ4Paisa: parsed?.quarterlyTdsQ4Paisa ?? 0,
        rawText,
        notes: parseError || parsed?.notes || null,
      })
      .returning();

    return NextResponse.json({ upload: row, parsed, manual: false }, { status: 201 });
  } catch (err) {
    console.error('[tax/form-16/upload POST]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
