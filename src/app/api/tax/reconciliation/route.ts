/**
 * Unified tax reconciliation endpoint — Sprint C.1 (saas back-port).
 *
 * Returns the canonical "books vs Form 16 vs 26AS" comparison across
 * the dimensions a single-user filing needs:
 *   - salary_income           (books) vs Form 16 Part B taxable salary
 *   - salary_tds              (books) vs Form 16 Part A total TDS    vs 26AS
 *   - business_tds_194J       (books, sourceKind=GST_INVOICE)        vs 26AS
 *   - bank_interest_tds_194A  (books)                                vs 26AS
 *   - dividend_tds_194        (books)                                vs 26AS
 *
 * Tolerance: rows match if |delta| ≤ ₹100 paisa (paisa drift). Larger
 * gaps flip to 'mismatch'. 'missing_actual' when we don't have a 26AS
 * or Form 16 number for the dimension and books is non-zero.
 *
 * Saas-specific:
 *   - All queries scoped by session.user.id.
 *   - 26AS attribution prefers per-section data from
 *     form_26as_uploads.parsed_deductors_json when present (added in
 *     Sprint 5.13). When NULL we fall back to the headline-attribution
 *     heuristics from v1 (attribute to business_tds_194J only when no
 *     salary source exists).
 *
 * GET /api/tax/reconciliation?fy=YYYY-YY
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  tdsCredits,
  form16Uploads,
  form26asUploads,
} from '@/db';
import { auth } from '@/auth';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

// ─── shape ──────────────────────────────────────────────────────────────

export type ReconStatus = 'matched' | 'mismatch' | 'missing_actual';

export interface ReconDimension {
  dimension: string;
  label: string;
  books: { valuePaisa: number; source: string };
  form16: { valuePaisa: number | null; source: string; uploadId: number | null };
  form26as: { valuePaisa: number | null; source: string; uploadId: number | null };
  /** books - actual, paisa. Negative => books less than actual. */
  delta: { form16: number | null; form26as: number | null };
  status: ReconStatus;
}

export interface ReconResponse {
  fy: string;
  reconciliation: ReconDimension[];
  overall: {
    allMatched: boolean;
    matchedCount: number;
    mismatchCount: number;
    missingCount: number;
  };
}

const TOLERANCE_PAISA = 100 * 100; // ₹100

function classify(
  books: number,
  form16: number | null,
  form26as: number | null,
  options: { requireForm16?: boolean; requireForm26as?: boolean } = {},
): ReconStatus {
  const need16 = options.requireForm16 === true;
  const need26 = options.requireForm26as === true;

  if (need16 && form16 == null) return 'missing_actual';
  if (need26 && form26as == null) return 'missing_actual';

  if (form16 == null && form26as == null) return 'missing_actual';

  if (form16 != null && Math.abs(books - form16) > TOLERANCE_PAISA) return 'mismatch';
  if (form26as != null && Math.abs(books - form26as) > TOLERANCE_PAISA) return 'mismatch';
  return 'matched';
}

// ─── 26AS per-section attribution from parsed_deductors_json ────────────

interface DeductorRow {
  deductorName: string;
  tan: string;
  section: string | null;
  totalPaidPaisa: number;
  totalTdsPaisa: number;
  totalDepositedPaisa: number;
  transactionDate: string | null;
}

interface SectionBreakdown {
  /** Sum of TDS where section starts with '192' (salary). */
  salaryTdsPaisa: number;
  /** Sum of TDS where section is exactly '194J' or '194JB'. */
  business194JPaisa: number;
  /** Sum of TDS where section is '194A'. */
  interest194APaisa: number;
  /** Sum of TDS where section is '194' or '194K' (dividend). */
  dividend194Paisa: number;
  /** Whether per-section data was actually present in JSON. */
  hasPerSectionData: boolean;
}

