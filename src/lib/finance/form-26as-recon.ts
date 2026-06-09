/**
 * Per-TAN Form 26AS reconciliation library — Sprint 5.14.
 *
 * The legacy /tax/form-26as flow showed books rows and 26AS uploads in
 * two side-by-side columns with a single consolidated "Discrepancy ₹X"
 * headline computed as `26AS_total − books_total`. When the two sides
 * had disjoint deductor sets (common: demo seeds in books vs a real
 * employer in 26AS), that headline was meaningless and the page offered
 * no real reconciliation path.
 *
 * This module flips the model to per-TAN matching:
 *
 *   1. Group books rows (`tds_credits`) by `deductor_tan`.
 *   2. Group 26AS rows by TAN by unioning every upload's
 *      `parsed_deductors_json`. When the same TAN appears in multiple
 *      uploads we union the money values (each upload is a quarter, so
 *      summing reflects the year-to-date).
 *   3. Outer-join books × 26AS by TAN to produce `TanMatch` records,
 *      classify each as matched / partial / mismatch / unmatched-in-26as
 *      / unmatched-in-books, and produce a "likely explanation" string
 *      using a small heuristic ladder.
 *
 * Sections `194J` and `194JB` are treated as the same family for status
 * decisions (parsers commonly disagree on the trailing letter — both
 * are professional services TDS); the section list is still surfaced so
 * the UI can show what each side actually used.
 *
 * Everything is user-scoped — every query carries
 * `eq(<table>.userId, userId)` per saas multi-tenant convention.
 */

import { and, eq } from 'drizzle-orm';
import { db, form26asUploads, tdsCredits } from '@/db';

/** Tolerance in paisa under which two TDS amounts are considered a
 *  match. ₹100 = 10_000 paisa. */
export const RECON_TOLERANCE_PAISA = 10_000;

/** Relative tolerance: deltas above ₹100 absolute but ≤10% of the
 *  26AS-side amount are flagged 'partial' (worth a human glance, not
 *  necessarily wrong). Above 10% becomes 'mismatch'. */
export const RECON_PARTIAL_PCT = 0.10;

/** Sentinel TAN used when a books row has no TAN recorded. */
export const NO_TAN_BUCKET = '(no TAN)';

/** Shape of a single deductor row inside
 *  `form_26as_uploads.parsed_deductors_json`. Mirrors the parser shape
 *  in `src/app/api/tax/form-26as/upload/route.ts`. */
interface DeductorJsonRow {
  deductorName: string;
  tan: string;
  section: string | null;
  totalPaidPaisa: number;
  totalTdsPaisa: number;
  totalDepositedPaisa: number;
  transactionDate: string | null;
}

export interface TanMatchBooksSide {
  totalTdsPaisa: number;
  sections: string[];
  rowCount: number;
  rowIds: number[];
  sources: string[];
  /** True when every books row in this TAN bucket is already linked
   *  to a 26AS upload via `reconciled_via_upload_id`. */
  allReconciled: boolean;
  /** The upload id every reconciled row points to, or null when the
   *  rows point at different uploads or none. */
  reconciledViaUploadId: number | null;
}

export interface TanMatch26asSide {
  totalTdsPaisa: number;
  totalPaidPaisa: number;
  section: string | null;
  transactionDate: string | null;
  uploadId: number;
  deductorName: string;
}

export type TanMatchStatus =
  | 'matched'
  | 'partial'
  | 'mismatch'
  | 'unmatched-in-26as'
  | 'unmatched-in-books';

export interface TanMatch {
  tan: string;
  books: TanMatchBooksSide | null;
  form26as: TanMatch26asSide | null;
  /** books - 26AS, paisa. Negative => 26AS has more. */
  deltaPaisa: number;
  status: TanMatchStatus;
  explanation: string | null;
}

export interface ReconResult {
  fy: string;
  summary: {
    reconciledCount: number;
    partialCount: number;
    mismatchedCount: number;
    unmatchedInBooksCount: number;
    unmatchedIn26asCount: number;
    totalBooksPaisa: number;
    total26asPaisa: number;
    totalDeltaPaisa: number;
  };
  tans: TanMatch[];
}

/** Normalise `194J` and `194JB` to a common family for status decisions
 *  (parsers commonly disagree on the trailing letter). */
