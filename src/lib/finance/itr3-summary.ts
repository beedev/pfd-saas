/**
 * ITR-3 summary computation — extracted from /api/tax/itr3/summary.
 *
 * Builds the one-shot totals & per-section payload for the ITR-3 hub
 * (salary, presumptive business via GST invoices, capital gains, other
 * sources, VI-A deductions with loan-derived 80C/24(b), TDS, advance
 * tax, wizard mismatch) so the route can stay a thin auth + param
 * wrapper like its ITR-1/2/4 siblings.
 *
 * FY format: "2025-26"
 * Date range: April 1 of starting year → March 31 of ending year.
 *
 * Unlike the pure-compute itr1/2/4 libs this one owns its DB reads —
 * the route's only jobs are auth and the fy param.
 */

import { eq, and, gte, lte } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  tdsCredits,
  otherSourcesIncome,
  capitalGains,
  taxDeductions,
  incomeTaxPaid,
  invoices,
  itrFormSelection,
  liabilities,
} from '@/db';
import { aggregateLoanTaxDeductions } from './loan-tax';
import { financialYearBoundsIso } from './tax-constants';
import { resolveSalaryIncome, resolveSalaryTds } from './form16-tax-source';
import { deriveDeductions } from './deduction-engine';

/** Chapter VI-A sections that are folded into the house-property head
 *  (income side), so they must NOT also count as VI-A deductions. */
const INCOME_SIDE_SECTIONS = new Set(['24B', '80EEA']);