function emptySectionBreakdown(): SectionBreakdown {
  return {
    salaryTdsPaisa: 0,
    business194JPaisa: 0,
    interest194APaisa: 0,
    dividend194Paisa: 0,
    hasPerSectionData: false,
  };
}

function aggregateSectionsFromDeductors(
  jsonStrings: Array<string | null>,
): SectionBreakdown {
  const out = emptySectionBreakdown();
  for (const s of jsonStrings) {
    if (!s) continue;
    let rows: DeductorRow[];
    try {
      rows = JSON.parse(s) as DeductorRow[];
    } catch {
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) continue;
    out.hasPerSectionData = true;
    for (const r of rows) {
      const sec = (r.section || '').toUpperCase();
      const tds = Number(r.totalTdsPaisa) || 0;
      if (sec.startsWith('192')) {
        out.salaryTdsPaisa += tds;
      } else if (sec === '194J' || sec === '194JB') {
        out.business194JPaisa += tds;
      } else if (sec === '194A') {
        out.interest194APaisa += tds;
      } else if (sec === '194' || sec === '194K') {
        out.dividend194Paisa += tds;
      }
    }
  }
  return out;
}

// ─── handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;
  try {
    const fy = new URL(request.url).searchParams.get('fy') || getCurrentFinancialYear();

    // ── 1. Load everything we need for this FY (user-scoped) ──
    const [salaryRows, tdsRows, form16Rows, form26asRows] = await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
      db
        .select()
        .from(tdsCredits)
        .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy))),
      db
        .select()
        .from(form16Uploads)
        .where(and(eq(form16Uploads.userId, userId), eq(form16Uploads.fy, fy))),
      db
        .select()
        .from(form26asUploads)
        .where(and(eq(form26asUploads.userId, userId), eq(form26asUploads.fy, fy))),
    ]);

    // ── 2. Aggregate books ──
    const booksSalary = salaryRows.reduce(
      (s, r) => s + (r.taxableSalaryPaisa ?? 0),
      0,
    );
    const booksSalaryTds = salaryRows.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

    const sectionOf = (r: { section: string | null }) =>
      (r.section || '').toUpperCase();
    const books194J = tdsRows
      .filter((r) => sectionOf(r) === '194J' || sectionOf(r) === '194JB')
      .reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);
    const books194A = tdsRows
      .filter((r) => sectionOf(r) === '194A')
      .reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);
    const books194 = tdsRows
      .filter((r) => sectionOf(r) === '194' || sectionOf(r) === '194K')
      .reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

    // ── 3. Aggregate Form 16 ──
    const latestForm16 = form16Rows[0] || null;
    const form16TaxableSalaryPaisa = form16Rows.reduce(
      (s, r) => s + (r.taxableSalaryPaisa ?? 0),
      0,
    );
    const form16TotalTdsPaisa = form16Rows.reduce(
      (s, r) => s + (r.totalTdsPaisa ?? 0),
      0,
    );
    const form16Source =
      form16Rows.length === 0
        ? 'form_16_uploads (none uploaded for this FY)'
        : `form_16_uploads (${form16Rows.length} record${form16Rows.length === 1 ? '' : 's'})`;

    // ── 4. Aggregate Form 26AS — prefer per-section JSON, fall back to headline ──
    const latest26as = form26asRows[0] || null;
    const form26asTotalTdsPaisa = form26asRows.reduce(
      (s, r) => s + (r.parsedTotalTdsPaisa ?? 0),
      0,
    );
    const form26asSource =
      form26asRows.length === 0
        ? 'form_26as_uploads (none uploaded for this FY)'
        : `form_26as_uploads (${form26asRows.length} record${form26asRows.length === 1 ? '' : 's'})`;

    const sectionSplit = aggregateSectionsFromDeductors(
      form26asRows.map((r) => r.parsedDeductorsJson),
    );

    // Per-section attribution:
    //   - When parsed_deductors_json is present → use the JSON-derived split.
    //   - When NOT present → fall back to v1 headline heuristic
    //     (attribute the headline total to business_tds_194J only when
    //     no salary source exists; otherwise leave per-section null).
    const fallbackForm26asFor194J =
      form26asRows.length > 0 && salaryRows.length === 0 && form16Rows.length === 0
        ? form26asTotalTdsPaisa
        : null;

    const form26asSalaryTds = sectionSplit.hasPerSectionData
      ? sectionSplit.salaryTdsPaisa
      : null;
    const form26as194J = sectionSplit.hasPerSectionData
      ? sectionSplit.business194JPaisa
      : fallbackForm26asFor194J;
    const form26as194A = sectionSplit.hasPerSectionData
      ? sectionSplit.interest194APaisa
      : null;
    const form26as194 = sectionSplit.hasPerSectionData
      ? sectionSplit.dividend194Paisa
      : null;

    const form26asSourceFor = (sec: '192' | '194J' | '194A' | '194'): string => {
      if (form26asRows.length === 0) return '— (no 26AS uploaded)';
      if (sectionSplit.hasPerSectionData) {
        return `${form26asSource} — per-deductor JSON, section ${sec === '192' ? '192*' : sec}`;
      }
      // No per-section data — explain the fallback for each dimension.
      if (sec === '194J') {
        return salaryRows.length === 0 && form16Rows.length === 0
          ? `${form26asSource} — headline attributed here (no salary source exists)`
          : '— (no per-deductor split; headline includes salary — use /tax/form-26as for manual split)';
      }
      return '— (no per-deductor split — re-upload 26AS or use /tax/form-26as)';
    };

    // ── 5. Build dimensions ──
    const dimensions: ReconDimension[] = [];

    // SALARY INCOME — books vs Form 16 taxable salary
    dimensions.push({
      dimension: 'salary_income',
      label: 'Salary income (taxable)',
      books: {
        valuePaisa: booksSalary,
        source: `salary_income (${salaryRows.length} record${salaryRows.length === 1 ? '' : 's'})`,
      },
      form16: {
        valuePaisa: form16Rows.length > 0 ? form16TaxableSalaryPaisa : null,
        source: form16Source,
        uploadId: latestForm16?.id ?? null,
      },
      form26as: {
        valuePaisa: null,
        source: '— (26AS does not carry salary income figure)',
        uploadId: null,
      },
      delta: {
        form16: form16Rows.length > 0 ? booksSalary - form16TaxableSalaryPaisa : null,
        form26as: null,
      },
      status: classify(
        booksSalary,
        form16Rows.length > 0 ? form16TaxableSalaryPaisa : null,
        null,
        { requireForm16: salaryRows.length > 0 },
      ),
    });

    // SALARY TDS — books vs Form 16 total TDS vs 26AS (section 192*)
    dimensions.push({
      dimension: 'salary_tds',
      label: 'Salary TDS',
      books: {
        valuePaisa: booksSalaryTds,
        source: `salary_income.tds (${salaryRows.length} record${salaryRows.length === 1 ? '' : 's'})`,
      },
      form16: {
        valuePaisa: form16Rows.length > 0 ? form16TotalTdsPaisa : null,
        source: form16Source,
        uploadId: latestForm16?.id ?? null,
      },
      form26as: {
        valuePaisa: form26asSalaryTds,
        source: form26asSourceFor('192'),
        uploadId: form26asSalaryTds != null ? (latest26as?.id ?? null) : null,
      },
      delta: {
        form16: form16Rows.length > 0 ? booksSalaryTds - form16TotalTdsPaisa : null,
        form26as: form26asSalaryTds != null ? booksSalaryTds - form26asSalaryTds : null,
      },
      status: classify(
        booksSalaryTds,
        form16Rows.length > 0 ? form16TotalTdsPaisa : null,
        form26asSalaryTds,
        { requireForm16: salaryRows.length > 0 },
      ),
    });

    // BUSINESS TDS — 194J/JB (books) vs 26AS (per-section if available)
    dimensions.push({
      dimension: 'business_tds_194J',
      label: 'Business TDS (Sec 194J / 194JB)',
      books: {
        valuePaisa: books194J,
        source: `tds_credits where section IN ('194J','194JB') (${tdsRows.filter((r) => sectionOf(r) === '194J' || sectionOf(r) === '194JB').length} row${tdsRows.filter((r) => sectionOf(r) === '194J' || sectionOf(r) === '194JB').length === 1 ? '' : 's'})`,
      },
      form16: {
        valuePaisa: null,
        source: '— (not a Form 16 dimension)',
        uploadId: null,
      },
      form26as: {
        valuePaisa: form26as194J,
        source: form26asSourceFor('194J'),
        uploadId: form26as194J != null ? (latest26as?.id ?? null) : null,
      },
      delta: {
        form16: null,
        form26as: form26as194J != null ? books194J - form26as194J : null,
      },
      status: classify(books194J, null, form26as194J),
    });

    // BANK INTEREST TDS — 194A (books vs 26AS per-section if available)
    dimensions.push({
      dimension: 'bank_interest_tds_194A',
      label: 'Bank interest TDS (Sec 194A)',
      books: {
        valuePaisa: books194A,
        source: `tds_credits where section='194A' (${tdsRows.filter((r) => sectionOf(r) === '194A').length} row${tdsRows.filter((r) => sectionOf(r) === '194A').length === 1 ? '' : 's'})`,
      },
      form16: {
        valuePaisa: null,
        source: '— (not a Form 16 dimension)',
        uploadId: null,
      },
      form26as: {
        valuePaisa: form26as194A,
        source: form26asSourceFor('194A'),
        uploadId: form26as194A != null ? (latest26as?.id ?? null) : null,
      },
      delta: {
        form16: null,
        form26as: form26as194A != null ? books194A - form26as194A : null,
      },
      // Special case: when books==0 AND no actual present, call it
      // 'matched' (nothing-to-nothing is fine).
      status:
        books194A === 0 && form26as194A == null
          ? 'matched'
          : classify(books194A, null, form26as194A),
    });

    // DIVIDEND TDS — 194/194K (books vs 26AS per-section if available)
    dimensions.push({
      dimension: 'dividend_tds_194',
      label: 'Dividend TDS (Sec 194 / 194K)',
      books: {
        valuePaisa: books194,
        source: `tds_credits where section IN ('194','194K') (${tdsRows.filter((r) => sectionOf(r) === '194' || sectionOf(r) === '194K').length} row${tdsRows.filter((r) => sectionOf(r) === '194' || sectionOf(r) === '194K').length === 1 ? '' : 's'})`,
      },
      form16: {
        valuePaisa: null,
        source: '— (not a Form 16 dimension)',
        uploadId: null,
      },
      form26as: {
        valuePaisa: form26as194,
        source: form26asSourceFor('194'),
        uploadId: form26as194 != null ? (latest26as?.id ?? null) : null,
      },
      delta: {
        form16: null,
        form26as: form26as194 != null ? books194 - form26as194 : null,
      },
      status:
        books194 === 0 && form26as194 == null
          ? 'matched'
          : classify(books194, null, form26as194),
    });

    // ── 6. Overall status roll-up ──
    const matchedCount = dimensions.filter((d) => d.status === 'matched').length;
    const mismatchCount = dimensions.filter((d) => d.status === 'mismatch').length;
    const missingCount = dimensions.filter((d) => d.status === 'missing_actual').length;
    const allMatched = mismatchCount === 0 && missingCount === 0;

    const response: ReconResponse = {
      fy,
      reconciliation: dimensions,
      overall: { allMatched, matchedCount, mismatchCount, missingCount },
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[tax/reconciliation GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
