import { NextResponse } from 'next/server';
import { db, invoices, businessProfile } from '@/db';
import { desc, like, and, gte } from 'drizzle-orm';

/**
 * Get the start date of the current Indian financial year (April 1).
 * e.g., if today is 2026-04-09, FY starts 2026-04-01.
 *       if today is 2026-02-15, FY starts 2025-04-01.
 */
function currentFyStart(): string {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-04-01`;
}

/** e.g., "26-27" for FY 2026-27 */
function currentFySuffix(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}

// GET - Get next invoice number (resets per financial year)
export async function GET() {
  try {
    // Get business profile for prefix and start number
    const profile = await db.select().from(businessProfile).limit(1);
    const prefix = profile[0]?.invoicePrefix || '';
    const startNumber = profile[0]?.invoiceStartNumber || 1;
    const fyStart = currentFyStart();
    const fySuffix = currentFySuffix();

    // Find the latest invoice in the current FY
    const latestInvoice = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(gte(invoices.invoiceDate, fyStart))
      .orderBy(desc(invoices.invoiceNumber))
      .limit(1);

    let nextNumber = startNumber;

    if (latestInvoice.length > 0) {
      // Extract the numeric portion (handles both "0001/26-27" and "BCS-0001" formats)
      const numMatch = latestInvoice[0].invoiceNumber.match(/(\d+)/);
      if (numMatch) {
        const parsed = parseInt(numMatch[1], 10);
        if (!isNaN(parsed)) {
          nextNumber = parsed + 1;
        }
      }
    }

    // Format: "0001/26-27" (if prefix is empty) or "BCS-0001" (if prefix set)
    const paddedNum = nextNumber.toString().padStart(4, '0');
    const nextInvoiceNumber = prefix
      ? `${prefix}${paddedNum}`
      : `${paddedNum}/${fySuffix}`;

    return NextResponse.json({
      nextNumber,
      nextInvoiceNumber,
      prefix,
      fySuffix,
    });
  } catch (error) {
    console.error('Error getting next invoice number:', error);
    return NextResponse.json(
      { error: 'Failed to get next invoice number' },
      { status: 500 }
    );
  }
}
