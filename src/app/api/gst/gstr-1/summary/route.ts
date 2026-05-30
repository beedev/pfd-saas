import { NextRequest, NextResponse } from 'next/server';
import { db, invoices, invoiceItems, businessProfile } from '@/db';
import { eq, and, gte, lt } from 'drizzle-orm';
import { paisaToRupees } from '@/lib/calculations/tax';
import { STATE_CODES } from '@/constants/state-codes';

interface B2BInvoice {
  customerGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  reverseCharge: string;
  invoiceType: string;
  supplyType: string;
  rate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
}

interface B2CSSummary {
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  cessAmount: number;
}

interface B2CLInvoice {
  placeOfSupply: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  rate: number;
  taxableValue: number;
  igstAmount: number;
  cessAmount: number;
}

interface SACHSNSummary {
  sacCode: string;
  description: string;
  uqc: string;
  totalQuantity: number;
  totalValue: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
}

// GET - Generate GSTR-1 summary for a period
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period'); // MMYYYY format

    if (!period || !/^\d{6}$/.test(period)) {
      return NextResponse.json(
        { error: 'Valid period (MMYYYY) is required' },
        { status: 400 }
      );
    }

    // Get business profile
    const profile = await db.select().from(businessProfile).limit(1);
    if (profile.length === 0) {
      return NextResponse.json(
        { error: 'Business profile not set up' },
        { status: 400 }
      );
    }
    const supplierStateCode = profile[0].stateCode;

    // Get all invoices for the period (only FINAL status)
    const periodInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.returnPeriod, period),
          eq(invoices.status, 'FINAL')
        )
      );

    // Initialize summaries
    const b2bInvoices: B2BInvoice[] = [];
    const b2csSummary: Map<string, B2CSSummary> = new Map();
    const b2clInvoices: B2CLInvoice[] = [];
    const sacSummary: Map<string, SACHSNSummary> = new Map();

    // Process each invoice
    for (const invoice of periodInvoices) {
      // Get invoice items
      const items = await db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, invoice.id));

      // Calculate totals per tax rate for the invoice
      const rateWiseTotals = new Map<number, {
        taxableValue: number;
        cgst: number;
        sgst: number;
        igst: number;
        cess: number;
      }>();

      for (const item of items) {
        const rate = item.taxRate;
        const existing = rateWiseTotals.get(rate) || {
          taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0
        };

        existing.taxableValue += item.taxableAmount;
        existing.cgst += item.cgstAmount || 0;
        existing.sgst += item.sgstAmount || 0;
        existing.igst += item.igstAmount || 0;

        rateWiseTotals.set(rate, existing);

        // Update SAC summary
        const sacKey = `${item.sacCode}-${item.taxRate}`;
        const existingSac = sacSummary.get(sacKey) || {
          sacCode: item.sacCode,
          description: item.description,
          uqc: 'OTH',
          totalQuantity: 0,
          totalValue: 0,
          taxableValue: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          cessAmount: 0,
        };

        existingSac.totalQuantity += item.quantity || 1;
        existingSac.totalValue += item.totalAmount;
        existingSac.taxableValue += item.taxableAmount;
        existingSac.cgstAmount += item.cgstAmount || 0;
        existingSac.sgstAmount += item.sgstAmount || 0;
        existingSac.igstAmount += item.igstAmount || 0;

        sacSummary.set(sacKey, existingSac);
      }

      // B2B invoices (with GSTIN)
      if (invoice.invoiceType === 'B2B' && invoice.customerGstin) {
        for (const [rate, totals] of rateWiseTotals) {
          b2bInvoices.push({
            customerGstin: invoice.customerGstin,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate,
            invoiceValue: paisaToRupees(invoice.totalAmount),
            placeOfSupply: `${invoice.placeOfSupplyCode} - ${STATE_CODES[invoice.placeOfSupplyCode] || ''}`,
            reverseCharge: invoice.isReverseCharge ? 'Y' : 'N',
            invoiceType: 'Regular',
            supplyType: invoice.supplyType || 'REGULAR',
            rate,
            taxableValue: paisaToRupees(totals.taxableValue),
            cgstAmount: paisaToRupees(totals.cgst),
            sgstAmount: paisaToRupees(totals.sgst),
            igstAmount: paisaToRupees(totals.igst),
            cessAmount: paisaToRupees(totals.cess),
          });
        }
      }

      // B2C invoices
      if (invoice.invoiceType === 'B2C') {
        const invoiceValueRupees = paisaToRupees(invoice.totalAmount);
        const isInterState = invoice.isInterState;

        // B2CL: Inter-state invoices > 2.5 lakhs
        if (isInterState && invoiceValueRupees > 250000) {
          for (const [rate, totals] of rateWiseTotals) {
            b2clInvoices.push({
              placeOfSupply: `${invoice.placeOfSupplyCode} - ${STATE_CODES[invoice.placeOfSupplyCode] || ''}`,
              invoiceNumber: invoice.invoiceNumber,
              invoiceDate: invoice.invoiceDate,
              invoiceValue: invoiceValueRupees,
              rate,
              taxableValue: paisaToRupees(totals.taxableValue),
              igstAmount: paisaToRupees(totals.igst),
              cessAmount: paisaToRupees(totals.cess),
            });
          }
        } else {
          // B2CS: All other B2C (intra-state + inter-state <= 2.5L)
          for (const [rate, totals] of rateWiseTotals) {
            const key = `${invoice.placeOfSupplyCode}-${rate}`;
            const existing = b2csSummary.get(key) || {
              placeOfSupply: `${invoice.placeOfSupplyCode} - ${STATE_CODES[invoice.placeOfSupplyCode] || ''}`,
              rate,
              taxableValue: 0,
              cgstAmount: 0,
              sgstAmount: 0,
              cessAmount: 0,
            };

            existing.taxableValue += paisaToRupees(totals.taxableValue);
            existing.cgstAmount += paisaToRupees(totals.cgst);
            existing.sgstAmount += paisaToRupees(totals.sgst);
            existing.cessAmount += paisaToRupees(totals.cess);

            b2csSummary.set(key, existing);
          }
        }
      }
    }

    // Calculate totals
    const totalB2B = b2bInvoices.reduce((sum, inv) => sum + inv.taxableValue, 0);
    const totalB2CS = Array.from(b2csSummary.values()).reduce((sum, item) => sum + item.taxableValue, 0);
    const totalB2CL = b2clInvoices.reduce((sum, inv) => sum + inv.taxableValue, 0);

    const totalTaxableValue = totalB2B + totalB2CS + totalB2CL;
    const totalTax = periodInvoices.reduce((sum, inv) => {
      return sum + (inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0);
    }, 0);

    // Convert SAC summary map to array
    const sacSummaryArray = Array.from(sacSummary.values()).map((item) => ({
      ...item,
      totalValue: paisaToRupees(item.totalValue),
      taxableValue: paisaToRupees(item.taxableValue),
      cgstAmount: paisaToRupees(item.cgstAmount),
      sgstAmount: paisaToRupees(item.sgstAmount),
      igstAmount: paisaToRupees(item.igstAmount),
      cessAmount: paisaToRupees(item.cessAmount),
    }));

    return NextResponse.json({
      period,
      supplierGstin: profile[0].gstin,
      supplierName: profile[0].businessName,
      summary: {
        totalInvoices: periodInvoices.length,
        b2bCount: b2bInvoices.length,
        b2csCount: b2csSummary.size,
        b2clCount: b2clInvoices.length,
        totalTaxableValue: paisaToRupees(totalTaxableValue * 100), // Convert back to paisa first
        totalTax: paisaToRupees(totalTax),
      },
      b2b: b2bInvoices,
      b2cs: Array.from(b2csSummary.values()),
      b2cl: b2clInvoices,
      hsn: sacSummaryArray,
    });
  } catch (error) {
    console.error('Error generating GSTR-1 summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate GSTR-1 summary' },
      { status: 500 }
    );
  }
}
