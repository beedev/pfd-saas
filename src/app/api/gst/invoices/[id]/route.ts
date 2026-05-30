import { NextRequest, NextResponse } from 'next/server';
import { db, invoices, invoiceItems, customers, businessProfile } from '@/db';
import { eq } from 'drizzle-orm';
import { calculateTax, rupeesToPaisa } from '@/lib/calculations/tax';
import { TaxRate, isValidTaxRate } from '@/constants/tax-rates';

// GET - Fetch single invoice with items, customer, and business profile
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = parseInt(id, 10);

    if (isNaN(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    const invoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (invoice.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const items = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId));

    const customer = invoice[0].customerId
      ? await db
          .select()
          .from(customers)
          .where(eq(customers.id, invoice[0].customerId))
          .limit(1)
      : [];

    // Get business profile for PDF generation
    const business = await db.select().from(businessProfile).limit(1);

    return NextResponse.json({
      invoice: invoice[0],
      items,
      customer: customer[0] || null,
      business: business[0] || null,
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoice' },
      { status: 500 }
    );
  }
}

// DELETE - Delete invoice and its items
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = parseInt(id, 10);

    if (isNaN(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    // Check if invoice exists
    const invoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (invoice.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Delete invoice items first (foreign key constraint)
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));

    // Delete invoice
    await db.delete(invoices).where(eq(invoices.id, invoiceId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    return NextResponse.json(
      { error: 'Failed to delete invoice' },
      { status: 500 }
    );
  }
}

// PUT - Update invoice (status only or full update for drafts)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = parseInt(id, 10);

    if (isNaN(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    // Get existing invoice
    const existingInvoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (existingInvoice.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const body = await request.json();

    // If only status is provided, just update status
    if (body.status && !body.items) {
      const { status } = body;
      if (!['DRAFT', 'FINAL', 'CANCELLED'].includes(status)) {
        return NextResponse.json(
          { error: 'Invalid status. Must be DRAFT, FINAL, or CANCELLED' },
          { status: 400 }
        );
      }

      await db
        .update(invoices)
        .set({
          status,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId));

      const updated = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

      return NextResponse.json({ invoice: updated[0] });
    }

    // Full update - only allowed for DRAFT invoices
    if (existingInvoice[0].status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'Only draft invoices can be edited' },
        { status: 400 }
      );
    }

    const {
      invoiceNumber,
      invoiceDate,
      customerId,
      placeOfSupply,
      items,
      notes,
    } = body;

    // Validate required fields
    if (!invoiceNumber || !invoiceDate || !customerId || !placeOfSupply || !items?.length) {
      return NextResponse.json(
        { error: 'Invoice number, date, customer, place of supply, and items are required' },
        { status: 400 }
      );
    }

    // Get business profile for supplier state
    const profile = await db.select().from(businessProfile).limit(1);
    if (profile.length === 0) {
      return NextResponse.json(
        { error: 'Business profile not set up' },
        { status: 400 }
      );
    }
    const supplierStateCode = profile[0].stateCode;

    // Get customer details
    const customer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);

    if (customer.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 400 });
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

    // Validate tax rates
    for (const item of items) {
      if (!isValidTaxRate(item.taxRate)) {
        return NextResponse.json(
          { error: `Invalid tax rate: ${item.taxRate}` },
          { status: 400 }
        );
      }
    }

    const processedItems = items.map((item: {
      sacCode: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: TaxRate;
    }) => {
      const taxableAmount = rupeesToPaisa(item.quantity * item.unitPrice);
      const taxResult = calculateTax({
        taxableAmountPaisa: taxableAmount,
        taxRate: item.taxRate,
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
        taxRate: item.taxRate,
        cgstRate: isInterState ? 0 : item.taxRate / 2,
        cgstAmount: taxResult.cgstAmount,
        sgstRate: isInterState ? 0 : item.taxRate / 2,
        sgstAmount: taxResult.sgstAmount,
        igstRate: isInterState ? item.taxRate : 0,
        igstAmount: taxResult.igstAmount,
        totalAmount: itemTotal,
      };
    });

    const totalAmount = totalTaxableValue + totalCgst + totalSgst + totalIgst + totalCess;
    const invoiceType = customer[0].isB2B ? 'B2B' : 'B2C';

    // Calculate return period
    const date = new Date(invoiceDate);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString();
    const returnPeriod = `${month}${year}`;

    // Update invoice
    await db
      .update(invoices)
      .set({
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
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));

    // Delete existing items and insert new ones
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));

    for (const item of processedItems) {
      await db.insert(invoiceItems).values({
        invoiceId,
        ...item,
      });
    }

    // Fetch updated invoice
    const updated = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    const updatedItems = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId));

    return NextResponse.json({
      invoice: updated[0],
      items: updatedItems,
      customer: customer[0],
    });
  } catch (error) {
    console.error('Error updating invoice:', error);
    return NextResponse.json(
      { error: 'Failed to update invoice' },
      { status: 500 }
    );
  }
}
