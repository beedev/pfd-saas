import { NextRequest, NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { db, capitalGains } from '@/db';

export async function GET(request: NextRequest) {
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const rows = await db
      .select()
      .from(capitalGains)
      .where(eq(capitalGains.financialYear, fy))
      .orderBy(desc(capitalGains.saleDate));

    const ltcgTotal = rows.filter((r) => r.holdingPeriod === 'LTCG').reduce((s, r) => s + r.capitalGain, 0);
    const stcgTotal = rows.filter((r) => r.holdingPeriod === 'STCG').reduce((s, r) => s + r.capitalGain, 0);
    const totalTax = rows.reduce((s, r) => s + r.taxAmount, 0);
    const totalExemption = rows.reduce((s, r) => s + (r.exemptionApplied ?? 0), 0);

    return NextResponse.json({
      entries: rows,
      summary: { ltcgTotal, stcgTotal, totalTax, totalExemption },
    });
  } catch (err) {
    console.error('[capital-gains GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      financialYear, assetType, assetName, purchaseDate, saleDate,
      purchasePrice, salePrice, holdingPeriod, exemption, taxRate, notes,
    } = body;

    if (!financialYear || !assetType || !assetName || !saleDate || purchasePrice === undefined || salePrice === undefined || !holdingPeriod || taxRate === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const purchasePaisa = Math.round(purchasePrice * 100);
    const salePaisa = Math.round(salePrice * 100);
    const gainPaisa = salePaisa - purchasePaisa;
    const exemptionPaisa = Math.round((exemption ?? 0) * 100);
    const taxableGainPaisa = Math.max(0, gainPaisa - exemptionPaisa);
    const taxPaisa = Math.round(taxableGainPaisa * taxRate / 100);

    const result = await db.insert(capitalGains).values({
      financialYear,
      assetType,
      assetName,
      purchaseDate: purchaseDate || null,
      saleDate,
      purchasePrice: purchasePaisa,
      salePrice: salePaisa,
      capitalGain: gainPaisa,
      holdingPeriod,
      exemptionApplied: exemptionPaisa,
      taxableGain: taxableGainPaisa,
      taxRate,
      taxAmount: taxPaisa,
      notes: notes || null,
    }).returning();

    return NextResponse.json({ entry: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[capital-gains POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await db.delete(capitalGains).where(eq(capitalGains.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[capital-gains DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
