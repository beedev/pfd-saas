import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, invoices, invoiceItems, customers, businessProfile } from '@/db';
import { and, desc, eq } from 'drizzle-orm';
import { calculateTax, rupeesToPaisa } from '@/lib/calculations/tax';
import { TaxRate, isValidTaxRate } from '@/constants/tax-rates';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';
import { syncInvoiceTdsCredit } from '@/lib/finance/derive-invoice-tds';
import { financialYearBoundsIso } from '@/lib/finance/tax-constants';

// GET - List all invoices (supports ?fy=2026-27 or ?period=MMYYYY)
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period'); // MMYYYY format
    const fy = searchParams.get('fy'); // e.g., "2026-27"

    const results = await db
      .select({
        invoice: invoices,
        customer: customers,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.userId, userId))
      .orderBy(desc(invoices.invoiceDate));

    let filteredResults = results;

    if (fy) {
      // FY filter: e.g., "2026-27" → April 1, 2026 to March 31, 2027
      const startYear = parseInt(fy.split('-')[0], 10);
      if (!isNaN(startYear)) {
        const { start: fyStart, end: fyEnd } = financialYearBoundsIso(fy);
        filteredResults = results.filter(
          (r) => r.invoice.invoiceDate >= fyStart && r.invoice.invoiceDate <= fyEnd,
        );
      }
    } else if (period) {
      filteredResults = results.filter((r) => r.invoice.returnPeriod === period);
    }

    return NextResponse.json({
      invoices: filteredResults.map((r) => ({
        ...r.invoice,
        customer: r.customer,
      })),
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}

const invoiceItemSchema = z.object({
  sacCode: z.string(),
  description: z.string(),
  quantity: z.number().finite(),
  unitPrice: z.number().finite(),
  // 0/5/12/18/28 membership is checked below via isValidTaxRate so the
  // specific error message survives.
  taxRate: z.number().finite(),
});

const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().min(1),
  // Pre-zod check was truthiness, so 0 was rejected — preserved.
  customerId: z.number().refine((v) => v !== 0, 'customerId is required'),
  placeOfSupply: z.string().min(1),
  items: z.array(invoiceItemSchema).min(1),
  notes: z.string().nullable().optional(),
});

// POST - Create new invoice
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const parsed = await parseBody(request, createInvoiceSchema);
    if (parsed.error) return parsed.error;
    const {
      invoiceNumber,
      invoiceDate,
      customerId,
      placeOfSupply,
      items,
      notes,
    } = parsed.data;

    // Get business profile for supplier state
    const profile = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.userId, userId))
      .limit(1);
    if (profile.length === 0) {
      return NextResponse.json(
        { error: 'Business profile not set up. Please configure your business details first.' },
        { status: 400 }
      );
    }
    const supplierStateCode = profile[0].stateCode;

    // Get customer details
    const customer = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.userId, userId)))
      .limit(1);

    if (customer.length === 0) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 400 }
      );
    }

    // Determine if inter-state based on supply type and place of supply
    // Export and SEZ supplies are always treated as inter-state (IGST)
    const supplyType = customer[0].supplyType || 'REGULAR';
    const isInterState =
      supplyType === 'EXPORT_WITH_IGST' ||
      supplyType === 'EXPORT_LUT' ||
      supplyType === 'SEZ' ||
      supplierStateCode !== placeOfSupply;

    // Calculate invoice totals
    let totalTaxableValue = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalCess = 0;

    // Validate tax rates before processing
    for (const item of items) {
      if (!isValidTaxRate(item.taxRate)) {
        return NextResponse.json(
          { error: `Invalid tax rate: ${item.taxRate}. Must be 0, 5, 12, 18, or 28.` },
          { status: 400 }
        );
      }
    }

    const processedItems = items.map((item) => {
      const itemTaxRate = item.taxRate as TaxRate; // membership checked above
      const taxableAmount = rupeesToPaisa(item.quantity * item.unitPrice);
      const taxResult = calculateTax({
        taxableAmountPaisa: taxableAmount,
        taxRate: itemTaxRate,
        isInterState,
      });

      totalTaxableValue += taxableAmount;
      totalCgst += taxResult.cgstAmount;
      totalSgst += taxResult.sgstAmount;
      totalIgst += taxResult.igstAmount;

      const itemTotal = taxableAmount + taxResult.cgstAmount + taxResult.sgstAmount + taxResult.igstAmount;

      return {
        sacCode: item.sacCode,
        description: item.description,
        quantity: item.quantity,
        unitPrice: rupeesToPaisa(item.unitPrice),
        taxableAmount: taxableAmount,
        taxRate: itemTaxRate,
        cgstRate: isInterState ? 0 : itemTaxRate / 2,
        cgstAmount: taxResult.cgstAmount,
        sgstRate: isInterState ? 0 : itemTaxRate / 2,
        sgstAmount: taxResult.sgstAmount,
        igstRate: isInterState ? itemTaxRate : 0,
        igstAmount: taxResult.igstAmount,
        totalAmount: itemTotal,
      };
    });

    const totalAmount = totalTaxableValue + totalCgst + totalSgst + totalIgst + totalCess;

    // Determine invoice type
    const invoiceType = customer[0].isB2B ? 'B2B' : 'B2C';

    // Calculate return period (MMYYYY)
    const date = new Date(invoiceDate);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString();
    const returnPeriod = `${month}${year}`;

    // Create invoice
    const invoiceResult = await db.insert(invoices).values({
      userId: userId,
      invoiceNumber,
      invoiceDate: new Date(invoiceDate).toISOString(),
      customerName: customer[0].name,
      customerGstin: customer[0].gstin || null,
      customerId,
      invoiceType,
      placeOfSupplyCode: placeOfSupply,
      isInterState,
      supplyType: customer[0].supplyType || 'REGULAR',
      taxableAmount: totalTaxableValue,
      cgstAmount: totalCgst,
      sgstAmount: totalSgst,
      igstAmount: totalIgst,
      cessAmount: totalCess,
      totalAmount,
      notes: notes || null,
      returnPeriod,
      status: 'DRAFT',
    }).returning();

    const invoiceId = invoiceResult[0].id;

    // Create invoice items
    for (const item of processedItems) {
      await db.insert(invoiceItems).values({
        userId: userId,
        invoiceId,
        ...item,
      });
    }

    // Fetch the complete invoice with items
    const completeInvoice = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
      .limit(1);

    const invoiceItemsResult = await db
      .select()
      .from(invoiceItems)
      .where(and(eq(invoiceItems.invoiceId, invoiceId), eq(invoiceItems.userId, userId)));

    // Sprint A.2 — DRAFTs are not eligible for TDS derivation today, but
    // call sync so the sole entry point covers any future state machine.
    try {
      await syncInvoiceTdsCredit(userId, invoiceId);
    } catch (err) {
      console.error('[invoices POST] tds derivation failed', err);
    }

    return NextResponse.json(
      {
        invoice: {
          ...completeInvoice[0],
          items: invoiceItemsResult,
          customer: customer[0],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating invoice:', error);
    return NextResponse.json(
      { error: 'Failed to create invoice' },
      { status: 500 }
    );
  }
}
