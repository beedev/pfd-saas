import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, mutualFunds } from '@/db';
import { getByIsin, getBySchemeCode } from '@/lib/services/amfi';

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

    const result = await db
      .select()
      .from(mutualFunds)
      .where(eq(mutualFunds.id, numericId))
      .limit(1);

    if (!result.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const fund = result[0];

    // Enrich with live NAV from AMFI
    let currentNav: number | null = null;
    let navDate: string | null = null;

    // Try by ISIN first, then by scheme code (isin field may contain scheme code)
    const amfiFund = await getByIsin(fund.isin) ?? await getBySchemeCode(fund.isin);
    if (amfiFund) {
      currentNav = amfiFund.nav; // rupees
      navDate = amfiFund.navDate;
    }

    return NextResponse.json({
      mutualFund: fund,
      currentNav,   // live NAV in rupees (null if lookup failed)
      navDate,
    });
  } catch (error) {
    console.error('Error fetching mutual fund:', error);
    return NextResponse.json({ error: 'Failed to fetch mutual fund' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const existing = await db
      .select()
      .from(mutualFunds)
      .where(eq(mutualFunds.id, numericId))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const current = existing[0];

    const units = typeof body.units === 'number' ? body.units : current.units;
    const navPaisa =
      typeof body.nav === 'number' ? Math.round(body.nav * 100) : current.nav;
    const totalInvestmentPaisa =
      typeof body.totalInvestment === 'number'
        ? Math.round(body.totalInvestment * 100)
        : current.totalInvestment;

    const currentValuePaisa = Math.round(units * navPaisa);
    const gainLossPaisa = currentValuePaisa - totalInvestmentPaisa;
    const gainLossPercent =
      totalInvestmentPaisa > 0 ? (gainLossPaisa / totalInvestmentPaisa) * 100 : 0;

    // Build partial update — only set fields present in body
    const updates: Record<string, unknown> = {
      units,
      nav: navPaisa,
      totalInvestment: totalInvestmentPaisa,
      currentValue: currentValuePaisa,
      gainLoss: gainLossPaisa,
      gainLossPercent,
      updatedAt: new Date(),
    };

    if (body.schemeName !== undefined) updates.schemeName = body.schemeName;
    if (body.fundType !== undefined) updates.fundType = body.fundType;
    if (body.folioNumber !== undefined) updates.folioNumber = body.folioNumber || null;
    if (body.isin !== undefined) updates.isin = body.isin;
    if (body.lastNavDate !== undefined) updates.lastNavDate = body.lastNavDate;
    if (body.investmentStartDate !== undefined) updates.investmentStartDate = body.investmentStartDate || null;
    if (body.notes !== undefined) updates.notes = body.notes || null;

    const result = await db
      .update(mutualFunds)
      .set(updates)
      .where(eq(mutualFunds.id, numericId))
      .returning();

    return NextResponse.json({ mutualFund: result[0] });
  } catch (error) {
    console.error('Error updating mutual fund:', error);
    return NextResponse.json({ error: 'Failed to update mutual fund' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(mutualFunds).where(eq(mutualFunds.id, numericId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting mutual fund:', error);
    return NextResponse.json({ error: 'Failed to delete mutual fund' }, { status: 500 });
  }
}
