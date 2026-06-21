/**
 * POST /api/imports/yeswanth-taxcalc — Sprint 5.1d.
 *
 * Upload a Yeswanth TaxCalc xlsx file, parse into a preview JSON
 * (NO database writes). The preview is returned plus an importId that
 * the confirm endpoint uses to retrieve the parsed payload again.
 *
 * Safety:
 *  • Auth-gated. Each upload stored under uploads/<userId>/
 *    yeswanth-imports/<timestamp>.xlsx (gitignored).
 *  • Strict MIME + 5 MB size cap.
 *  • Re-parsing the same file yields the same preview (deterministic).
 *  • Parsed contents are NOT logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseYeswanthTaxCalc } from '@/lib/yeswanth-parser';
import { db, salaryIncome, taxDeductions, tdsCredits, capitalGains } from '@/db';

// Marker the confirm route stamps on every imported row. Lets us list +
// reverse an import with no schema change (see ./confirm/route.ts).
const YESWANTH_NOTE = 'Imported from Yeswanth TaxCalc%';
/** tds_credits rows the import creates: taxes-paid (deductor='IMPORTED')
 *  and bank-interest (notes 'Imported (FD interest…')). */
const tdsImportedMarker = () =>
  or(eq(tdsCredits.deductorName, 'IMPORTED'), like(tdsCredits.notes, 'Imported (FD interest%'));

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers
]);

/** userId-first per convention: uploads/<userId>/yeswanth-imports/.
 *  Keep in lockstep with ./confirm/route.ts, which reconstructs the
 *  same path from userId + importId. */
const uploadDirFor = (userId: string) =>
  path.join(process.cwd(), 'uploads', userId, 'yeswanth-imports');

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field required' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File exceeds 5 MB limit' }, { status: 400 });
    }
    if (file.type && !ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: `Unsupported MIME: ${file.type}` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Parse FIRST — if the parser rejects, don't bother writing the file.
    let preview;
    try {
      preview = await parseYeswanthTaxCalc(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Parse error';
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // Persist file for confirm endpoint to read back.
    const userDir = uploadDirFor(userId);
    await fs.mkdir(userDir, { recursive: true });
    const importId = crypto.randomBytes(16).toString('hex');
    const filePath = path.join(userDir, `${importId}.xlsx`);
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({
      importId,
      preview,
    });
  } catch (err) {
    console.error('[imports/yeswanth-taxcalc POST]', err);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}

/**
 * GET /api/imports/yeswanth-taxcalc — list applied imports, grouped by
 * financial year, with per-table counts. Powers the "Applied imports"
 * section on /tax/import so the user can review + delete an import.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const byFy = new Map<
      string,
      { fy: string; salary: number; deductions: number; tds: number; capitalGains: number }
    >();
    const bump = (fy: string, key: 'salary' | 'deductions' | 'tds' | 'capitalGains', n: number) => {
      const row = byFy.get(fy) ?? { fy, salary: 0, deductions: 0, tds: 0, capitalGains: 0 };
      row[key] += n;
      byFy.set(fy, row);
    };
    const countCol = sql<number>`count(*)::int`;

    const [sal, ded, tds, cg] = await Promise.all([
      db.select({ fy: salaryIncome.financialYear, n: countCol }).from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), like(salaryIncome.notes, YESWANTH_NOTE)))
        .groupBy(salaryIncome.financialYear),
      db.select({ fy: taxDeductions.financialYear, n: countCol }).from(taxDeductions)
        .where(and(eq(taxDeductions.userId, userId), like(taxDeductions.notes, YESWANTH_NOTE)))
        .groupBy(taxDeductions.financialYear),
      db.select({ fy: tdsCredits.financialYear, n: countCol }).from(tdsCredits)
        .where(and(eq(tdsCredits.userId, userId), tdsImportedMarker()))
        .groupBy(tdsCredits.financialYear),
      db.select({ fy: capitalGains.financialYear, n: countCol }).from(capitalGains)
        .where(and(eq(capitalGains.userId, userId), like(capitalGains.notes, YESWANTH_NOTE)))
        .groupBy(capitalGains.financialYear),
    ]);
    for (const r of sal) bump(r.fy, 'salary', r.n);
    for (const r of ded) bump(r.fy, 'deductions', r.n);
    for (const r of tds) bump(r.fy, 'tds', r.n);
    for (const r of cg) bump(r.fy, 'capitalGains', r.n);

    const imports = [...byFy.values()].sort((a, b) => b.fy.localeCompare(a.fy));
    return NextResponse.json({ imports });
  } catch (err) {
    console.error('[imports/yeswanth-taxcalc GET]', err);
    return NextResponse.json({ error: 'Failed to list imports' }, { status: 500 });
  }
}

/**
 * DELETE /api/imports/yeswanth-taxcalc?fy=YYYY-YY — reverse a Yeswanth
 * import for one financial year. Deletes only marker-stamped rows, in a
 * single transaction, scoped to the user + FY. Manually-entered rows
 * (no import marker) are untouched.
 *
 * Not reversed: user_preferences setup flags (merged in place — the prior
 * values aren't recoverable). Surfaced as a caveat in the UI.
 */
export async function DELETE(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const fy = new URL(request.url).searchParams.get('fy');
  if (!fy || !/^\d{4}-\d{2}$/.test(fy)) {
    return NextResponse.json({ error: 'fy query param required (YYYY-YY)' }, { status: 400 });
  }
  try {
    const deleted = await db.transaction(async (tx) => {
      const sal = await tx.delete(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy), like(salaryIncome.notes, YESWANTH_NOTE)))
        .returning({ id: salaryIncome.id });
      const ded = await tx.delete(taxDeductions)
        .where(and(eq(taxDeductions.userId, userId), eq(taxDeductions.financialYear, fy), like(taxDeductions.notes, YESWANTH_NOTE)))
        .returning({ id: taxDeductions.id });
      const tds = await tx.delete(tdsCredits)
        .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy), tdsImportedMarker()))
        .returning({ id: tdsCredits.id });
      const cg = await tx.delete(capitalGains)
        .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy), like(capitalGains.notes, YESWANTH_NOTE)))
        .returning({ id: capitalGains.id });
      return { salary: sal.length, deductions: ded.length, tds: tds.length, capitalGains: cg.length };
    });
    return NextResponse.json({ success: true, fy, deleted });
  } catch (err) {
    console.error('[imports/yeswanth-taxcalc DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete import' }, { status: 500 });
  }
}
