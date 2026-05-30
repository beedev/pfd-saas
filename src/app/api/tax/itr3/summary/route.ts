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
} from '@/db';

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
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const [startDate, endDate] = fyDateRange(fy);

    // Schedule S — salary employers
    const salaries = await db.select().from(salaryIncome).where(eq(salaryIncome.financialYear, fy));
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
    const cgRows = await db.select().from(capitalGains).where(eq(capitalGains.financialYear, fy));
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
    const osRows = await db.select().from(otherSourcesIncome).where(eq(otherSourcesIncome.financialYear, fy));
    const totalOtherSources = osRows.reduce((s, r) => s + r.amountPaisa, 0);

    // Schedule VI-A — Section 80 deductions (already exists)
    const deductionRows = await db.select().from(taxDeductions).where(eq(taxDeductions.financialYear, fy));
    // Prefer Phase-6 amountPaisa, else fallback to legacy deductibleAmount
    const totalDeductions = deductionRows.reduce(
      (s, r) => s + (r.amountPaisa ?? r.deductibleAmount ?? 0),
      0,
    );

    // Non-salary TDS
    const tdsRows = await db.select().from(tdsCredits).where(eq(tdsCredits.financialYear, fy));
    const totalNonSalaryTds = tdsRows.reduce((s, r) => s + r.tdsPaisa, 0);
    const tds2Count = tdsRows.filter((r) => r.deductorTan).length;
    const tds3Count = tdsRows.filter((r) => r.deductorPan && !r.deductorTan).length;

    // Schedule IT — advance + self-assessment tax paid
    const itRows = await db.select().from(incomeTaxPaid).where(eq(incomeTaxPaid.financialYear, fy));
    const advanceTaxRows = itRows.filter((r) => r.paymentType === 'ADVANCE_TAX' || r.paymentType === 'SELF_ASSESSMENT');
    const totalAdvanceTax = advanceTaxRows.reduce((s, r) => s + r.amount, 0);

    return NextResponse.json({
      fy,
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
