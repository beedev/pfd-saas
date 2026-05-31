import { NextRequest, NextResponse } from 'next/server';
import { db, invoices, invoiceItems, customers, businessProfile } from '@/db';
import { and, eq } from 'drizzle-orm';
import { calculateTax, rupeesToPaisa } from '@/lib/calculations/tax';
import { TaxRate, isValidTaxRate } from '@/constants/tax-rates';
import { STATE_CODES } from '@/constants/state-codes';
import { auth } from '@/auth';

interface ImportRow {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGstin?: string;
  customerStateCode: string;
  placeOfSupply: string;
  description: string;
  sacCode: string;
  quantity?: number;
  unitPrice: number;
  taxRate: number;
}

interface ImportResult {
  success: boolean;
  invoiceNumber: string;
  error?: string;
}

// POST - Import invoices from CSV data
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { rows } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: 'No data provided for import' },
        { status: 400 }
      );
    }

    // Get business profile for supplier state
    const profile = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.userId, session.user.id))
      .limit(1);
    if (profile.length === 0) {
      return NextResponse.json(
        { error: 'Business profile not set up. Please configure your business details first.' },
        { status: 400 }
      );
    }
    const supplierStateCode = profile[0].stateCode;

    const results: ImportResult[] = [];
    const invoiceGroups = new Map<string, ImportRow[]>();

    // Group rows by invoice number
    for (const row of rows as ImportRow[]) {
      if (!row.invoiceNumber) {
        results.push({
          success: false,
          invoiceNumber: 'Unknown',
          error: 'Missing invoice number',
        });
        continue;
      }

      const existing = invoiceGroups.get(row.invoiceNumber) || [];
      existing.push(row);
      invoiceGroups.set(row.invoiceNumber, existing);
    }

    // Process each invoice group
    for (const [invoiceNumber, items] of invoiceGroups) {
      try {
        const firstItem = items[0];

        // Validate required fields
        if (!firstItem.invoiceDate) {
          results.push({
            success: false,
            invoiceNumber,
            error: 'Missing invoice date',
          });
          continue;
        }

        if (!firstItem.customerName) {
          results.push({
            success: false,
            invoiceNumber,
            error: 'Missing customer name',
          });
          continue;
        }

        if (!firstItem.placeOfSupply || !STATE_CODES[firstItem.placeOfSupply]) {
          results.push({
            success: false,
            invoiceNumber,
            error: `Invalid place of supply: ${firstItem.placeOfSupply}`,
          });
          continue;
        }

        // Find or create customer
        let customerId: number | null = null;
        const customerGstin = firstItem.customerGstin || null;

        if (customerGstin) {
          // Look for existing customer by GSTIN
          const existingCustomer = await db
            .select()
            .from(customers)
            .where(and(eq(customers.gstin, customerGstin), eq(customers.userId, session.user.id)))
            .limit(1);

          if (existingCustomer.length > 0) {
            customerId = existingCustomer[0].id;
          }
        }

        // Create customer if not found
        if (!customerId) {
          const customerStateCode = firstItem.customerStateCode || firstItem.placeOfSupply;
          const isB2B = !!customerGstin;

          const newCustomer = await db.insert(customers).values({
            userId: session.user.id,
            name: firstItem.customerName,
            gstin: customerGstin,
            stateCode: customerStateCode,
            isB2B,
          }).returning();

          customerId = newCustomer[0].id;
        }

        // Determine if inter-state
        const isInterState = supplierStateCode !== firstItem.placeOfSupply;

        // Calculate totals
        let totalTaxableValue = 0;
        let totalCgst = 0;
        let totalSgst = 0;
        let totalIgst = 0;

        const processedItems = [];
        let hasError = false;

        for (const item of items) {
          // Validate tax rate
          if (!isValidTaxRate(item.taxRate)) {
            results.push({
              success: false,
              invoiceNumber,
              error: `Invalid tax rate: ${item.taxRate}. Must be 0, 5, 12, 18, or 28.`,
            });
            hasError = true;
            break;
          }

          if (!item.sacCode) {
            results.push({
              success: false,
              invoiceNumber,
              error: 'Missing SAC code',
            });
            hasError = true;
            break;
          }

          const quantity = item.quantity || 1;
          const taxableAmount = rupeesToPaisa(quantity * item.unitPrice);
          const taxRate = item.taxRate as TaxRate;

          const taxResult = calculateTax({
            taxableAmountPaisa: taxableAmount,
            taxRate,
            isInterState,
          });

          totalTaxableValue += taxableAmount;
          totalCgst += taxResult.cgstAmount;
          totalSgst += taxResult.sgstAmount;
          totalIgst += taxResult.igstAmount;

          const itemTotal = taxableAmount + taxResult.cgstAmount + taxResult.sgstAmount + taxResult.igstAmount;

          processedItems.push({
            sacCode: item.sacCode,
            description: item.description || `Service - ${item.sacCode}`,
            quantity,
            unitPrice: rupeesToPaisa(item.unitPrice),
            taxableAmount,
            taxRate,
            cgstRate: isInterState ? 0 : taxRate / 2,
            cgstAmount: taxResult.cgstAmount,
            sgstRate: isInterState ? 0 : taxRate / 2,
            sgstAmount: taxResult.sgstAmount,
            igstRate: isInterState ? taxRate : 0,
            igstAmount: taxResult.igstAmount,
            totalAmount: itemTotal,
          });
        }

        if (hasError) continue;

        const totalAmount = totalTaxableValue + totalCgst + totalSgst + totalIgst;

        // Determine invoice type
        const invoiceType = customerGstin ? 'B2B' : 'B2C';

        // Parse invoice date
        let parsedDate: Date;
        try {
          // Handle DD-MM-YYYY format
          if (firstItem.invoiceDate.includes('-') && firstItem.invoiceDate.split('-')[0].length <= 2) {
            const [day, month, year] = firstItem.invoiceDate.split('-');
            parsedDate = new Date(`${year}-${month}-${day}`);
          } else {
            parsedDate = new Date(firstItem.invoiceDate);
          }

          if (isNaN(parsedDate.getTime())) {
            throw new Error('Invalid date');
          }
        } catch {
          results.push({
            success: false,
            invoiceNumber,
            error: `Invalid date format: ${firstItem.invoiceDate}`,
          });
          continue;
        }

        // Calculate return period (MMYYYY)
        const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
        const year = parsedDate.getFullYear().toString();
        const returnPeriod = `${month}${year}`;

        // Check if invoice already exists
        const existingInvoice = await db
          .select()
          .from(invoices)
          .where(and(eq(invoices.invoiceNumber, invoiceNumber), eq(invoices.userId, session.user.id)))
          .limit(1);

        if (existingInvoice.length > 0) {
          results.push({
            success: false,
            invoiceNumber,
            error: 'Invoice number already exists',
          });
          continue;
        }

        // Create invoice
        const invoiceResult = await db.insert(invoices).values({
          userId: session.user.id,
          invoiceNumber,
          invoiceDate: parsedDate.toISOString(),
          customerName: firstItem.customerName,
          customerGstin,
          customerId,
          invoiceType,
          placeOfSupplyCode: firstItem.placeOfSupply,
          isInterState,
          taxableAmount: totalTaxableValue,
          cgstAmount: totalCgst,
          sgstAmount: totalSgst,
          igstAmount: totalIgst,
          cessAmount: 0,
          totalAmount,
          returnPeriod,
          status: 'DRAFT',
        }).returning();

        const invoiceId = invoiceResult[0].id;

        // Create invoice items
        for (const item of processedItems) {
          await db.insert(invoiceItems).values({
            userId: session.user.id,
            invoiceId,
            ...item,
          });
        }

        results.push({
          success: true,
          invoiceNumber,
        });
      } catch (error) {
        results.push({
          success: false,
          invoiceNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      message: `Imported ${successCount} invoices, ${failCount} failed`,
      results,
      successCount,
      failCount,
    });
  } catch (error) {
    console.error('Error importing invoices:', error);
    return NextResponse.json(
      { error: 'Failed to import invoices' },
      { status: 500 }
    );
  }
}
