import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, goldHoldings } from '@/db';

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
      .from(goldHoldings)
      .where(eq(goldHoldings.id, numericId))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ gold: rows[0] });
  } catch (err) {
    console.error('Failed to fetch gold holding:', err);
    return NextResponse.json({ error: 'Failed to fetch gold holding' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(goldHoldings)
      .where(eq(goldHoldings.id, numericId))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const current = existing[0];

    const body = await request.json();

    // Build partial update — only set fields that are present in the body
    const update: Partial<typeof goldHoldings.$inferInsert> = { updatedAt: new Date() };

    if (typeof body.name === 'string') update.name = body.name;
    if (typeof body.notes === 'string') update.notes = body.notes || null;
    if (typeof body.purchaseDate === 'string') update.purchaseDate = body.purchaseDate || null;
    if (typeof body.purity === 'string') update.purity = body.purity as '999' | '995' | '916';
    if (typeof body.sgbSeries === 'string') update.sgbSeries = body.sgbSeries || null;
    if (typeof body.sgbIssueDate === 'string') update.sgbIssueDate = body.sgbIssueDate || null;
    if (typeof body.sgbMaturityDate === 'string') update.sgbMaturityDate = body.sgbMaturityDate || null;
    if (typeof body.sgbInterestRate === 'number') update.sgbInterestRate = body.sgbInterestRate;
    if (typeof body.etfSymbol === 'string') update.etfSymbol = body.etfSymbol || null;
    if (typeof body.etfUnits === 'number') update.etfUnits = body.etfUnits;

    // Editable numeric fields — grams and purchase price per gram (rupees → paisa)
    const grams = typeof body.grams === 'number' ? body.grams : current.grams;
    const purchasePricePerGramPaisa =
      typeof body.purchasePricePerGramRupees === 'number'
        ? Math.round(body.purchasePricePerGramRupees * 100)
        : current.purchasePricePerGram;

    if (typeof body.grams === 'number') {
      update.grams = body.grams;
      update.quantity = body.grams; // legacy column
    }
    if (typeof body.purchasePricePerGramRupees === 'number') {
      update.purchasePricePerGram = purchasePricePerGramPaisa;
    }

    // Recompute totalInvestment whenever grams or buy price changes
    if (typeof body.grams === 'number' || typeof body.purchasePricePerGramRupees === 'number') {
      const g = grams ?? 0;
      const pp = purchasePricePerGramPaisa ?? 0;
      update.totalInvestment = Math.round(g * pp);
      update.purchasePrice = update.totalInvestment; // legacy column
    }

    const result = await db
      .update(goldHoldings)
      .set(update)
      .where(eq(goldHoldings.id, numericId))
      .returning();

    return NextResponse.json({ gold: result[0] });
  } catch (err) {
    console.error('Failed to update gold holding:', err);
    return NextResponse.json({ error: 'Failed to update gold holding' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(goldHoldings).where(eq(goldHoldings.id, numericId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete gold holding:', err);
    return NextResponse.json({ error: 'Failed to delete gold holding' }, { status: 500 });
  }
}
