import { NextResponse } from 'next/server';
import { db, invoices, businessProfile } from '@/db';
import { desc, like, and, gte, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import {
  getCurrentFinancialYear,
  financialYearBoundsIso,
} from '@/lib/finance/tax-constants';

// GET - Get next invoice number (resets per financial year)
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    // Get business profile for prefix and start number
    const profile = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.userId, session.user.id))
      .limit(1);
    const prefix = profile[0]?.invoicePrefix || '';
    const startNumber = profile[0]?.invoiceStartNumber || 1;
    // Current FY: start date anchors the "latest invoice this FY" query;
    // suffix ("26-27") feeds the default invoice-number format.
    const currentFy = getCurrentFinancialYear();
    const fyStart = financialYearBoundsIso(currentFy).start;
    const fySuffix = currentFy.slice(2);

    // Find the latest invoice in the current FY
    const latestInvoice = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(and(gte(invoices.invoiceDate, fyStart), eq(invoices.userId, session.user.id)))
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
