/**
 * Income-Tax Gap Check — reconcile the authoritative records against each other.
 *
 * The user's mental model (three sources of truth):
 *   1. My books (manual app entries) — TEMPORAL: only my own estimate, in flux.
 *   2. Form 16 / 16A (payer certificates) — the ACTUAL, final from my side.
 *   3. AIS / TIS / 26AS — what the Income-Tax department has.
 *
 * Therefore the reconciliation ANCHORS on Form 16/16A and flags where a
 * department source (AIS/TIS or 26AS) disagrees with the certificate — because
 * those are two authoritative records that must match. Books are shown only as
 * a greyed, provisional reference; they never drive a flag.
 *
 * Scope of the Form-16 anchor: INCOME and TAX PAID (TDS) only. Capital gains,
 * 80C and the like come from our own records — capital gains keeps one
 * informational "did I record every sale?" completeness check against the AIS
 * sale-consideration figure; everything else lives on the ITR/deductions pages.
 *
 * All money is paisa. Match tolerance is ±₹100.
 */

import { and, eq } from 'drizzle-orm';
import {
  db,
  aisImports,
  salaryIncome,
  otherSourcesIncome,
  capitalGains,
  tdsCredits,
  form16Uploads,
  form16aUploads,
  form26asUploads,
} from '@/db';

const TOLERANCE_PAISA = 10_000; // ₹100

export type ItGapStatus =
  | 'matched' // our side agrees with the department (within tolerance)
  | 'mismatch' // Form 16/16A present but a department source disagrees — chase it
  | 'missing' // department (AIS/TIS/26AS) reports a value our side doesn't account for — a gap
  | 'awaiting_docs'; // not enough uploaded to compare this row yet

export type ItGapGroup = 'income' | 'tax_paid' | 'completeness';

export interface ItGapRow {
  key: string;
  label: string;
  group: ItGapGroup;
  certPaisa: number | null; // Form 16 / 16A — the actual anchor
  aisPaisa: number | null; // AIS / TIS (department)
  form26asPaisa: number | null; // 26AS (department)
  booksPaisa: number; // our provisional estimate
  status: ItGapStatus;
  note?: string;
  // Per-source AIS/TIS breakdown (each bank's interest, each company's dividend)
  // for mental reconciliation. Only populated for interest/dividend income rows.
  // `kind` distinguishes savings-bank vs fixed-deposit interest where AIS does.
  aisDetail?: { source: string; amountPaisa: number; kind?: string }[];
  // Residual income the department reports beyond what our records account for,
  // which the user can one-click accept into other-sources income (AIS_ACCEPTED).
  // Present (> 0) only when this row is a "missing" income gap with no certificate.
  acceptableResidualPaisa?: number;
  // Which income family an Accept applies to (drives the accept endpoint).
  acceptFamily?: 'interest' | 'dividend';
}

export interface ItGapResult {
  fy: string;
  has: { form16: boolean; form16a: boolean; tis: boolean; ais: boolean; form26as: boolean };
  rows: ItGapRow[];
  summary: { flagged: number };
}

type Family = 'salary' | 'professional' | 'interest' | 'dividend' | 'other';

/** Classify a TDS section code (e.g. "194JB") into an income family. */
function sectionFamily(sec: string | null | undefined): Family {
  const s = (sec ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.startsWith('192')) return 'salary';
  if (s.startsWith('194J')) return 'professional';
  if (s.startsWith('194A')) return 'interest';
  if (s === '194' || s.startsWith('194K')) return 'dividend';
  return 'other';
}

/** AIS Part-B1 TDS code (e.g. "TDS-194J") → income family. */
function aisCodeFamily(code: string): Family {
  return sectionFamily(code.replace(/^TDS-|^TCS-/i, ''));
}

interface DeductorRow {
  section?: string;
  totalTdsPaisa?: number;
}

/**
 * For an anchored (income/tax) row: the certificate is the anchor; flag if any
 * present department value diverges from it.
 */
