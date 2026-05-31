import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, goldHoldings, type GoldType, type GoldPurity } from '@/db';
import { auth } from '@/auth';
import { getCurrentGoldRate, calculateValue } from '@/lib/services/ibja';
import { getQuote } from '@/lib/services/yahoo-finance';

// GOLDBEES and similar Indian gold ETFs hold ~0.01g of gold per unit.
// We use this as a default when computing "effective grams" for ETFs.
const DEFAULT_ETF_GRAMS_PER_UNIT = 0.01;

const VALID_TYPES: GoldType[] = ['GOLD_BOND', 'ETF', 'PHYSICAL', 'DIGITAL'];
const VALID_PURITIES: GoldPurity[] = ['999', '995', '916'];

// GET /api/investments/gold — list all gold holdings
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db
      .select()
      .from(goldHoldings)
      .where(eq(goldHoldings.userId, session.user.id))
      .orderBy(desc(goldHoldings.createdAt));
    return NextResponse.json({ gold: rows });
  } catch (err) {
    console.error('Failed to fetch gold holdings:', err);
    return NextResponse.json(
      { error: 'Failed to fetch gold holdings' },
      { status: 500 }
    );
  }
}

interface CreateBody {
  type?: GoldType;
  name?: string;
  grams?: number;
  purity?: GoldPurity;
  purchaseDate?: string;
  purchasePricePerGram?: number; // rupees
  notes?: string;

  // SGB
  sgbSeries?: string;
  sgbIssueDate?: string;
  sgbMaturityDate?: string;
  sgbInterestRate?: number;

  // ETF
  etfSymbol?: string;
  etfUnits?: number;
  purchasePricePerUnit?: number; // rupees
}

// POST /api/investments/gold — create a gold holding
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as CreateBody;
    const {
      type,
      name,
      purchaseDate,
      notes,
      sgbSeries,
      sgbIssueDate,
      sgbMaturityDate,
      sgbInterestRate,
      etfSymbol,
      etfUnits,
      purchasePricePerUnit,
    } = body;

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `type is required (${VALID_TYPES.join('|')})` },
        { status: 400 }
      );
    }
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Per-type validation + shared computation
    let grams = typeof body.grams === 'number' ? body.grams : 0;
    let purity: GoldPurity =
      body.purity && VALID_PURITIES.includes(body.purity) ? body.purity : '999';
    let purchasePricePerGramPaisa = 0;
    let totalInvestmentPaisa = 0;
    let currentRatePerGramPaisa = 0;
    let currentValuePaisa = 0;
    let lastRateUpdate: string | null = null;

    if (type === 'ETF') {
      // For ETFs we use Yahoo Finance for the *current* rate, and compute
      // "grams" from units × DEFAULT_ETF_GRAMS_PER_UNIT so aggregation works.
      if (!etfSymbol || typeof etfSymbol !== 'string') {
        return NextResponse.json({ error: 'etfSymbol is required for ETFs' }, { status: 400 });
      }
      if (typeof etfUnits !== 'number' || etfUnits <= 0) {
        return NextResponse.json({ error: 'etfUnits must be > 0' }, { status: 400 });
      }
      if (typeof purchasePricePerUnit !== 'number' || purchasePricePerUnit <= 0) {
        return NextResponse.json(
          { error: 'purchasePricePerUnit must be > 0' },
          { status: 400 }
        );
      }

      const quote = await getQuote(etfSymbol);
      const currentUnitPrice = quote?.regularMarketPrice ?? purchasePricePerUnit;

      grams = etfUnits * DEFAULT_ETF_GRAMS_PER_UNIT;
      purity = '999';

      totalInvestmentPaisa = Math.round(etfUnits * purchasePricePerUnit * 100);
      currentValuePaisa = Math.round(etfUnits * currentUnitPrice * 100);

      // Store per-unit prices in the per-gram fields for ETFs so P&L shows
      // sensibly in the UI (treated as "rate per unit"). We also keep
      // etfUnits so the ETF form round-trips.
      purchasePricePerGramPaisa = Math.round(purchasePricePerUnit * 100);
      currentRatePerGramPaisa = Math.round(currentUnitPrice * 100);
      lastRateUpdate = quote
        ? new Date((quote.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000)
            .toISOString()
            .slice(0, 10)
        : null;
    } else {
      // SGB / PHYSICAL / DIGITAL — weight-based
      if (typeof grams !== 'number' || grams <= 0) {
        return NextResponse.json({ error: 'grams must be > 0' }, { status: 400 });
      }
      if (
        typeof body.purchasePricePerGram !== 'number' ||
        body.purchasePricePerGram <= 0
      ) {
        return NextResponse.json(
          { error: 'purchasePricePerGram must be > 0' },
          { status: 400 }
        );
      }
      if (type === 'GOLD_BOND' || type === 'DIGITAL') purity = '999';

      purchasePricePerGramPaisa = Math.round(body.purchasePricePerGram * 100);
      totalInvestmentPaisa = Math.round(grams * body.purchasePricePerGram * 100);

      const rate = await getCurrentGoldRate();
      currentRatePerGramPaisa = Math.round(rate.ratePerGram24K * 100);
      const currentValueRupees = calculateValue(grams, purity, rate.ratePerGram24K);
      currentValuePaisa = Math.round(currentValueRupees * 100);
      lastRateUpdate = rate.asOfDate;
    }

    const gainLossPaisa = currentValuePaisa - totalInvestmentPaisa;
    const gainLossPercent =
      totalInvestmentPaisa > 0 ? (gainLossPaisa / totalInvestmentPaisa) * 100 : 0;

    const result = await db
      .insert(goldHoldings)
      .values({
        userId: session.user.id,
        type,
        // Legacy NOT NULL fields (kept consistent with new fields)
        quantity: grams,
        currentPrice: currentRatePerGramPaisa,
        totalValue: currentValuePaisa,

        name: name.trim(),
        grams,
        purity,
        purchaseDate: purchaseDate || null,
        purchasePricePerGram: purchasePricePerGramPaisa,
        currentRatePerGram: currentRatePerGramPaisa,
        lastRateUpdate,
        totalInvestment: totalInvestmentPaisa,
        currentValue: currentValuePaisa,
        gainLoss: gainLossPaisa,
        gainLossPercent,
        notes: notes || null,

        sgbSeries: type === 'GOLD_BOND' ? sgbSeries || null : null,
        sgbIssueDate: type === 'GOLD_BOND' ? sgbIssueDate || null : null,
        sgbMaturityDate: type === 'GOLD_BOND' ? sgbMaturityDate || null : null,
        sgbInterestRate:
          type === 'GOLD_BOND'
            ? typeof sgbInterestRate === 'number'
              ? sgbInterestRate
              : 2.5
            : null,

        etfSymbol: type === 'ETF' ? etfSymbol || null : null,
        etfUnits: type === 'ETF' ? etfUnits || null : null,

        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ gold: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create gold holding';
    console.error('Failed to create gold holding:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
