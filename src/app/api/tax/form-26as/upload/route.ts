/**
 * Form 26AS PDF upload — Sprint 4 Phase 2.
 *
 * Multipart POST. Stores the PDF on disk under
 *   uploads/<userId>/form-26as/<fy>-<epoch>.pdf
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
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { extractPdfRows } from '@/lib/services/statement-parsers/pdf-text';

const MAX_BYTES = 5 * 1024 * 1024;

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
function parseTotals(rows: string[]): {
  totalTdsPaisa: number | null;
  totalIncomePaisa: number | null;
  deductors: DeductorRow[];
  notes: string;
} {
  const notes: string[] = [];
  // Money values in 26AS always carry two decimals — TANs and section
  // codes never do. This single change eliminates the v0 false matches.
  const moneyRe = /([0-9][0-9,]*\.[0-9]{2})/g;
  // Money cell (whole-string): a single table cell that is a rupee value.
  const moneyCellRe = /^[0-9][0-9,]*\.[0-9]{2}$/;
  // TAN cell: 4 letters + 5 digits + 1 letter (e.g. CHEH02287F).
  const tanCellRe = /^[A-Z]{4}\d{5}[A-Z]$/;
  // Section cell: 192 / 194A / 194JB / 194IA … (TDS sections live in 19x).
  const sectionCellRe = /^19[0-9][A-Z]{0,3}$/;
  // Date in 26AS is "DD-Mon-YYYY".
  const dateCellRe = /^\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$/;

  const toPaisa = (s: string) => Math.round(parseFloat(s.replace(/,/g, '')) * 100);

  // ─── Per-section extraction from PART-I detail rows ──────────────
  // A deductor whose payments span multiple sections (e.g. salary 192
  // for Apr–Aug then professional 194JB for Sep–Mar under one employer)
  // emits ONE header row (grand totals) followed by per-transaction
  // detail rows, each carrying its own Section + amounts. The v1 parser
  // read only the header and dumped the whole grand total onto the first
  // section seen — destroying the split. v2 walks the detail rows and
  // aggregates Tax-Deducted by (TAN, section), so 26AS reconciliation
  // attributes salary vs business TDS correctly.
  //
  // Scope: PART-I only (regular TDS). PART-VI (TCS, 206C*) and the other
  // parts are skipped so collected-at-source amounts never leak in.
  interface SectionAgg {
    deductorName: string;
    tan: string;
    section: string;
    paidPaisa: number;
    tdsPaisa: number;
    depositedPaisa: number;
    lastDate: string | null;
  }
  const bySection = new Map<string, SectionAgg>();
  let inPartI = false;
  let current: { name: string; tan: string } | null = null;

  for (const raw of rows) {
    const flat = raw.replace(/\t/g, ' ').trim();
    // PART boundary — toggle so only PART-I detail rows are aggregated.
    const partMatch = flat.match(/^#?\s*PART-([IVX]+)\b/i);
    if (partMatch) {
      inPartI = partMatch[1].toUpperCase() === 'I';
      current = null;
      continue;
    }
    if (!inPartI) continue;

    const cells = raw.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const moneyCells = cells.filter((c) => moneyCellRe.test(c));
    const tanIdx = cells.findIndex((c) => tanCellRe.test(c));

    // Deductor header row: carries a TAN + the 3 grand-total money cells.
    // Capture the deductor identity; the section split comes from the
    // detail rows that follow (the grand totals themselves are ignored).
    if (tanIdx >= 0 && moneyCells.length >= 1) {
      const name = cells.slice(0, tanIdx).filter((c) => !/^\d{1,3}$/.test(c)).join(' ').trim();
      current = { name, tan: cells[tanIdx] };
      continue;
    }

    // Detail row: a section cell + at least 3 money cells (paid / tax
    // deducted / deposited). Aggregate Tax-Deducted by (TAN, section).
    const sectionCell = cells.find((c) => sectionCellRe.test(c));
    if (current && sectionCell && moneyCells.length >= 3) {
      const [paidPaisa, tdsPaisa, depositedPaisa] = moneyCells.slice(-3).map(toPaisa);
      const dateCell = cells.find((c) => dateCellRe.test(c)) ?? null;
      const section = sectionCell.toUpperCase();
      const key = `${current.tan}|${section}`;
      const agg = bySection.get(key) ?? {
        deductorName: current.name,
        tan: current.tan,
        section,
        paidPaisa: 0,
        tdsPaisa: 0,
        depositedPaisa: 0,
        lastDate: null,
      };
      agg.paidPaisa += paidPaisa;
      agg.tdsPaisa += tdsPaisa;
      agg.depositedPaisa += depositedPaisa;
      agg.lastDate = dateCell ?? agg.lastDate;
      bySection.set(key, agg);
    }
  }

  const deductors: DeductorRow[] = [...bySection.values()].map((a) => ({
    deductorName: a.deductorName,
    tan: a.tan,
    section: a.section,
    totalPaidPaisa: a.paidPaisa,
    totalTdsPaisa: a.tdsPaisa,
    totalDepositedPaisa: a.depositedPaisa,
    transactionDate: a.lastDate,
  }));

  // ─── Headline totals ─────────────────────────────────────────────
  // When per-section rows are present, headline = sum of them — that's
  // always correct and avoids the v0 marker-windowing pitfall.
  let totalTdsPaisa: number | null = null;
  let totalIncomePaisa: number | null = null;
  if (deductors.length > 0) {
    totalTdsPaisa = deductors.reduce((s, d) => s + d.totalTdsPaisa, 0);
    totalIncomePaisa = deductors.reduce((s, d) => s + d.totalPaidPaisa, 0);
  } else {
    // Fallback for scanned / non-tabular 26AS: flatten rows to a token
    // stream and do the v0 marker search (strict moneyRe so TAN/section
    // digits don't leak through).
    const text = rows.join(' ');
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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  try {
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

    // userId-first dir so account deletion can `rm -rf uploads/<id>`
    const dir = path.join(process.cwd(), 'uploads', userId, 'form-26as');
    await fs.promises.mkdir(dir, { recursive: true });
    const ts = Date.now();
    const absPath = path.join(dir, `${fy}-${ts}.pdf`);
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
      const rows = await extractPdfRows(buffer);
      const parsed = parseTotals(rows);
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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
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
        and(eq(form26asUploads.id, id), eq(form26asUploads.userId, userId)),
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
        and(eq(form26asUploads.id, id), eq(form26asUploads.userId, userId)),
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[tax/form-26as/upload DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
