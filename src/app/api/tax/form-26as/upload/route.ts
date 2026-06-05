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

interface DeductorRow {
  deductorName: string;
  tan: string;
  section: string | null;
  totalPaidPaisa: number;
  totalTdsPaisa: number;
  totalDepositedPaisa: number;
  transactionDate: string | null;
}

/**
 * Parse Form 26AS — the v0 parser matched bare digit runs, so TANs like
 * `CHEH02287F` and section codes like `194JB` were misread as currency.
 * v1: require decimals on every money match (`.00` is universal in 26AS
 * tables) and additionally pull per-deductor rows from PART-I so the
 * reconciliation can cross-match by TAN.
 */
function parseTotals(text: string): {
  totalTdsPaisa: number | null;
  totalIncomePaisa: number | null;
  deductors: DeductorRow[];
  notes: string;
} {
  const notes: string[] = [];
  // Money values in 26AS always carry two decimals — TANs and section
  // codes never do. This single change eliminates the v0 false matches.
  const moneyRe = /([0-9][0-9,]*\.[0-9]{2})/g;
  // TAN: 4 letters + 5 digits + 1 letter (e.g. CHEH02287F).
  const tanRe = /[A-Z]{4}\d{5}[A-Z]/g;
  // Section: 194 then 1-3 letters (194A, 194J, 194JB, 194IA, ...).
  const sectionRe = /\b(19[24][A-Z]{0,3})\b/g;
  // Date in 26AS is "DD-Mon-YYYY".
  const dateRe = /\b(\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4})\b/g;

  const toPaisa = (s: string) => Math.round(parseFloat(s.replace(/,/g, '')) * 100);

  // ─── Per-deductor extraction ─────────────────────────────────────
  // Find each TAN occurrence; the three .00 numbers that immediately
  // follow are paid / TDS / deposited. The two tokens before the TAN
  // are the deductor name run (any non-TAN word stream). Section + date
  // for the line follow further along on the same row.
  const deductors: DeductorRow[] = [];
  for (const tanMatch of text.matchAll(tanRe)) {
    const tan = tanMatch[0];
    const idx = tanMatch.index!;
    // Walk back up to 120 chars to collect deductor name tokens (skip
    // the row-number digit and the header words).
    const preWindow = text.slice(Math.max(0, idx - 150), idx).trim();
    const namePieces = preWindow.split(/\s+/);
    // Drop leading "<n>" row index and any header noise; deductor name
    // is everything between the last "N" Sr.No. integer and the TAN.
    let nameStart = namePieces.length - 1;
    while (nameStart > 0 && !/^\d{1,3}$/.test(namePieces[nameStart - 1])) nameStart--;
    const deductorName = namePieces.slice(nameStart).join(' ').replace(/^\d{1,3}\s+/, '').trim();

    // The next 800 chars after the TAN carry the three money values.
    const postWindow = text.slice(idx + tan.length, idx + tan.length + 800);
    const moneyMatches = [...postWindow.matchAll(moneyRe)].map((m) => toPaisa(m[1]));
    if (moneyMatches.length < 3) {
      notes.push(`Skipped TAN ${tan} — couldn't read 3 money values after it.`);
      continue;
    }
    const [totalPaidPaisa, totalTdsPaisa, totalDepositedPaisa] = moneyMatches;

    const sectionMatch = postWindow.match(sectionRe);
    const dateMatch = postWindow.match(dateRe);

    deductors.push({
      deductorName,
      tan,
      section: sectionMatch?.[0] ?? null,
      totalPaidPaisa,
      totalTdsPaisa,
      totalDepositedPaisa,
      transactionDate: dateMatch?.[0] ?? null,
    });
  }

  // ─── Headline totals ─────────────────────────────────────────────
  // When per-deductor rows are present, headline = sum of them — that's
  // always correct and avoids the v0 marker-windowing pitfall.
  let totalTdsPaisa: number | null = null;
  let totalIncomePaisa: number | null = null;
  if (deductors.length > 0) {
    totalTdsPaisa = deductors.reduce((s, d) => s + d.totalTdsPaisa, 0);
    totalIncomePaisa = deductors.reduce((s, d) => s + d.totalPaidPaisa, 0);
  } else {
    // Fallback marker search — same as v0 but with the strict moneyRe
    // so TAN/section digits no longer leak through.
    const findAfter = (markers: string[]): number | null => {
      for (const marker of markers) {
        const i = text.toLowerCase().indexOf(marker.toLowerCase());
        if (i < 0) continue;
        const window = text.slice(i, i + 400);
        const matches = [...window.matchAll(moneyRe)];
        for (const m of matches) {
          const n = toPaisa(m[1]);
          // Reject implausibly small values; 26AS rounds to whole rupees.
          if (n >= 100 * 100) return n;
        }
      }
      return null;
    };
    totalTdsPaisa = findAfter([
      'Total Tax Deducted', 'Total of Amount of Tax Deducted', 'Grand Total',
    ]);
    totalIncomePaisa = findAfter([
      'Total Amount Paid/Credited', 'Amount Paid/Credited',
    ]);
    if (totalTdsPaisa == null) notes.push('Could not locate TDS total marker.');
    if (totalIncomePaisa == null) notes.push('Could not locate income total marker.');
  }

  return { totalTdsPaisa, totalIncomePaisa, deductors, notes: notes.join(' ') };
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
    let parsedDeductorsJson: string | null = null;
    let parseNotes = '';
    try {
      const text = await extractPdfText(buffer);
      const parsed = parseTotals(text);
      parsedTotalTdsPaisa = parsed.totalTdsPaisa;
      parsedTotalIncomePaisa = parsed.totalIncomePaisa;
      parsedDeductorsJson = parsed.deductors.length > 0 ? JSON.stringify(parsed.deductors) : null;
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
        parsedDeductorsJson,
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
