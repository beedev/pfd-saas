import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, capitalGains, type CapGainAssetType, type HoldingPeriod } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const rows = await db
      .select()
      .from(capitalGains)
      .where(and(eq(capitalGains.financialYear, fy), eq(capitalGains.userId, userId)))
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

const createSchema = z.object({
  financialYear: z.string().min(1),
  assetType: z.string().min(1),
  assetName: z.string().min(1),
  purchaseDate: z.string().nullable().optional(),
  saleDate: z.string().min(1),
  purchasePrice: z.number().finite(),
  salePrice: z.number().finite(),
  holdingPeriod: z.string().min(1),
  exemption: z.number().finite().nullable().optional(),
  taxRate: z.number().finite(),
  notes: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const parsed = await parseBody(request, createSchema);
    if (parsed.error) return parsed.error;
    const {
      financialYear, assetType, assetName, purchaseDate, saleDate,
      purchasePrice, salePrice, holdingPeriod, exemption, taxRate, notes,
    } = parsed.data;

    const purchasePaisa = Math.round(purchasePrice * 100);
    const salePaisa = Math.round(salePrice * 100);
    const gainPaisa = salePaisa - purchasePaisa;
    const exemptionPaisa = Math.round((exemption ?? 0) * 100);
    const taxableGainPaisa = Math.max(0, gainPaisa - exemptionPaisa);
    const taxPaisa = Math.round(taxableGainPaisa * taxRate / 100);

    const result = await db.insert(capitalGains).values({
      userId,
      financialYear,
      // Casts preserve pre-zod behaviour: these text columns carry TS-only
      // enum hints and the handler never validated membership.
      assetType: assetType as CapGainAssetType,
      assetName,
      purchaseDate: purchaseDate || null,
      saleDate,
      purchasePrice: purchasePaisa,
      salePrice: salePaisa,
      capitalGain: gainPaisa,
      holdingPeriod: holdingPeriod as HoldingPeriod,
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
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await db.delete(capitalGains).where(and(eq(capitalGains.id, id), eq(capitalGains.userId, userId)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[capital-gains DELETE]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
