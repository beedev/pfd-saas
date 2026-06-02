/**
 * Forex deposits — list + create.
 *
 * GET   — list the user's deposits, ordered by status (ACTIVE first)
 *         then opening_date desc. Each row gets `inrValuePaisa` computed
 *         from the live FX rate at the time of the request. `inrValueAsOf`
 *         is a per-response ISO timestamp the UI can show in a tooltip.
 *
 * POST  — create. Validates currency_code matches /^[A-Z]{3}$/ and
 *         amount > 0 server-side. 23505 → 409 (no UNIQUE indexes today
 *         but stay defensive; identical (user, bank, account, currency)
 *         duplicates may get a UNIQUE constraint in a later sprint).
 *
 * Multi-tenant: SELECTs scope by userId; INSERT stamps userId first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db, forexDeposits, type ForexDepositStatus } from '@/db';
import { auth } from '@/auth';
import { getFxRatesToInr } from '@/lib/services/yahoo-finance';

const CURRENCY_RE = /^[A-Z]{3}$/;
const ALLOWED_STATUS: ForexDepositStatus[] = ['ACTIVE', 'MATURED', 'CLOSED'];

/**
 * Convert a forex_deposits row (with stringified numeric amount) into
 * the API response shape: amount as a JS number, plus the resolved
 * INR equivalent in paisa. Rates map comes from the live FX service;
 * missing currencies leave inrValuePaisa null so the UI can show
 * "live rate unavailable" without breaking.
 */
function enrichRow(row: typeof forexDeposits.$inferSelect, rates: Record<string, number>) {
  const amount = parseFloat(row.amountInCurrency as unknown as string);
  const rate = rates[row.currencyCode.toUpperCase()];
  const inrValuePaisa =
    Number.isFinite(amount) && Number.isFinite(rate)
      ? Math.round(amount * rate * 100)
      : null;
  return {
    ...row,
    amountInCurrency: amount,
    fxRate: rate ?? null,
    inrValuePaisa,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    // Order: ACTIVE first (CASE returns 0 for ACTIVE, 1 otherwise),
    // then opening_date descending so the most recent shows at the top.
    const rows = await db
      .select()
      .from(forexDeposits)
      .where(eq(forexDeposits.userId, session.user.id))
      .orderBy(
        sql`CASE WHEN ${forexDeposits.status} = 'ACTIVE' THEN 0 ELSE 1 END`,
        sql`${forexDeposits.openingDate} DESC`,
      );

    const codes = Array.from(new Set(rows.map((r) => r.currencyCode)));
    const rates = codes.length > 0 ? await getFxRatesToInr(codes) : {};
    const enriched = rows.map((r) => enrichRow(r, rates));
    return NextResponse.json({
      forexDeposits: enriched,
      rates,
      inrValueAsOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET forex-deposits:', err);
    return NextResponse.json({ error: 'Failed to list forex deposits' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const {
      bankName,
      accountNumber,
      currencyCode,
      amountInCurrency,
      interestRate,
      openingDate,
      maturityDate,
      status,
      notes,
    } = body;

    if (!bankName || typeof bankName !== 'string') {
      return NextResponse.json({ error: 'bankName is required' }, { status: 400 });
    }
    if (typeof currencyCode !== 'string' || !CURRENCY_RE.test(currencyCode)) {
      return NextResponse.json(
        { error: 'currencyCode must be a 3-letter ISO 4217 code (e.g. USD)' },
        { status: 400 },
      );
    }
    const amt = typeof amountInCurrency === 'number'
      ? amountInCurrency
      : parseFloat(amountInCurrency);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json(
        { error: 'amountInCurrency must be a positive number' },
        { status: 400 },
      );
    }
    if (!openingDate || typeof openingDate !== 'string') {
      return NextResponse.json({ error: 'openingDate is required (ISO date)' }, { status: 400 });
    }
    if (status !== undefined && !ALLOWED_STATUS.includes(status)) {
      return NextResponse.json(
        { error: 'status must be ACTIVE | MATURED | CLOSED' },
        { status: 400 },
      );
    }

    const inserted = await db
      .insert(forexDeposits)
      .values({
        userId: session.user.id,
        bankName: bankName.trim(),
        accountNumber: accountNumber?.trim() || null,
        currencyCode: currencyCode.toUpperCase(),
        // Drizzle accepts string for numeric() to preserve precision.
        amountInCurrency: amt.toString(),
        interestRate: typeof interestRate === 'number' ? interestRate : null,
        openingDate,
        maturityDate: maturityDate || null,
        status: (status ?? 'ACTIVE') as ForexDepositStatus,
        notes: notes?.trim() || null,
      })
      .returning();

    const rates = await getFxRatesToInr([inserted[0].currencyCode]);
    return NextResponse.json(
      { forexDeposit: enrichRow(inserted[0], rates) },
      { status: 201 },
    );
  } catch (err: unknown) {
    // Stay defensive on unique-conflict even though no UNIQUE indexes
    // exist today — keeps callers consistent if we add one later.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      return NextResponse.json({ error: 'Duplicate deposit' }, { status: 409 });
    }
    console.error('POST forex-deposits:', err);
    return NextResponse.json({ error: 'Failed to create forex deposit' }, { status: 500 });
  }
}