function anchoredStatus(
  certPaisa: number | null,
  deptValues: Array<number | null>,
): ItGapStatus {
  const dept = deptValues.filter((v): v is number => v != null);
  if (certPaisa == null) {
    // No certificate, but the department reports a value → it's a gap to add.
    return dept.some((v) => v > TOLERANCE_PAISA) ? 'missing' : 'awaiting_docs';
  }
  if (dept.length === 0) return 'awaiting_docs'; // cert present, no dept doc yet
  const allAgree = dept.every((v) => Math.abs(v - certPaisa) <= TOLERANCE_PAISA);
  return allAgree ? 'matched' : 'mismatch';
}

/**
 * Income row: anchor on the certificate if one exists; otherwise (e.g. small
 * interest/dividend below the TDS threshold, which never gets a Form 16A) fall
 * back to a completeness check of our records against the department figure.
 */
function incomeStatus(
  certPaisa: number | null,
  aisPaisa: number | null,
  booksPaisa: number,
): ItGapStatus {
  if (certPaisa != null) return anchoredStatus(certPaisa, [aisPaisa]);
  if (aisPaisa == null) return 'awaiting_docs';
  // Department has it; if our records don't (or have materially less) → a gap.
  return aisPaisa - booksPaisa > TOLERANCE_PAISA ? 'missing' : 'matched';
}

