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
  capitalGains,
  tdsCredits,
  form16Uploads,
  form16aUploads,
  form26asUploads,
} from '@/db';

const TOLERANCE_PAISA = 10_000; // ₹100

export type ItGapStatus =
  | 'matched' // department agrees with the certificate (within tolerance)
  | 'mismatch' // a department source disagrees with the certificate — chase it
  | 'no_cert' // department reports a value but there's no Form 16/16A to verify it
  | 'awaiting_docs' // not enough uploaded to compare this row yet
  | 'review'; // completeness rows: department sees more than our records

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
}

export interface ItGapResult {
  fy: string;
  has: { form16: boolean; form16a: boolean; tis: boolean; ais: boolean; form26as: boolean };
  rows: ItGapRow[];
  summary: { mismatches: number };
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
    // No certificate. If a department source reports a real value, you have
    // income/TDS the dept sees but you can't verify — surface it.
    return dept.some((v) => v > TOLERANCE_PAISA) ? 'no_cert' : 'awaiting_docs';
  }
  if (dept.length === 0) return 'awaiting_docs'; // cert present, no dept doc yet
  const allAgree = dept.every((v) => Math.abs(v - certPaisa) <= TOLERANCE_PAISA);
  return allAgree ? 'matched' : 'mismatch';
}

export async function computeItGapCheck(userId: string, fy: string): Promise<ItGapResult> {
  const [
    aisRows,
    salaryRows,
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
  const f16aTds = (fam: Family): number | null =>
    !hasF16a
      ? null
      : f16aRows.filter((r) => sectionFamily(r.section) === fam).reduce((s, r) => s + (r.tdsPaisa || 0), 0);

  // ── Books (provisional reference only) ───────────────────────────────
  const booksSalary = salaryRows.reduce((s, r) => s + (r.grossSalaryPaisa || 0), 0);
  const booksSalaryTds = salaryRows.reduce((s, r) => s + (r.tdsPaisa || 0), 0);
  const booksTdsFamily = (fam: Family): number =>
    tdsRows.filter((r) => sectionFamily(r.section) === fam).reduce((s, r) => s + (r.tdsPaisa || 0), 0);
  const booksSaleConsideration = cgRows.reduce((s, r) => s + (r.salePrice || 0), 0);

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

  // 2. Salary TDS (Sec 192) — Form 16 TDS vs AIS-192 + 26AS-192.
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
      status = aisSale - booksSaleConsideration > TOLERANCE_PAISA ? 'review' : 'matched';
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

  return {
    fy,
    has: { form16: hasF16, form16a: hasF16a, tis: !!tis, ais: !!ais, form26as: has26as },
    rows,
    summary: { mismatches: rows.filter((r) => r.status === 'mismatch' || r.status === 'no_cert').length },
  };
}
