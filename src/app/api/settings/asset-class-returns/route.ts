/**
 * Asset-class default growth assumptions.
 *
 * GET   — returns one row per asset class with the current return_pct.
 *         Seeds the table if it's empty for this user (first run).
 * PATCH — body { assetClass, returnPct } updates one row. Validates
 *         0 ≤ returnPct ≤ 50 (anything outside that range is likely a
 *         typo and would silently distort every goal projection).
 *
 * Why a table, not a JSON blob on user_preferences: makes per-class
 * audit trails easy if we later add an updated_at history view, and
 * leaves room for per-asset overrides (Sprint 5+).
 *
 * Multi-tenant: every row is scoped by user_id. The seed runs lazily
 * the first time a user opens the Settings page so existing accounts
 * pick up the defaults automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, assetClassReturns } from '@/db';
import { auth } from '@/auth';

// Seed defaults — must match the constant in lib/finance/goal-corpus.ts
// so newly-onboarded users get the same starting point a vanilla
// projection would have used.
const DEFAULTS: Array<{ assetClass: string; returnPct: number }> = [
  { assetClass: 'STOCKS', returnPct: 12 },
  { assetClass: 'MUTUAL_FUNDS', returnPct: 11 },
  // Sprint 5.7 — MF sub-classification rates. These apply ONLY when the
  // fund's `category` column is set (EQUITY/DEBT/HYBRID). Funds with
  // category=UNKNOWN fall back to the umbrella MUTUAL_FUNDS rate.
  { assetClass: 'MF_EQUITY', returnPct: 11 },
  { assetClass: 'MF_DEBT', returnPct: 7 },
  { assetClass: 'MF_HYBRID', returnPct: 9 },
  { assetClass: 'GOLD', returnPct: 9 },
  { assetClass: 'NPS', returnPct: 9.5 },
  { assetClass: 'PF', returnPct: 8.25 },
  { assetClass: 'SMALL_SAVINGS', returnPct: 7.5 },
  { assetClass: 'FIXED_DEPOSITS', returnPct: 7 },
  { assetClass: 'CHIT_FUNDS', returnPct: 6 },
  { assetClass: 'REAL_ESTATE', returnPct: 6 },
  { assetClass: 'INSURANCE_POLICIES', returnPct: 5 },
  // Sprint 5.10 — forex deposits. See asset-growth-rates-constants.ts
  // for the 5% rationale (INR depreciation drift ≈ deposit interest).
  { assetClass: 'FOREX', returnPct: 5 },
];

async function ensureSeeded(userId: string): Promise<void> {
  const existing = await db
    .select()
    .from(assetClassReturns)
    .where(eq(assetClassReturns.userId, userId));
  if (existing.length > 0) return;
  await db.insert(assetClassReturns).values(
    DEFAULTS.map((d) => ({ ...d, userId })),
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    await ensureSeeded(session.user.id);
    const rows = await db
      .select()
      .from(assetClassReturns)
      .where(eq(assetClassReturns.userId, session.user.id));
    return NextResponse.json({ rates: rows });
  } catch (err) {
    console.error('GET asset-class-returns:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { assetClass, returnPct, useInstrumentRate } = body;
    if (typeof assetClass !== 'string') {
      return NextResponse.json(
        { error: 'assetClass (string) required' },
        { status: 400 },
      );
    }
    // Either field can be updated independently.
    const update: { returnPct?: number; useInstrumentRate?: boolean; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (returnPct !== undefined) {
      if (typeof returnPct !== 'number' || returnPct < 0 || returnPct > 50) {
        return NextResponse.json(
          { error: 'returnPct must be a number between 0 and 50' },
          { status: 400 },
        );
      }
      update.returnPct = returnPct;
    }
    if (useInstrumentRate !== undefined) {
      if (typeof useInstrumentRate !== 'boolean') {
        return NextResponse.json(
          { error: 'useInstrumentRate must be a boolean' },
          { status: 400 },
        );
      }
      update.useInstrumentRate = useInstrumentRate;
    }
    await ensureSeeded(session.user.id);
    // Upsert: try update first, insert if no row exists for this class.
    const existing = await db
      .select()
      .from(assetClassReturns)
      .where(and(
        eq(assetClassReturns.assetClass, assetClass),
        eq(assetClassReturns.userId, session.user.id),
      ))
      .limit(1);
    if (existing.length) {
      await db
        .update(assetClassReturns)
        .set(update)
        .where(and(
          eq(assetClassReturns.assetClass, assetClass),
          eq(assetClassReturns.userId, session.user.id),
        ));
    } else {
      await db.insert(assetClassReturns).values({
        assetClass,
        returnPct: update.returnPct ?? 8,
        useInstrumentRate: update.useInstrumentRate ?? false,
        userId: session.user.id,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH asset-class-returns:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