export function sectionFamily(section: string | null | undefined): string {
  if (!section) return '';
  const upper = section.trim().toUpperCase();
  if (upper === '194J' || upper === '194JB') return '194J*';
  return upper;
}

/** Try parsing one `parsed_deductors_json` blob; swallow shape errors. */
function parseDeductors(json: string | null): DeductorJsonRow[] {
  if (!json) return [];
  try {
    const rows = JSON.parse(json) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (r): r is DeductorJsonRow =>
        !!r &&
        typeof (r as DeductorJsonRow).tan === 'string' &&
        typeof (r as DeductorJsonRow).deductorName === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Decide a status for a TAN with both sides present. Tolerance ladder:
 *   |delta| ≤ ₹100                       → matched
 *   |delta| ≤ 10% of 26AS TDS            → partial
 *   anything else                         → mismatch
 * When the only difference between sides is `194J` vs `194JB` we treat
 * the comparison as matched even if the parser pulled different codes.
 */
function classifyBoth(
  booksTds: number,
  form26asTds: number,
  booksSections: string[],
  form26asSection: string | null,
): { status: TanMatchStatus; deltaPaisa: number; sectionNormalisesAway: boolean } {
  const deltaPaisa = booksTds - form26asTds;
  const abs = Math.abs(deltaPaisa);

  const booksFamilies = new Set(booksSections.map(sectionFamily).filter(Boolean));
  const f26Family = sectionFamily(form26asSection);
  const sectionNormalisesAway =
    booksFamilies.size === 1 &&
    f26Family !== '' &&
    booksFamilies.has(f26Family);

  if (abs <= RECON_TOLERANCE_PAISA) {
    return { status: 'matched', deltaPaisa, sectionNormalisesAway };
  }

  // 10% relative tolerance — use the larger side as the denominator so
  // tiny 26AS values don't flip everything to mismatch on absolute slip.
  const denom = Math.max(Math.abs(form26asTds), Math.abs(booksTds), 1);
  const pct = abs / denom;
  if (pct <= RECON_PARTIAL_PCT) {
    return { status: 'partial', deltaPaisa, sectionNormalisesAway };
  }
  return { status: 'mismatch', deltaPaisa, sectionNormalisesAway };
}

/**
 * Generate a one-line "likely explanation" hint for a TAN. Returns null
 * when no heuristic fires — the UI suppresses the hint block entirely
 * in that case.
 *
 * Heuristics, in order of precedence:
 *   1. section-family mismatch only (194J vs 194JB) → "same section,
 *      treat as matched"
 *   2. books has only 194J/194JB but 26AS shows 192 → "26AS likely
 *      includes salary TDS"
 *   3. 26AS exactly = 4× books TDS (or any whole-quarter multiple) →
 *      "books may be missing quarters"
 *   4. books larger AND every row is GST_INVOICE source → "books may
 *      include invoices customer hasn't yet remitted"
 *   5. nothing matched → null
 */
function buildExplanation(
  books: TanMatchBooksSide,
  form26as: TanMatch26asSide,
  status: TanMatchStatus,
  sectionNormalisesAway: boolean,
): string | null {
  if (status === 'matched') {
    if (sectionNormalisesAway && books.sections[0] !== form26as.section) {
      return `Books used ${books.sections[0]}, 26AS used ${form26as.section} — same section family (194J/194JB), safe to treat as matched.`;
    }
    return null;
  }

  const booksTds = books.totalTdsPaisa;
  const f26Tds = form26as.totalTdsPaisa;
  const delta = booksTds - f26Tds;
  const f26Sec = sectionFamily(form26as.section);
  const booksFamilies = new Set(books.sections.map(sectionFamily).filter(Boolean));

  // (2) 26AS shows salary TDS that books has no equivalent for.
  if (delta < 0 && f26Sec.startsWith('192') && !booksFamilies.has('192') && booksFamilies.size > 0) {
    return '26AS includes salary TDS (sec 192) from this TAN that books does not — upload Form 16 or add a salary entry.';
  }

  // (3) Books TDS is exactly ¼, ½, or ¾ of 26AS TDS → missing quarters.
  if (delta < 0 && f26Tds > 0) {
    const ratio = booksTds / f26Tds;
    const candidates: Array<{ q: number; ratio: number }> = [
      { q: 1, ratio: 0.25 },
      { q: 2, ratio: 0.5 },
      { q: 3, ratio: 0.75 },
    ];
    for (const c of candidates) {
      // Tight ±1% bound — quarterly TDS varies slightly so don't be too strict.
      if (Math.abs(ratio - c.ratio) <= 0.01) {
        const missing = 4 - c.q;
        return `Books appears to cover ${c.q} quarter${c.q === 1 ? '' : 's'} — 26AS shows the full year. ${missing} more quarter${missing === 1 ? '' : 's'} likely missing in books.`;
      }
    }
  }

  // (4) Books larger AND every contributing row is auto-derived from
  // GST invoices — likely the customer hasn't remitted yet.
  if (delta > 0 && books.sources.every((s) => s === 'GST_INVOICE')) {
    return 'Books is larger and every row is auto-derived from a GST invoice — the customer may not have remitted TDS for some invoices yet.';
  }

  // (1) Section-family mismatch is the only thing (status was set to
  // mismatch/partial but normalisation tells us the codes alias) — give
  // the user a hint they can safely accept.
  if (sectionNormalisesAway) {
    return `Books used ${books.sections.join(', ')} and 26AS used ${form26as.section} — both are the same TDS section family.`;
  }

  // Section family mismatch (genuinely different sections).
  if (
    f26Sec &&
    booksFamilies.size > 0 &&
    !booksFamilies.has(f26Sec) &&
    !(booksFamilies.has('194J*') && f26Sec === '194J*')
  ) {
    return `Section mismatch: books uses ${books.sections.join(', ')}, 26AS shows ${form26as.section}. Confirm which section applies.`;
  }

  return null;
}

/** Sorted bucket priority for UI rendering: surface anything needing
 *  attention first, leave clean matches at the bottom. */
const STATUS_PRIORITY: Record<TanMatchStatus, number> = {
  mismatch: 0,
  partial: 1,
  'unmatched-in-26as': 2,
  'unmatched-in-books': 3,
  matched: 4,
};

/**
 * Compute per-TAN reconciliation for the given (user, FY).
 *
 * Returns the full result set; no pagination — even chatty filers
 * rarely have more than a few dozen distinct deductors per FY.
 */
export async function computeReconciliation(
  userId: string,
  fy: string,
): Promise<ReconResult> {
  const [creditRows, uploadRows] = await Promise.all([
    db
      .select()
      .from(tdsCredits)
      .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy))),
    db
      .select()
      .from(form26asUploads)
      .where(and(eq(form26asUploads.userId, userId), eq(form26asUploads.fy, fy))),
  ]);

  // ── Books side: group by TAN ──
  const booksByTan = new Map<string, TanMatchBooksSide>();
  for (const r of creditRows) {
    const tan = (r.deductorTan || '').trim() || NO_TAN_BUCKET;
    const bucket = booksByTan.get(tan) ?? {
      totalTdsPaisa: 0,
      sections: [],
      rowCount: 0,
      rowIds: [],
      sources: [],
      allReconciled: true,
      reconciledViaUploadId: null,
    };
    bucket.totalTdsPaisa += r.tdsPaisa ?? 0;
    bucket.rowCount += 1;
    bucket.rowIds.push(r.id);
    if (r.section && !bucket.sections.includes(r.section)) {
      bucket.sections.push(r.section);
    }
    const src = r.autoDerived ? r.sourceKind ?? 'AUTO' : 'MANUAL';
    if (!bucket.sources.includes(src)) bucket.sources.push(src);
    if (!r.isReconciled) {
      bucket.allReconciled = false;
    } else if (bucket.reconciledViaUploadId == null) {
      bucket.reconciledViaUploadId = r.reconciledViaUploadId ?? null;
    } else if (bucket.reconciledViaUploadId !== (r.reconciledViaUploadId ?? null)) {
      // Rows in this TAN bucket are reconciled against different uploads
      // — disambiguate by clearing the field. UI then can't claim a
      // single upload owns the bucket.
      bucket.reconciledViaUploadId = null;
    }
    booksByTan.set(tan, bucket);
  }

  // ── 26AS side: union all uploads' parsed_deductors_json by TAN ──
  // Sort uploads newest-first so "first wins on metadata" picks the
  // most recent parse (relevant for deductorName / transactionDate /
  // section when a TAN appears in multiple quarterly uploads).
  const sortedUploads = [...uploadRows].sort((a, b) => {
    const ta = a.uploadedAt ? a.uploadedAt.getTime() : 0;
    const tb = b.uploadedAt ? b.uploadedAt.getTime() : 0;
    return tb - ta;
  });

  const f26ByTan = new Map<string, TanMatch26asSide>();
  for (const upload of sortedUploads) {
    const rows = parseDeductors(upload.parsedDeductorsJson);
    for (const r of rows) {
      const tan = (r.tan || '').trim();
      if (!tan) continue;
      const existing = f26ByTan.get(tan);
      if (existing) {
        // Same TAN across multiple quarterly uploads — sum the money.
        existing.totalTdsPaisa += r.totalTdsPaisa ?? 0;
        existing.totalPaidPaisa += r.totalPaidPaisa ?? 0;
      } else {
        f26ByTan.set(tan, {
          totalTdsPaisa: r.totalTdsPaisa ?? 0,
          totalPaidPaisa: r.totalPaidPaisa ?? 0,
          section: r.section,
          transactionDate: r.transactionDate,
          uploadId: upload.id,
          deductorName: r.deductorName,
        });
      }
    }
  }

  // ── Outer join ──
  const tans = new Set<string>([...booksByTan.keys(), ...f26ByTan.keys()]);
  const matches: TanMatch[] = [];
  let totalBooksPaisa = 0;
  let total26asPaisa = 0;

  for (const tan of tans) {
    const books = booksByTan.get(tan) ?? null;
    const form26as = f26ByTan.get(tan) ?? null;

    if (books) totalBooksPaisa += books.totalTdsPaisa;
    if (form26as) total26asPaisa += form26as.totalTdsPaisa;

    if (books && form26as) {
      const { status, deltaPaisa, sectionNormalisesAway } = classifyBoth(
        books.totalTdsPaisa,
        form26as.totalTdsPaisa,
        books.sections,
        form26as.section,
      );
      // Apply persisted reconciliation: if every books row in this TAN
      // bucket has been accepted against this exact upload AND the math
      // is within tolerance, lock the status to 'matched' regardless of
      // the section-family check.
      let finalStatus = status;
      if (
        books.allReconciled &&
        books.reconciledViaUploadId === form26as.uploadId &&
        Math.abs(deltaPaisa) <= RECON_TOLERANCE_PAISA
      ) {
        finalStatus = 'matched';
      }
      matches.push({
        tan,
        books,
        form26as,
        deltaPaisa,
        status: finalStatus,
        explanation: buildExplanation(books, form26as, finalStatus, sectionNormalisesAway),
      });
    } else if (books) {
      matches.push({
        tan,
        books,
        form26as: null,
        deltaPaisa: books.totalTdsPaisa,
        status: 'unmatched-in-26as',
        explanation: tan === NO_TAN_BUCKET
          ? 'These books rows have no TAN — add the deductor TAN so they can match against 26AS.'
          : 'This TAN appears in your books but not in any uploaded 26AS — could be a filing delay or a 26AS quarter you have not yet uploaded.',
      });
    } else if (form26as) {
      matches.push({
        tan,
        books: null,
        form26as,
        deltaPaisa: -form26as.totalTdsPaisa,
        status: 'unmatched-in-books',
        explanation: 'This TAN is on your 26AS but has no books entry — create a TDS credit row for it.',
      });
    }
  }

  // Sort: needs-attention first, matched at the bottom.
  matches.sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status];
    const pb = STATUS_PRIORITY[b.status];
    if (pa !== pb) return pa - pb;
    // Tie-break: larger 26AS TDS surfaces first (bigger money first).
    const ma = Math.max(a.form26as?.totalTdsPaisa ?? 0, a.books?.totalTdsPaisa ?? 0);
    const mb = Math.max(b.form26as?.totalTdsPaisa ?? 0, b.books?.totalTdsPaisa ?? 0);
    return mb - ma;
  });

  const summary = {
    reconciledCount: matches.filter((m) => m.status === 'matched').length,
    partialCount: matches.filter((m) => m.status === 'partial').length,
    mismatchedCount: matches.filter((m) => m.status === 'mismatch').length,
    unmatchedInBooksCount: matches.filter((m) => m.status === 'unmatched-in-books').length,
    unmatchedIn26asCount: matches.filter((m) => m.status === 'unmatched-in-26as').length,
    totalBooksPaisa,
    total26asPaisa,
    totalDeltaPaisa: totalBooksPaisa - total26asPaisa,
  };

  return { fy, summary, tans: matches };
}
