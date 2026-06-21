/**
 * Income-Tax Gap Check — "what the IT department has on you" vs "what's
 * booked in the app", at the category-total level (not line items).
 *
 * Sources:
 *   - TIS income-category totals  → app booked income (salary, interest,
 *     dividend, business receipts) + capital-gains sale consideration.
 *   - AIS Part-B1 TDS per section → app booked TDS (salary 192, prof 194J).
 *
 * A category is flagged when the IT-dept figure materially exceeds what the
 * app has recorded (something to add before filing). Tolerance is ±₹100
 * (paisa-exact), matching the existing reconciliation convention.
 */

import { and, eq } from 'drizzle-orm';
import {
  db,
  aisImports,
  salaryIncome,
  otherSourcesIncome,
  capitalGains,
  tdsCredits,
  form16aUploads,
  form26asUploads,
} from '@/db';

const TOLERANCE_PAISA = 10_000; // ₹100
const MARGINAL_RATE = 0.3; // indicative top-slab rate for income-gap tax estimate

export type ItGapStatus =
  | 'missing' // IT dept has it, books have ~nothing
  | 'under_recorded' // books have less than IT dept
  | 'matched' // within tolerance
  | 'app_extra' // books have MORE than IT dept (often legitimate — timing/exempt)
  | 'no_it_data'; // the relevant document wasn't uploaded

export type ItGapCategory = 'income' | 'tax_paid' | 'consideration';

export interface ItGapRow {
  key: string;
  label: string;
  source: 'TIS' | 'AIS';
  category: ItGapCategory;
  itDeptPaisa: number | null; // null = source doc not uploaded
  bookedPaisa: number;
  gapPaisa: number; // itDept − booked (positive ⇒ app under-records)
  estTaxImpactPaisa: number | null;
  status: ItGapStatus;
  note?: string;
}

export interface ItGapResult {
  fy: string;
  hasTis: boolean;
  hasAis: boolean;
  uploadedAt: { tis: string | null; ais: string | null };
  rows: ItGapRow[];
  // 26AS (TRACES) total TDS for the FY — the authoritative tax-credit figure
  // to rely on at filing. null when no 26AS has been uploaded.
  form26asTotalTdsPaisa: number | null;
  summary: { flagged: number; totalGapPaisa: number; estTaxAtRiskPaisa: number };
}

function statusFor(itDept: number | null, booked: number): ItGapStatus {
  if (itDept == null) return 'no_it_data';
  const gap = itDept - booked;
  if (Math.abs(gap) <= TOLERANCE_PAISA) return 'matched';
  if (booked <= TOLERANCE_PAISA && itDept > TOLERANCE_PAISA) return 'missing';
  return gap > 0 ? 'under_recorded' : 'app_extra';
}

