import { NextRequest, NextResponse } from 'next/server';
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
import { auth } from '@/auth';
import { aggregateLoanTaxDeductions } from '@/lib/finance/loan-tax';

/**
 * One-shot summary endpoint for the ITR-3 hub. Returns totals & per-section
 * data for the requested FY so the UI can render a checklist + cheat-sheet.
 *
 * FY format: "2025-26"
 * Date range: April 1 of starting year → March 31 of ending year.
 */

function fyDateRange(fy: string): [string, string] {
  // "2025-26" → April 1 2025 .. March 31 2026
  const [start] = fy.split('-');
  const startYear = parseInt(start, 10);
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`];
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const [startDate, endDate] = fyDateRange(fy);

    // Schedule S — salary employers
    const salaries = await db.select().from(salaryIncome).where(and(eq(salaryIncome.financialYear, fy), eq(salaryIncome.userId, session.user.id)));
    const totalGrossSalary = salaries.reduce((s, r) => s + r.grossSalaryPaisa, 0);
    const totalTaxableSalary = salaries.reduce((s, r) => s + r.taxableSalaryPaisa, 0);
    const totalSalaryTds = salaries.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

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
          eq(invoices.userId, session.user.id),
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
    const cgRows = await db.select().from(capitalGains).where(and(eq(capitalGains.financialYear, fy), eq(capitalGains.userId, session.user.id)));
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
    const osRows = await db.select().from(otherSourcesIncome).where(and(eq(otherSourcesIncome.financialYear, fy), eq(otherSourcesIncome.userId, session.user.id)));
    const totalOtherSources = osRows.reduce((s, r) => s + r.amountPaisa, 0);

    // Schedule VI-A — Section 80 deductions (already exists)
    const deductionRows = await db.select().from(taxDeductions).where(and(eq(taxDeductions.financialYear, fy), eq(taxDeductions.userId, session.user.id)));
    // Prefer Phase-6 amountPaisa, else fallback to legacy deductibleAmount
    const manualTotalDeductions = deductionRows.reduce(
      (s, r) => s + (r.amountPaisa ?? r.deductibleAmount ?? 0),
      0,
    );

    // Sprint 5.9c — loan-derived 80C principal (capped at ₹1.5L) + 24(b)
    // interest, surfaced for disclosure and added to the deductions
    // total so the ITR-3 page reflects the same number as regime-compare.
    const loanRows = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.userId, session.user.id));
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
    const eightyCAppliedPaisa = Math.min(
      manualEightyCPaisa + loanDeductions.totalPrincipalPaisa,
      EIGHTY_C_CAP_PAISA,
    );
    const manualNon80c = manualTotalDeductions - manualEightyCPaisa;
    const totalDeductions = manualNon80c + eightyCAppliedPaisa;

    // Non-salary TDS
    const tdsRows = await db.select().from(tdsCredits).where(and(eq(tdsCredits.financialYear, fy), eq(tdsCredits.userId, session.user.id)));
    const totalNonSalaryTds = tdsRows.reduce((s, r) => s + r.tdsPaisa, 0);
    const tds2Count = tdsRows.filter((r) => r.deductorTan).length;
    const tds3Count = tdsRows.filter((r) => r.deductorPan && !r.deductorTan).length;

    // Schedule IT — advance + self-assessment tax paid
    const itRows = await db.select().from(incomeTaxPaid).where(and(eq(incomeTaxPaid.financialYear, fy), eq(incomeTaxPaid.userId, session.user.id)));
    const advanceTaxRows = itRows.filter((r) => r.paymentType === 'ADVANCE_TAX' || r.paymentType === 'SELF_ASSESSMENT');
    const totalAdvanceTax = advanceTaxRows.reduce((s, r) => s + r.amount, 0);

    // Sprint 5.4 — wizard selection (ITR-3 is always eligible, but the
    // banner still wants to know if the wizard picked a different form
    // so it can render the mismatch callout).
    const wizardSelection = await db
      .select()
      .from(itrFormSelection)
      .where(
        and(eq(itrFormSelection.userId, session.user.id), eq(itrFormSelection.fy, fy)),
      )
      .limit(1);

    return NextResponse.json({
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
          nonSalaryTds: totalNonSalaryTds,
          tds2Count,
          tds3Count,
        },
        advanceTax: {
          rowCount: advanceTaxRows.length,
          total: totalAdvanceTax,
        },
      },
    });
  } catch (err) {
    console.error('Failed to build ITR-3 summary:', err);
    return NextResponse.json({ error: 'Failed to build summary' }, { status: 500 });
  }
}
