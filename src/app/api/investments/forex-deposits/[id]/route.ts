/**
 * Forex deposits — single-row GET / PATCH / DELETE.
 *
 * All three handlers scope by userId so a row id leaked across users
 * can't surface another user's data. PATCH applies a partial update —
 * only fields present in the body are touched, mirroring the inline-
 * edit pattern used by other investment detail pages.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, forexDeposits, type ForexDepositStatus } from '@/db';
import { auth } from '@/auth';
import { getFxRatesToInr } from '@/lib/services/yahoo-finance';

interface Params {
  params: Promise<{ id: string }>;
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const ALLOWED_STATUS: ForexDepositStatus[] = ['ACTIVE', 'MATURED', 'CLOSED'];

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

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(forexDeposits)
      .where(and(eq(forexDeposits.id, numericId), eq(forexDeposits.userId, session.user.id)))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const rates = await getFxRatesToInr([rows[0].currencyCode]);
    return NextResponse.json({
      forexDeposit: enrichRow(rows[0], rates),
      inrValueAsOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET forex-deposits/[id]:', err);
    return NextResponse.json({ error: 'Failed to load forex deposit' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db
      .select()
      .from(forexDeposits)
      .where(and(eq(forexDeposits.id, numericId), eq(forexDeposits.userId, session.user.id)))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.bankName !== undefined) {
      if (typeof body.bankName !== 'string' || !body.bankName.trim()) {
        return NextResponse.json({ error: 'bankName must be a non-empty string' }, { status: 400 });
      }
      updates.bankName = body.bankName.trim();
    }
    if (body.accountNumber !== undefined) {
      updates.accountNumber = body.accountNumber ? String(body.accountNumber).trim() : null;
    }
    if (body.currencyCode !== undefined) {
      if (typeof body.currencyCode !== 'string' || !CURRENCY_RE.test(body.currencyCode)) {
        return NextResponse.json(
          { error: 'currencyCode must be a 3-letter ISO 4217 code' },
          { status: 400 },
        );
      }
      updates.currencyCode = body.currencyCode.toUpperCase();
    }
    if (body.amountInCurrency !== undefined) {
      const amt = typeof body.amountInCurrency === 'number'
        ? body.amountInCurrency
        : parseFloat(body.amountInCurrency);
      if (!Number.isFinite(amt) || amt <= 0) {
        return NextResponse.json(
          { error: 'amountInCurrency must be a positive number' },
          { status: 400 },
        );
      }
      updates.amountInCurrency = amt.toString();
    }
    if (body.interestRate !== undefined) {
      updates.interestRate = typeof body.interestRate === 'number' ? body.interestRate : null;
    }
    if (body.openingDate !== undefined) updates.openingDate = body.openingDate;
    if (body.maturityDate !== undefined) updates.maturityDate = body.maturityDate || null;
    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.includes(body.status)) {
        return NextResponse.json(
          { error: 'status must be ACTIVE | MATURED | CLOSED' },
          { status: 400 },
        );
      }
      updates.status = body.status;
    }
    if (body.notes !== undefined) updates.notes = body.notes ? String(body.notes).trim() : null;

    const updated = await db
      .update(forexDeposits)
      .set(updates)
      .where(and(eq(forexDeposits.id, numericId), eq(forexDeposits.userId, session.user.id)))
      .returning();

    const rates = await getFxRatesToInr([updated[0].currencyCode]);
    return NextResponse.json({ forexDeposit: enrichRow(updated[0], rates) });
  } catch (err) {
    console.error('PATCH forex-deposits/[id]:', err);
    return NextResponse.json({ error: 'Failed to update forex deposit' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db
      .delete(forexDeposits)
      .where(and(eq(forexDeposits.id, numericId), eq(forexDeposits.userId, session.user.id)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE forex-deposits/[id]:', err);
    return NextResponse.json({ error: 'Failed to delete forex deposit' }, { status: 500 });
  }
}
