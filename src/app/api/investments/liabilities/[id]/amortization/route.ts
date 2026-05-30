import { NextRequest, NextResponse } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db, liabilities, loanAmortization } from '@/db';
import {
  parseAmortizationCsv,
  parseAmortizationPdfRows,
} from '@/lib/services/statement-parsers/amortization';
import { extractPdfRows } from '@/lib/services/statement-parsers/pdf-text';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(loanAmortization)
      .where(eq(loanAmortization.liabilityId, numericId))
      .orderBy(asc(loanAmortization.monthNumber));

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('Failed to fetch amortization:', err);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    // Verify liability exists and is a loan (not credit card)
    const liabilityRows = await db
      .select()
      .from(liabilities)
      .where(eq(liabilities.id, numericId))
      .limit(1);
    if (!liabilityRows.length) {
      return NextResponse.json({ error: 'Liability not found' }, { status: 404 });
    }
    if (liabilityRows[0].type === 'CREDIT_CARD') {
      return NextResponse.json({ error: 'Credit cards do not have amortization schedules' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    let parseResult;

    if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      const text = buffer.toString('utf-8');
      parseResult = parseAmortizationCsv(text);
    } else if (fileName.endsWith('.pdf')) {
      const pdfRows = await extractPdfRows(buffer);
      parseResult = parseAmortizationPdfRows(pdfRows);
    } else {
      return NextResponse.json(
        { error: 'Unsupported file format. Use CSV or PDF.' },
        { status: 400 },
      );
    }

    if (!parseResult.rows.length) {
      return NextResponse.json({
        error: 'No amortization rows found in file',
        warnings: parseResult.warnings,
      }, { status: 400 });
    }

    // Delete existing schedule for this liability (replace entirely)
    await db
      .delete(loanAmortization)
      .where(eq(loanAmortization.liabilityId, numericId));

    // Insert all parsed rows
    const inserted = await db
      .insert(loanAmortization)
      .values(
        parseResult.rows.map((row) => ({
          liabilityId: numericId,
          monthNumber: row.monthNumber,
          dueDate: row.dueDate,
          openingBalance: row.openingBalance,
          emi: row.emi,
          principal: row.principal,
          interest: row.interest,
          closingBalance: row.closingBalance,
          status: 'UPCOMING' as const,
        })),
      )
      .returning();

    return NextResponse.json({
      rows: inserted,
      count: inserted.length,
      meta: parseResult.meta ?? null,
      warnings: parseResult.warnings,
    }, { status: 201 });
  } catch (err) {
    console.error('Failed to upload amortization:', err);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}

/**
 * PATCH — mark a row as PAID and update loan's currentBalance
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const { rowId, status, paidOn } = body;

    if (!rowId || !status) {
      return NextResponse.json({ error: 'rowId and status required' }, { status: 400 });
    }

    const updated = await db
      .update(loanAmortization)
      .set({
        status,
        paidOn: paidOn ?? (status === 'PAID' ? new Date().toISOString().substring(0, 10) : null),
      })
      .where(eq(loanAmortization.id, rowId))
      .returning();

    if (!updated.length) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    // If marked as PAID, update loan's currentBalance to closing balance
    if (status === 'PAID') {
      await db
        .update(liabilities)
        .set({
          currentBalance: updated[0].closingBalance,
          updatedAt: new Date(),
        })
        .where(eq(liabilities.id, numericId));
    }

    return NextResponse.json({ row: updated[0] });
  } catch (err) {
    console.error('Failed to update amortization row:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