export async function computeItGapCheck(userId: string, fy: string): Promise<ItGapResult> {
  const [
    aisRows,
    salaryRows,
    otherRows,
    cgRows,
    tdsRows,
    f16Rows,
    f16aRows,
    f26asRows,
  ] = await Promise.all([
    db.select().from(aisImports).where(and(eq(aisImports.userId, userId), eq(aisImports.fy, fy))),
    db
      .select()
      .from(salaryIncome)
      .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
    db
      .select()
      .from(otherSourcesIncome)
      .where(and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy))),
    db
      .select()
      .from(capitalGains)
      .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy))),
    db
      .select()
      .from(tdsCredits)
      .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy))),
    db.select().from(form16Uploads).where(and(eq(form16Uploads.userId, userId), eq(form16Uploads.fy, fy))),
    db.select().from(form16aUploads).where(and(eq(form16aUploads.userId, userId), eq(form16aUploads.fy, fy))),
    db.select().from(form26asUploads).where(and(eq(form26asUploads.userId, userId), eq(form26asUploads.fy, fy))),
  ]);

  const tis = aisRows.find((r) => r.kind === 'TIS');
  const ais = aisRows.find((r) => r.kind === 'AIS');

  // ── Department: AIS/TIS ──────────────────────────────────────────────
  const tisCat = (key: string): number | null =>
    !tis ? null : tis.categoriesJson?.find((c) => c.key === key)?.amountPaisa ?? 0;
  const aisTdsFamily = (fam: Family): number | null => {
    if (!ais) return null;
    return (ais.tdsJson ?? [])
      .filter((t) => aisCodeFamily(t.code) === fam)
      .reduce((s, t) => s + (t.tdsPaisa || 0), 0);
  };

  // ── Department: 26AS per-section TDS ─────────────────────────────────
  const f26asDeductors: DeductorRow[] = f26asRows.flatMap((r) => {
    try {
      const parsed = JSON.parse(r.parsedDeductorsJson ?? '[]');
      return Array.isArray(parsed) ? (parsed as DeductorRow[]) : [];
    } catch {
      return [];
    }
  });
  const has26as = f26asRows.length > 0;
  const f26asTds = (fam: Family): number | null => {
    if (!has26as) return null;
    return f26asDeductors
      .filter((d) => sectionFamily(d.section) === fam)
      .reduce((s, d) => s + (d.totalTdsPaisa || 0), 0);
  };

  // ── Anchor: Form 16 (salary) + Form 16A (non-salary TDS) ─────────────
  const hasF16 = f16Rows.length > 0;
  const f16GrossSalary = hasF16 ? f16Rows.reduce((s, r) => s + (r.grossSalaryPaisa || 0), 0) : null;
  const f16SalaryTds = hasF16 ? f16Rows.reduce((s, r) => s + (r.totalTdsPaisa || 0), 0) : null;
  const hasF16a = f16aRows.length > 0;
  // Form 16A TDS / amount-paid by section family — null when there is NO
  // certificate for that family (so income with no cert reads as "no anchor",
  // not "anchor = ₹0").
  const f16aBy = (fam: Family, field: 'tdsPaisa' | 'amountPaidPaisa'): number | null => {
    const m = f16aRows.filter((r) => sectionFamily(r.section) === fam);
    return m.length ? m.reduce((s, r) => s + (r[field] || 0), 0) : null;
  };
  const f16aTds = (fam: Family) => f16aBy(fam, 'tdsPaisa');
  const f16aAmount = (fam: Family) => f16aBy(fam, 'amountPaidPaisa');

  // ── Books (provisional reference only) ───────────────────────────────
  const booksSalary = salaryRows.reduce((s, r) => s + (r.grossSalaryPaisa || 0), 0);
  const booksSalaryTds = salaryRows.reduce((s, r) => s + (r.tdsPaisa || 0), 0);
  const booksTdsFamily = (fam: Family): number =>
    tdsRows.filter((r) => sectionFamily(r.section) === fam).reduce((s, r) => s + (r.tdsPaisa || 0), 0);
  // Securities + MF only — matches the AIS "Sale of securities and units of
  // mutual fund" line (excludes real estate / gold).
  const SECURITIES_MF = new Set(['STOCKS', 'EQUITY_MF', 'DEBT_MF']);
  const booksSaleConsideration = cgRows
    .filter((r) => SECURITIES_MF.has(r.assetType))
    .reduce((s, r) => s + (r.salePrice || 0), 0);
  const INTEREST_SRC = new Set(['BANK_INTEREST', 'FD_INTEREST', 'PF_INTEREST']);
  const booksInterest = otherRows
    .filter((r) => INTEREST_SRC.has(r.source))
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  const booksDividend = otherRows
    .filter((r) => r.source === 'DIVIDEND')
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  // TIS reports interest split into savings + deposit; compare the combined total.
  const tisInterest =
    tis == null ? null : (tisCat('interest_savings') ?? 0) + (tisCat('interest_deposit') ?? 0);

  // Per-source AIS detail for mental reconciliation (each bank / company).
  // Tag interest lines as savings-bank vs fixed-deposit so the two are
  // distinguishable in the breakdown (AIS reports them as separate categories).
  const tisDetail = (key: string) =>
    tis?.categoriesJson?.find((c) => c.key === key)?.detail ?? [];
  const tagged = (key: string, kind: string) =>
    tisDetail(key).map((d) => ({ ...d, kind }));
  const interestDetail = [
    ...tagged('interest_savings', 'Savings bank'),
    ...tagged('interest_deposit', 'Fixed deposit'),
  ];
  const dividendDetail = tisDetail('dividend');

  // Residual the department reports beyond our records — what an Accept would book.
  const residual = (deptTotal: number | null, books: number): number =>
    deptTotal == null ? 0 : Math.max(0, deptTotal - books);

  const rows: ItGapRow[] = [];

  // 1. Salary income — Form 16 gross vs AIS/TIS salary.
  rows.push({
    key: 'salary_income',
    label: 'Salary income',
    group: 'income',
    certPaisa: f16GrossSalary,
    aisPaisa: tisCat('salary'),
    form26asPaisa: null,
    booksPaisa: booksSalary,
    status: anchoredStatus(f16GrossSalary, [tisCat('salary')]),
    note: 'Anchor: Form 16 gross salary.',
  });

  // 2. Interest income — Form 16A (194A) amount if a certificate exists, else a
  //    completeness check of our records vs AIS/TIS (no cert below threshold).
  rows.push({
    key: 'interest_income',
    label: 'Interest income (savings + deposit)',
    group: 'income',
    certPaisa: f16aAmount('interest'),
    aisPaisa: tisInterest,
    form26asPaisa: null,
    booksPaisa: booksInterest,
    status: incomeStatus(f16aAmount('interest'), tisInterest, booksInterest),
    note:
      f16aAmount('interest') != null
        ? 'Anchor: Form 16A (194A).'
        : 'No certificate (below TDS threshold) — FD interest is auto-derived from your deposits; the residual can be accepted from AIS.',
    aisDetail: interestDetail,
    acceptableResidualPaisa:
      f16aAmount('interest') == null ? residual(tisInterest, booksInterest) : 0,
    acceptFamily: 'interest',
  });

  // 3. Dividend income — same treatment.
  rows.push({
    key: 'dividend_income',
    label: 'Dividend income',
    group: 'income',
    certPaisa: f16aAmount('dividend'),
    aisPaisa: tisCat('dividend'),
    form26asPaisa: null,
    booksPaisa: booksDividend,
    status: incomeStatus(f16aAmount('dividend'), tisCat('dividend'), booksDividend),
    note:
      f16aAmount('dividend') != null
        ? 'Anchor: Form 16A (194).'
        : 'No certificate — the residual the department reports can be accepted from AIS.',
    aisDetail: dividendDetail,
    acceptableResidualPaisa:
      f16aAmount('dividend') == null ? residual(tisCat('dividend'), booksDividend) : 0,
    acceptFamily: 'dividend',
  });

  // 4. Salary TDS (Sec 192) — Form 16 TDS vs AIS-192 + 26AS-192.
  rows.push({
    key: 'salary_tds',
    label: 'Salary TDS (Sec 192)',
    group: 'tax_paid',
    certPaisa: f16SalaryTds,
    aisPaisa: aisTdsFamily('salary'),
    form26asPaisa: f26asTds('salary'),
    booksPaisa: booksSalaryTds,
    status: anchoredStatus(f16SalaryTds, [aisTdsFamily('salary'), f26asTds('salary')]),
    note: 'Anchor: Form 16 Part A TDS.',
  });

  // 3-5. Non-salary TDS — Form 16A vs AIS + 26AS, by section family.
  const tdsRowsDef: Array<{ key: string; label: string; fam: Family }> = [
    { key: 'tds_194j', label: 'Professional TDS (Sec 194J)', fam: 'professional' },
    { key: 'tds_194a', label: 'Interest TDS (Sec 194A)', fam: 'interest' },
    { key: 'tds_194', label: 'Dividend TDS (Sec 194)', fam: 'dividend' },
  ];
  for (const d of tdsRowsDef) {
    rows.push({
      key: d.key,
      label: d.label,
      group: 'tax_paid',
      certPaisa: f16aTds(d.fam),
      aisPaisa: aisTdsFamily(d.fam),
      form26asPaisa: f26asTds(d.fam),
      booksPaisa: booksTdsFamily(d.fam),
      status: anchoredStatus(f16aTds(d.fam), [aisTdsFamily(d.fam), f26asTds(d.fam)]),
      note: 'Anchor: Form 16A certificate.',
    });
  }

  // 6. Capital gains — completeness only (our records vs AIS sale value).
  {
    const aisSale = tisCat('sale_securities_mf');
    let status: ItGapStatus = 'awaiting_docs';
    if (aisSale != null) {
      status = aisSale - booksSaleConsideration > TOLERANCE_PAISA ? 'missing' : 'matched';
    }
    rows.push({
      key: 'capital_gains',
      label: 'Capital gains — sales captured',
      group: 'completeness',
      certPaisa: null,
      aisPaisa: aisSale,
      form26asPaisa: null,
      booksPaisa: booksSaleConsideration,
      status,
      note: 'From our records. AIS sale value is a completeness check — confirm every sale is recorded.',
    });
  }

  // Hide rows where every column is empty (e.g. interest/dividend TDS when no
  // TDS was deducted) so the view stays on real figures.
  const nonEmpty = (r: ItGapRow) =>
    (r.certPaisa ?? 0) > TOLERANCE_PAISA ||
    (r.aisPaisa ?? 0) > TOLERANCE_PAISA ||
    (r.form26asPaisa ?? 0) > TOLERANCE_PAISA ||
    r.booksPaisa > TOLERANCE_PAISA;
  const visible = rows.filter(nonEmpty);

  return {
    fy,
    has: { form16: hasF16, form16a: hasF16a, tis: !!tis, ais: !!ais, form26as: has26as },
    rows: visible,
    summary: {
      flagged: visible.filter((r) => r.status === 'mismatch' || r.status === 'missing').length,
    },
  };
}
