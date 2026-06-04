/**
 * Sprint 6.2b — Form 26AS reconciliation report data fetcher.
 *
 * Returns both halves of the diff:
 *   • tdsBookOurs — the user's manually-entered tds_credits rows
 *     (these become CSV_TDS2 / CSV_TDS3 in the ITR-3 utility).
 *   • form26asUploads — what the user uploaded as the govt's Form 26AS.
 *
 * The PDF/CSV present the two side-by-side per TAN so a CA can spot
 * a missing income or a duplicate entry. We DON'T attempt to auto-
 * match — the /tax/form-26as page already does that interactively
 * and stores its outcome on `tds_credits.isReconciled`.
 *
 * Deltas summary: per-upload total vs sum of our credits → simple
 * "books say ₹X · 26AS says ₹Y · delta ₹Z" trio used by the report
 * header.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db, tdsCredits, form26asUploads } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import type { ReportParams } from '@/types/reports';

export interface TdsRow {
  source: 'BOOKS' | '26AS';
  deductorName: string;
  deductorTan: string;
  section: string;
  incomePaisa: number;
  tdsPaisa: number;
  reconciled: boolean;
  notes: string;
}

export interface Form26asDelta {
  tan: string;
  deductorName: string;
  booksTdsPaisa: number;
  gov26asTdsPaisa: number;
  deltaPaisa: number;
}

export interface Form26asReconReportData {
  fy: string;
  booksRows: TdsRow[];
  uploadRows: TdsRow[];
  deltas: Form26asDelta[];
  totals: {
    booksTdsPaisa: number;
    gov26asTdsPaisa: number;
    deltaPaisa: number;
  };
}

export async function fetchForm26asRecon(params: ReportParams): Promise<Form26asReconReportData> {
  const userId = params.userId;
  const fy = params.fy || getCurrentFinancialYear();

  const [credits, uploads] = await Promise.all([
    db
      .select()
      .from(tdsCredits)
      .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy)))
      .orderBy(desc(tdsCredits.tdsPaisa)),
    db
      .select()
      .from(form26asUploads)
      .where(and(eq(form26asUploads.userId, userId), eq(form26asUploads.fy, fy))),
  ]);

  const booksRows: TdsRow[] = credits.map((c) => ({
    source: 'BOOKS',
    deductorName: c.deductorName,
    deductorTan: c.deductorTan || '',
    section: c.section,
    incomePaisa: c.incomePaisa || 0,
    tdsPaisa: c.tdsPaisa || 0,
    reconciled: c.isReconciled,
    notes: c.notes || '',
  }));

  // form_26as_uploads is one row per parsed PDF; we surface each upload
  // as a single aggregated row (the PDF is government-issued and we
  // don't break it down per deductor in v1 — that's a parser upgrade).
  const uploadRows: TdsRow[] = uploads.map((u, i) => ({
    source: '26AS',
    deductorName: `Form 26AS upload #${i + 1}`,
    deductorTan: '',
    section: '',
    incomePaisa: u.parsedTotalIncomePaisa || 0,
    tdsPaisa: u.parsedTotalTdsPaisa || 0,
    reconciled: false,
    notes: u.parseNotes || '',
  }));

  // Deltas keyed by TAN — when the user's TDS rows share a TAN with
  // an upload total, the diff is meaningful. With v1's "one upload =
  // one bucket", deltas at TAN granularity require a richer parser;
  // we fall back to a single "All TANs" bucket comparing aggregate
  // totals. Caller renders the simpler trio in the header.
  const booksByTan = new Map<string, { name: string; tds: number }>();
  for (const c of credits) {
    const tan = c.deductorTan || 'UNKNOWN';
    const cur = booksByTan.get(tan) ?? { name: c.deductorName, tds: 0 };
    cur.tds += c.tdsPaisa || 0;
    booksByTan.set(tan, cur);
  }
  const deltas: Form26asDelta[] = [...booksByTan.entries()].map(([tan, v]) => ({
    tan,
    deductorName: v.name,
    booksTdsPaisa: v.tds,
    gov26asTdsPaisa: 0, // v1 doesn't break uploads down by TAN
    deltaPaisa: v.tds,
  }));

  const booksTdsPaisa = credits.reduce((s, r) => s + (r.tdsPaisa || 0), 0);
  const gov26asTdsPaisa = uploads.reduce((s, u) => s + (u.parsedTotalTdsPaisa || 0), 0);
  const deltaPaisa = booksTdsPaisa - gov26asTdsPaisa;

  return {
    fy,
    booksRows,
    uploadRows,
    deltas,
    totals: { booksTdsPaisa, gov26asTdsPaisa, deltaPaisa },
  };
}
