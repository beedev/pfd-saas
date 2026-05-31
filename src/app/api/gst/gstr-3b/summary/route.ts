import { NextRequest, NextResponse } from 'next/server';
import { db, invoices, purchaseInvoices, businessProfile } from '@/db';
import { eq, and } from 'drizzle-orm';
import { paisaToRupees } from '@/lib/calculations/tax';
import { auth } from '@/auth';

interface Section3_1 {
  description: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

interface Section4 {
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

interface Section6_1 {
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

// GET - Generate GSTR-3B summary for a period
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
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
    const profile = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.userId, session.user.id))
      .limit(1);
    if (profile.length === 0) {
      return NextResponse.json(
        { error: 'Business profile not set up' },
        { status: 400 }
      );
    }

    // Get all sales invoices for the period (only FINAL status)
    const salesInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.returnPeriod, period),
          eq(invoices.status, 'FINAL'),
          eq(invoices.userId, session.user.id)
        )
      );

    // Get all purchase invoices for the period (ITC eligible)
    const purchases = await db
      .select()
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.returnPeriod, period),
          eq(purchaseInvoices.itcEligible, true),
          eq(purchaseInvoices.userId, session.user.id)
        )
      );

    // Section 3.1 - Outward Supplies
    // (a) Taxable outward supplies (other than zero rated, nil rated and exempted)
    const taxableOutward = salesInvoices.reduce(
      (acc, inv) => ({
        taxableValue: acc.taxableValue + (inv.taxableAmount || 0),
        cgst: acc.cgst + (inv.cgstAmount || 0),
        sgst: acc.sgst + (inv.sgstAmount || 0),
        igst: acc.igst + (inv.igstAmount || 0),
        cess: acc.cess + (inv.cessAmount || 0),
      }),
      { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }
    );

    const section3_1: Section3_1[] = [
      {
        description: '(a) Outward taxable supplies (other than zero rated, nil rated and exempted)',
        taxableValue: paisaToRupees(taxableOutward.taxableValue),
        cgst: paisaToRupees(taxableOutward.cgst),
        sgst: paisaToRupees(taxableOutward.sgst),
        igst: paisaToRupees(taxableOutward.igst),
        cess: paisaToRupees(taxableOutward.cess),
      },
      {
        description: '(b) Outward taxable supplies (zero rated)',
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(c) Other outward supplies (nil rated, exempted)',
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(d) Inward supplies (liable to reverse charge)',
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(e) Non-GST outward supplies',
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
    ];

    // Section 4 - Eligible ITC
    const itcAvailable = purchases.reduce(
      (acc, inv) => ({
        cgst: acc.cgst + (inv.cgstAmount || 0),
        sgst: acc.sgst + (inv.sgstAmount || 0),
        igst: acc.igst + (inv.igstAmount || 0),
        cess: acc.cess + (inv.cessAmount || 0),
      }),
      { cgst: 0, sgst: 0, igst: 0, cess: 0 }
    );

    const section4: Section4[] = [
      {
        description: '(A) ITC Available (whether in full or part)',
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(1) Import of goods',
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(2) Import of services',
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(3) Inward supplies liable to reverse charge',
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(4) Inward supplies from ISD',
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(5) All other ITC',
        cgst: paisaToRupees(itcAvailable.cgst),
        sgst: paisaToRupees(itcAvailable.sgst),
        igst: paisaToRupees(itcAvailable.igst),
        cess: paisaToRupees(itcAvailable.cess),
      },
      {
        description: '(B) ITC Reversed',
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      },
      {
        description: '(C) Net ITC Available (A) - (B)',
        cgst: paisaToRupees(itcAvailable.cgst),
        sgst: paisaToRupees(itcAvailable.sgst),
        igst: paisaToRupees(itcAvailable.igst),
        cess: paisaToRupees(itcAvailable.cess),
      },
    ];

    // Section 6.1 - Payment of tax
    // Calculate tax liability
    const totalLiability = {
      cgst: taxableOutward.cgst,
      sgst: taxableOutward.sgst,
      igst: taxableOutward.igst,
      cess: taxableOutward.cess,
    };

    // ITC set-off calculation (simplified)
    // IGST can be used against IGST > CGST > SGST
    // CGST can be used against CGST > IGST
    // SGST can be used against SGST > IGST

    let remainingIgstItc = itcAvailable.igst;
    let remainingCgstItc = itcAvailable.cgst;
    let remainingSgstItc = itcAvailable.sgst;

    // Set off IGST liability
    let igstLiabilityRemaining = totalLiability.igst;
    const igstPaidByIgst = Math.min(remainingIgstItc, igstLiabilityRemaining);
    remainingIgstItc -= igstPaidByIgst;
    igstLiabilityRemaining -= igstPaidByIgst;

    const igstPaidByCgst = Math.min(remainingCgstItc, igstLiabilityRemaining);
    remainingCgstItc -= igstPaidByCgst;
    igstLiabilityRemaining -= igstPaidByCgst;

    const igstPaidBySgst = Math.min(remainingSgstItc, igstLiabilityRemaining);
    remainingSgstItc -= igstPaidBySgst;
    igstLiabilityRemaining -= igstPaidBySgst;

    // Set off CGST liability
    let cgstLiabilityRemaining = totalLiability.cgst;
    const cgstPaidByCgst = Math.min(remainingCgstItc, cgstLiabilityRemaining);
    remainingCgstItc -= cgstPaidByCgst;
    cgstLiabilityRemaining -= cgstPaidByCgst;

    const cgstPaidByIgst = Math.min(remainingIgstItc, cgstLiabilityRemaining);
    remainingIgstItc -= cgstPaidByIgst;
    cgstLiabilityRemaining -= cgstPaidByIgst;

    // Set off SGST liability
    let sgstLiabilityRemaining = totalLiability.sgst;
    const sgstPaidBySgst = Math.min(remainingSgstItc, sgstLiabilityRemaining);
    remainingSgstItc -= sgstPaidBySgst;
    sgstLiabilityRemaining -= sgstPaidBySgst;

    const sgstPaidByIgst = Math.min(remainingIgstItc, sgstLiabilityRemaining);
    remainingIgstItc -= sgstPaidByIgst;
    sgstLiabilityRemaining -= sgstPaidByIgst;

    const section6_1: Section6_1[] = [
      {
        description: 'Tax payable',
        cgst: paisaToRupees(totalLiability.cgst),
        sgst: paisaToRupees(totalLiability.sgst),
        igst: paisaToRupees(totalLiability.igst),
        cess: paisaToRupees(totalLiability.cess),
      },
      {
        description: 'Paid through ITC',
        cgst: paisaToRupees(cgstPaidByCgst + cgstPaidByIgst),
        sgst: paisaToRupees(sgstPaidBySgst + sgstPaidByIgst),
        igst: paisaToRupees(igstPaidByIgst + igstPaidByCgst + igstPaidBySgst),
        cess: 0,
      },
      {
        description: 'Tax payable in cash',
        cgst: paisaToRupees(cgstLiabilityRemaining),
        sgst: paisaToRupees(sgstLiabilityRemaining),
        igst: paisaToRupees(igstLiabilityRemaining),
        cess: paisaToRupees(totalLiability.cess),
      },
    ];

    // ITC utilization summary
    const itcUtilization = {
      igstToIgst: paisaToRupees(igstPaidByIgst),
      igstToCgst: paisaToRupees(cgstPaidByIgst),
      igstToSgst: paisaToRupees(sgstPaidByIgst),
      cgstToCgst: paisaToRupees(cgstPaidByCgst),
      cgstToIgst: paisaToRupees(igstPaidByCgst),
      sgstToSgst: paisaToRupees(sgstPaidBySgst),
      sgstToIgst: paisaToRupees(igstPaidBySgst),
    };

    return NextResponse.json({
      period,
      supplierGstin: profile[0].gstin,
      supplierName: profile[0].businessName,
      summary: {
        totalSalesInvoices: salesInvoices.length,
        totalPurchaseInvoices: purchases.length,
        totalOutwardTax: paisaToRupees(
          totalLiability.cgst + totalLiability.sgst + totalLiability.igst + totalLiability.cess
        ),
        totalItcAvailable: paisaToRupees(
          itcAvailable.cgst + itcAvailable.sgst + itcAvailable.igst + itcAvailable.cess
        ),
        totalPayableInCash: paisaToRupees(
          cgstLiabilityRemaining + sgstLiabilityRemaining + igstLiabilityRemaining + totalLiability.cess
        ),
      },
      section3_1,
      section4,
      section6_1,
      itcUtilization,
    });
  } catch (error) {
    console.error('Error generating GSTR-3B summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate GSTR-3B summary' },
      { status: 500 }
    );
  }
}
