import { NextRequest, NextResponse } from 'next/server';
import { db, holdings } from '@/db';
import { desc } from 'drizzle-orm';
import { getQuote } from '@/lib/services/yahoo-finance';

// GET /api/investments/stocks — list all holdings
export async function GET() {
  try {
    const allHoldings = await db
      .select()
      .from(holdings)
      .orderBy(desc(holdings.createdAt));

    return NextResponse.json({ holdings: allHoldings });
  } catch (error) {
    console.error('Error fetching holdings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch holdings' },
      { status: 500 }
    );
  }
}

// POST /api/investments/stocks — add a new holding
// Body: { symbol, quantity, averagePrice (rupees), purchaseDate, notes? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, quantity, averagePrice, purchaseDate, notes } = body;

    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json(
        { error: 'symbol is required' },
        { status: 400 }
      );
    }
    if (typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json(
        { error: 'quantity must be a positive number' },
        { status: 400 }
      );
    }
    if (typeof averagePrice !== 'number' || averagePrice <= 0) {
      return NextResponse.json(
        { error: 'averagePrice must be a positive number' },
        { status: 400 }
      );
    }
    if (!purchaseDate) {
      return NextResponse.json(
        { error: 'purchaseDate is required' },
        { status: 400 }
      );
    }

    const normalizedSymbol = symbol.toUpperCase().trim();
    const averagePricePaisa = Math.round(averagePrice * 100);
    const totalInvestmentPaisa = Math.round(quantity * averagePricePaisa);

    // Try to fetch the live price so we can seed currentValue on creation.
    let currentPricePaisa = averagePricePaisa;
    try {
      const quote = await getQuote(normalizedSymbol);
      if (quote?.regularMarketPrice) {
        currentPricePaisa = Math.round(quote.regularMarketPrice * 100);
      }
    } catch {
      // Fallback to averagePrice if Yahoo is unavailable.
    }

    const currentValuePaisa = Math.round(quantity * currentPricePaisa);
    const gainLossPaisa = currentValuePaisa - totalInvestmentPaisa;
    const gainLossPercent =
      totalInvestmentPaisa > 0
        ? (gainLossPaisa / totalInvestmentPaisa) * 100
        : 0;

    const result = await db
      .insert(holdings)
      .values({
        symbol: normalizedSymbol,
        quantity,
        averagePrice: averagePricePaisa,
        currentPrice: currentPricePaisa,
        purchaseDate,
        totalInvestment: totalInvestmentPaisa,
        currentValue: currentValuePaisa,
        gainLoss: gainLossPaisa,
        gainLossPercent,
        notes: notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ holding: result[0] }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create holding';
    console.error('Error creating holding:', error);
    // Unique constraint (one holding per symbol) surfaces here.
    if (message.includes('UNIQUE') || message.includes('holdings_symbol_unique')) {
      return NextResponse.json(
        { error: 'A holding for this symbol already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
