import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, mutualFunds, type MutualFundType, type MutualFundCategory } from '@/db';
import { auth } from '@/auth';
import { getByIsin, getBySchemeCode } from '@/lib/services/amfi';

// GET /api/investments/mutual-funds — list all mutual fund holdings
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db
      .select()
      .from(mutualFunds)
      .where(eq(mutualFunds.userId, session.user.id))
      .orderBy(desc(mutualFunds.createdAt));
    return NextResponse.json({ mutualFunds: rows });
  } catch (error) {
    console.error('Error fetching mutual funds:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mutual funds' },
      { status: 500 }
    );
  }
}

// POST /api/investments/mutual-funds — create a mutual fund holding
// Body: { isin?, schemeCode?, schemeName, fundType, folioNumber?, units, nav?, totalInvestment, notes? }
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const {
      isin,
      schemeCode,
      schemeName,
      fundType,
      category,
      folioNumber,
      units,
      nav,
      totalInvestment,
      notes,
    } = body;

    if (!schemeName || typeof schemeName !== 'string') {
      return NextResponse.json({ error: 'schemeName is required' }, { status: 400 });
    }
    if (!fundType || !['EQUITY', 'DEBT', 'HYBRID', 'LIQUID', 'GOLD'].includes(fundType)) {
      return NextResponse.json({ error: 'fundType is required (EQUITY|DEBT|HYBRID|LIQUID|GOLD)' }, { status: 400 });
    }
    // Category (rate bucket) is optional — defaults to UNKNOWN via DB.
    // If supplied, validate against the CHECK constraint set.
    if (category !== undefined && !['EQUITY', 'DEBT', 'HYBRID', 'UNKNOWN'].includes(category)) {
      return NextResponse.json(
        { error: 'category must be EQUITY | DEBT | HYBRID | UNKNOWN' },
        { status: 400 },
      );
    }
    if (typeof units !== 'number' || units <= 0) {
      return NextResponse.json({ error: 'units must be a positive number' }, { status: 400 });
    }
    if (typeof totalInvestment !== 'number' || totalInvestment <= 0) {
      return NextResponse.json({ error: 'totalInvestment must be a positive number' }, { status: 400 });
    }

    // Resolve NAV + ISIN from AMFI if possible
    let resolvedNav: number | null =
      typeof nav === 'number' && nav > 0 ? nav : null;
    let resolvedIsin: string = typeof isin === 'string' ? isin.trim() : '';
    let lastNavDate: string | null = null;

    if (schemeCode) {
      const fund = await getBySchemeCode(String(schemeCode));
      if (fund) {
        resolvedNav = resolvedNav ?? fund.nav;
        if (!resolvedIsin) resolvedIsin = fund.isin;
        lastNavDate = fund.navDate || null;
      }
    } else if (resolvedIsin) {
      const fund = await getByIsin(resolvedIsin);
      if (fund) {
        resolvedNav = resolvedNav ?? fund.nav;
        lastNavDate = fund.navDate || null;
      }
    }

    if (resolvedNav === null) {
      return NextResponse.json(
        { error: 'nav or schemeCode/isin (for AMFI lookup) is required' },
        { status: 400 }
      );
    }
    if (!resolvedIsin) {
      // isin is NOT NULL in schema; fall back to scheme code or a placeholder
      resolvedIsin = schemeCode ? String(schemeCode) : 'UNKNOWN';
    }

    const navPaisa = Math.round(resolvedNav * 100);
    const totalInvestmentPaisa = Math.round(totalInvestment * 100);
    const currentValuePaisa = Math.round(units * navPaisa);
    const gainLossPaisa = currentValuePaisa - totalInvestmentPaisa;
    const gainLossPercent =
      totalInvestmentPaisa > 0 ? (gainLossPaisa / totalInvestmentPaisa) * 100 : 0;

    const result = await db
      .insert(mutualFunds)
      .values({
        userId: session.user.id,
        isin: resolvedIsin,
        schemeName: schemeName.trim(),
        fundType: fundType as MutualFundType,
        category: (category ?? 'UNKNOWN') as MutualFundCategory,
        folioNumber: folioNumber || null,
        units,
        nav: navPaisa,
        totalInvestment: totalInvestmentPaisa,
        currentValue: currentValuePaisa,
        gainLoss: gainLossPaisa,
        gainLossPercent,
        lastNavDate,
        notes: notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ mutualFund: result[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create mutual fund';
    console.error('Error creating mutual fund:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