export async function computeItr3Summary(userId: string, fy: string) {
  const { start: startDate, end: endDate } = financialYearBoundsIso(fy);

  // Schedule S — salary employers. The per-row `rows` list stays
  // books-sourced (Schedule-S detail), but the headline gross / taxable /
  // TDS totals are Form-16 authoritative (resolver): when a Part-B / Part-A
  // Form 16 exists for the FY its figures override the salary_income books,
  // else they equal the books sums (behaviour unchanged).
  const salaries = await db.select().from(salaryIncome).where(and(eq(salaryIncome.financialYear, fy), eq(salaryIncome.userId, userId)));
  const [salaryResolved, salaryTdsResolved] = await Promise.all([
    resolveSalaryIncome(userId, fy),
    resolveSalaryTds(userId, fy),
  ]);
  const totalGrossSalary = salaryResolved.grossSalaryPaisa;
  const totalTaxableSalary = salaryResolved.valuePaisa;
  const totalSalaryTds = salaryTdsResolved.valuePaisa;

  // Schedule BP — consulting from GST invoices
  // Filter: invoiceDate within FY, status not CANCELLED, type = TAX (or whatever issued invoices)
  const issuedInvoices = await db
    .select({
      taxableAmount: invoices.taxableAmount,
      invoiceDate: invoices.invoiceDate,
      customerName: invoices.customerName,
    })
    .from(invoices)
    .where(
      and(
        gte(invoices.invoiceDate, startDate),
        lte(invoices.invoiceDate, endDate),
        eq(invoices.userId, userId),
      ),
    );
  const consultingTurnover = issuedInvoices.reduce((s, r) => s + (r.taxableAmount ?? 0), 0);
  // Section 44ADA: presumptive profit = 50% of gross receipts.
  // Cap (FY 23-24 onwards): ₹75L if cash receipts ≤ 5% of total; else ₹50L.
  // Banking/UPI receipts qualify for the higher ₹75L limit.
  const presumptiveProfit44ADA = Math.round(consultingTurnover * 0.5);
  const limit44ADAPaisa = 75 * 100 * 100000; // ₹75L in paisa
  const exceedsLimit44ADA = consultingTurnover > limit44ADAPaisa;
  // Expected TDS at 10% u/s 194J on professional fees
  const expectedTds194J = Math.round(consultingTurnover * 0.10);

  // Monthly breakdown: 10% TDS deducted by each client = 10% of each invoice's taxable amount
  const monthlyMap = new Map<string, { receipts: number; tds: number; invoiceCount: number }>();
  for (const inv of issuedInvoices) {
    const yyyymm = inv.invoiceDate.substring(0, 7); // YYYY-MM
    const acc = monthlyMap.get(yyyymm) ?? { receipts: 0, tds: 0, invoiceCount: 0 };
    const receipts = inv.taxableAmount ?? 0;
    acc.receipts += receipts;
    acc.tds += Math.round(receipts * 0.10);
    acc.invoiceCount += 1;
    monthlyMap.set(yyyymm, acc);
  }
  const monthlyTdsExpected = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  // Schedule CG — capital gains
  const cgRows = await db.select().from(capitalGains).where(and(eq(capitalGains.financialYear, fy), eq(capitalGains.userId, userId)));
  const ltcgEquity = cgRows
    .filter((r) => r.holdingPeriod === 'LTCG' && r.assetType === 'EQUITY_MF')
    .reduce((s, r) => s + r.capitalGain, 0);
  const ltcgOther = cgRows
    .filter((r) => r.holdingPeriod === 'LTCG' && r.assetType !== 'EQUITY_MF')
    .reduce((s, r) => s + r.capitalGain, 0);
  const stcg = cgRows
    .filter((r) => r.holdingPeriod === 'STCG')
    .reduce((s, r) => s + r.capitalGain, 0);

  // Schedule OS — other sources
  const osRows = await db.select().from(otherSourcesIncome).where(and(eq(otherSourcesIncome.financialYear, fy), eq(otherSourcesIncome.userId, userId)));
  const totalOtherSources = osRows.reduce((s, r) => s + r.amountPaisa, 0);

  // Schedule VI-A — manual tax_deductions rows kept for the 80C-manual
  // split + rowCount; the authoritative VI-A total comes from the shared
  // deduction engine below.
  const deductionRows = await db.select().from(taxDeductions).where(and(eq(taxDeductions.financialYear, fy), eq(taxDeductions.userId, userId)));

  // Sprint 5.9c — loan-derived 80C principal (capped at ₹1.5L) + 24(b)
  // interest, surfaced for disclosure and added to the deductions
  // total so the ITR-3 page reflects the same number as regime-compare.
  const loanRows = await db
    .select()
    .from(liabilities)
    .where(eq(liabilities.userId, userId));
  const loanAgg = aggregateLoanTaxDeductions(
    loanRows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      status: r.status,
      currentBalance: r.currentBalance,
      originalAmount: r.originalAmount,
      interestRate: r.interestRate,
      monthlyEmi: r.monthlyEmi,
      startDate: r.startDate,
      maturityDate: r.maturityDate,
      remainingTenor: r.remainingTenor,
      principalQualifies80c: r.principalQualifies80c,
      interestQualifies24b: r.interestQualifies24b,
    })),
    fy,
  );
  const loanDeductions =
    'error' in loanAgg
      ? { totalInterestPaisa: 0, totalPrincipalPaisa: 0, perLiability: [] }
      : loanAgg;
  const EIGHTY_C_CAP_PAISA = 1_50_000 * 100;
  const manualEightyCPaisa = deductionRows
    .filter((r) => r.section === '80C')
    .reduce((s, r) => s + (r.amountPaisa ?? r.deductibleAmount ?? 0), 0);

  // Chapter VI-A via the shared deduction engine — the SAME source the
  // /tax regime-compare card uses, so ITR-3 reflects EVERY asset-backed
  // deduction (EPF/LIC/NPS/ELSS/SGB/small-savings → 80C, NPS Tier-I →
  // 80CCD(1B), health → 80D, donations → 80G) and not just the manual
  // tax_deductions rows + loan 80C. Income-side 24(b)/80EEA are excluded
  // (they reduce the house-property head, not VI-A).
  const engineDeductions = await deriveDeductions(userId, fy);
  const totalDeductions = Object.entries(engineDeductions.buckets)
    .filter(([sec]) => !INCOME_SIDE_SECTIONS.has(sec))
    .reduce((s, [, b]) => s + b.appliedPaisa, 0);
  const eightyCBucket = engineDeductions.buckets['80C'];
  const eightyCAppliedPaisa = eightyCBucket?.appliedPaisa ?? 0;
  const deductionBreakdown = engineDeductions.breakdown.filter(
    (b) => !b.label.includes('24(b)') && !b.label.includes('80EEA'),
  );

  // Non-salary TDS
  const tdsRows = await db.select().from(tdsCredits).where(and(eq(tdsCredits.financialYear, fy), eq(tdsCredits.userId, userId)));
  const totalNonSalaryTds = tdsRows.reduce((s, r) => s + r.tdsPaisa, 0);
  const tds2Count = tdsRows.filter((r) => r.deductorTan).length;
  const tds3Count = tdsRows.filter((r) => r.deductorPan && !r.deductorTan).length;

  // Schedule IT — advance + self-assessment tax paid
  const itRows = await db.select().from(incomeTaxPaid).where(and(eq(incomeTaxPaid.financialYear, fy), eq(incomeTaxPaid.userId, userId)));
  const advanceTaxRows = itRows.filter((r) => r.paymentType === 'ADVANCE_TAX' || r.paymentType === 'SELF_ASSESSMENT');
  const totalAdvanceTax = advanceTaxRows.reduce((s, r) => s + r.amount, 0);

  // Sprint 5.4 — wizard selection (ITR-3 is always eligible, but the
  // banner still wants to know if the wizard picked a different form
  // so it can render the mismatch callout).
  const wizardSelection = await db
    .select()
    .from(itrFormSelection)
    .where(
      and(eq(itrFormSelection.userId, userId), eq(itrFormSelection.fy, fy)),
    )
    .limit(1);

  return {
    fy,
    eligibility: {
      isEligible: true,
      flags: {
        hasForeignIncome: false,
        isDirectorOrUnlisted: false,
        agriculturalOver5k: false,
      },
    },
    excludedIncomeBlocks: [],
    wizardSelectedForm: wizardSelection[0]?.selectedForm ?? null,
    schedules: {
      salary: {
        rowCount: salaries.length,
        totalGrossSalary,
        totalTaxableSalary,
        totalSalaryTds,
        grossSource: salaryResolved.source,
        grossDetail: salaryResolved.detail,
        tdsSource: salaryTdsResolved.source,
        tdsDetail: salaryTdsResolved.detail,
        rows: salaries,
      },
      businessProfession: {
        consultingTurnover,
        invoiceCount: issuedInvoices.length,
        source: 'GST invoices (taxableAmount)',
        // Section 44ADA presumptive
        presumptiveProfit44ADA,
        presumptivePct: 50,
        limit44ADAPaisa,
        exceedsLimit44ADA,
        expectedTds194J,
        monthlyTdsExpected,
      },
      capitalGains: {
        rowCount: cgRows.length,
        ltcgEquity,
        ltcgOther,
        stcg,
      },
      otherSources: {
        rowCount: osRows.length,
        total: totalOtherSources,
        rows: osRows,
      },
      deductions: {
        rowCount: deductionRows.length,
        total: totalDeductions,
        // Engine-derived per-section breakdown (summing to `total`) so the
        // ITR-3 hub lists 80C/80CCD(1B)/80D/80G consistently with /tax.
        breakdown: deductionBreakdown,
        // Sprint 5.9c — 80C breakdown + loan-derived deductions
        eightyC: {
          manualPaisa: manualEightyCPaisa,
          fromLoansPaisa: loanDeductions.totalPrincipalPaisa,
          appliedPaisa: eightyCAppliedPaisa,
          capPaisa: EIGHTY_C_CAP_PAISA,
        },
        loanDeductions: {
          totalInterestPaisa: loanDeductions.totalInterestPaisa,
          totalPrincipalPaisa: loanDeductions.totalPrincipalPaisa,
          perLiability: loanDeductions.perLiability,
        },
      },
      tds: {
        salaryTds: totalSalaryTds,
        salaryTdsSource: salaryTdsResolved.source,
        salaryTdsDetail: salaryTdsResolved.detail,
        nonSalaryTds: totalNonSalaryTds,
        tds2Count,
        tds3Count,
      },
      advanceTax: {
        rowCount: advanceTaxRows.length,
        total: totalAdvanceTax,
      },
    },
  };
}