export async function computeItGapCheck(userId: string, fy: string): Promise<ItGapResult> {
  const [aisRows, salaryRows, otherRows, cgRows, tdsRows, f16aRows, f26asRows] = await Promise.all([
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
    db
      .select()
      .from(form16aUploads)
      .where(and(eq(form16aUploads.userId, userId), eq(form16aUploads.fy, fy))),
    db
      .select()
      .from(form26asUploads)
      .where(and(eq(form26asUploads.userId, userId), eq(form26asUploads.fy, fy))),
  ]);

  const form26asTotalTdsPaisa = f26asRows.length
    ? f26asRows.reduce((s, r) => s + (r.parsedTotalTdsPaisa || 0), 0)
    : null;

  const tis = aisRows.find((r) => r.kind === 'TIS');
  const ais = aisRows.find((r) => r.kind === 'AIS');

  // TIS category total in paisa: null if TIS not uploaded; 0 if uploaded but
  // the category is absent (⇒ IT dept has nothing → no gap).
  const tisCat = (key: string): number | null => {
    if (!tis) return null;
    return tis.categoriesJson?.find((c) => c.key === key)?.amountPaisa ?? 0;
  };
  const aisTds = (code: string): number | null => {
    if (!ais) return null;
    return ais.tdsJson?.find((t) => t.code === code)?.tdsPaisa ?? 0;
  };

  // ── Booked totals ─────────────────────────────────────────────────
  const bookedSalary = salaryRows.reduce((s, r) => s + (r.grossSalaryPaisa || 0), 0);
  const bookedSalaryTds = salaryRows.reduce((s, r) => s + (r.tdsPaisa || 0), 0);
  const INTEREST = new Set(['BANK_INTEREST', 'FD_INTEREST', 'PF_INTEREST']);
  const bookedInterest = otherRows
    .filter((r) => INTEREST.has(r.source))
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  const bookedDividend = otherRows
    .filter((r) => r.source === 'DIVIDEND')
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  const bookedBusiness = otherRows
    .filter((r) => r.source === 'BUSINESS' || r.source === 'FREELANCE')
    .reduce((s, r) => s + (r.amountPaisa || 0), 0);
  const bookedSaleConsideration = cgRows.reduce((s, r) => s + (r.salePrice || 0), 0);
  const is194J = (sec?: string | null) => !!sec && /194J/i.test(sec);
  const booked194JTds =
    tdsRows.filter((r) => is194J(r.section)).reduce((s, r) => s + (r.tdsPaisa || 0), 0) +
    f16aRows.filter((r) => is194J(r.section)).reduce((s, r) => s + (r.tdsPaisa || 0), 0);

  // TIS reports interest split into savings + deposit; compare the combined
  // figure against the app's combined interest (more robust than per-bucket).
  const tisInterest =
    tis == null ? null : (tisCat('interest_savings') ?? 0) + (tisCat('interest_deposit') ?? 0);

  const rows: ItGapRow[] = [];

  const pushIncome = (key: string, label: string, itDept: number | null, booked: number, note?: string) => {
    const gap = itDept == null ? 0 : itDept - booked;
    rows.push({
      key,
      label,
      source: 'TIS',
      category: 'income',
      itDeptPaisa: itDept,
      bookedPaisa: booked,
      gapPaisa: gap,
      estTaxImpactPaisa: itDept == null ? null : Math.round(Math.max(0, gap) * MARGINAL_RATE),
      status: statusFor(itDept, booked),
      note,
    });
  };

  pushIncome('salary', 'Salary', tisCat('salary'), bookedSalary);
  pushIncome('interest', 'Interest income (savings + deposit)', tisInterest, bookedInterest);
  pushIncome('dividend', 'Dividend', tisCat('dividend'), bookedDividend);
  pushIncome(
    'business_receipts',
    'Business / professional receipts',
    tisCat('business_receipts'),
    bookedBusiness,
    'Books may also capture this via GST invoices.',
  );

  // Sale consideration — gross sale value, not gain. Confirms every sale /
  // redemption is captured (the gain is computed from these). No tax estimate.
  {
    const itDept = tisCat('sale_securities_mf');
    const gap = itDept == null ? 0 : itDept - bookedSaleConsideration;
    rows.push({
      key: 'sale_securities_mf',
      label: 'Sale of securities & MF (consideration)',
      source: 'TIS',
      category: 'consideration',
      itDeptPaisa: itDept,
      bookedPaisa: bookedSaleConsideration,
      gapPaisa: gap,
      estTaxImpactPaisa: null,
      status: statusFor(itDept, bookedSaleConsideration),
      note: 'Gross sale value — confirms all sales/redemptions are recorded.',
    });
  }

  const pushTax = (key: string, label: string, itDept: number | null, booked: number) => {
    const gap = itDept == null ? 0 : itDept - booked;
    rows.push({
      key,
      label,
      source: 'AIS',
      category: 'tax_paid',
      itDeptPaisa: itDept,
      bookedPaisa: booked,
      gapPaisa: gap,
      // For TDS, the gap IS the tax credit at stake (rupee-for-rupee).
      estTaxImpactPaisa: itDept == null ? null : Math.max(0, gap),
      status: statusFor(itDept, booked),
    });
  };

  pushTax('tds_salary', 'Salary TDS (Sec 192)', aisTds('TDS-192'), bookedSalaryTds);
  pushTax('tds_194j', 'Professional TDS (Sec 194J)', aisTds('TDS-194J'), booked194JTds);

  const flagged = rows.filter(
    (r) => r.status === 'missing' || r.status === 'under_recorded',
  ).length;
  const totalGapPaisa = rows
    .filter((r) => r.category !== 'consideration')
    .reduce((s, r) => s + Math.max(0, r.gapPaisa), 0);
  const estTaxAtRiskPaisa = rows.reduce(
    (s, r) => s + (r.gapPaisa > 0 && r.estTaxImpactPaisa ? r.estTaxImpactPaisa : 0),
    0,
  );

  return {
    fy,
    hasTis: !!tis,
    hasAis: !!ais,
    uploadedAt: {
      tis: tis?.uploadedAt?.toISOString() ?? null,
      ais: ais?.uploadedAt?.toISOString() ?? null,
    },
    rows,
    form26asTotalTdsPaisa,
    summary: { flagged, totalGapPaisa, estTaxAtRiskPaisa },
  };
}
