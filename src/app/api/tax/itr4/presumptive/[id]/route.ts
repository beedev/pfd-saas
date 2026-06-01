/**
 * Presumptive-income CRUD (read / update / delete) — Sprint 4.1.
 *
 * All operations scoped by userId AND id; the FK + CASCADE invariant
 * means a successful match here is always tenant-owned, but we
 * double-bolt the WHERE clause anyway (defense in depth).
 *
 * PATCH validates the 44AB(e) minimum-profit rule the same way POST
 * does — caller can change grossReceipts and/or receiptMode and we
 * recompute the deemed pct + minimum.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, presumptiveIncome, type PresumptiveSection, type ReceiptMode } from '@/db';
import { auth } from '@/auth';
import { deemedProfitPctFor } from '@/lib/finance/itr4-summary';

const VALID_SECTIONS: PresumptiveSection[] = ['44AD', '44ADA', '44AE'];
const VALID_MODES: ReceiptMode[] = ['DIGITAL', 'CASH', 'MIXED'];

async function loadOwn(userId: string, id: number) {
  const [row] = await db
    .select()
    .from(presumptiveIncome)
    .where(and(eq(presumptiveIncome.id, id), eq(presumptiveIncome.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const idNum = Number(id);
    if (!Number.isFinite(idNum)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const row = await loadOwn(session.user.id, idNum);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ entry: row });
  } catch (err) {
    console.error('[tax/itr4/presumptive/:id GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const idNum = Number(id);
    if (!Number.isFinite(idNum)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const existing = await loadOwn(session.user.id, idNum);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const body = await request.json();
    const updates: Partial<typeof presumptiveIncome.$inferInsert> = {};

    if (typeof body.fy === 'string' && /^\d{4}-\d{2}$/.test(body.fy)) {
      updates.fy = body.fy;
    }
    if (VALID_SECTIONS.includes(body.section)) {
      updates.section = body.section;
    }
    if (typeof body.businessName === 'string' && body.businessName.trim()) {
      updates.businessName = body.businessName.trim();
    }
    if ('natureOfBusiness' in body) {
      updates.natureOfBusiness =
        typeof body.natureOfBusiness === 'string' && body.natureOfBusiness.trim()
          ? body.natureOfBusiness.trim()
          : null;
    }
    if ('grossReceiptsRupees' in body) {
      const p = Math.round(Number(body.grossReceiptsRupees) * 100);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json({ error: 'grossReceiptsRupees invalid' }, { status: 400 });
      }
      updates.grossReceiptsPaisa = p;
    }
    if (VALID_MODES.includes(body.receiptMode)) {
      updates.receiptMode = body.receiptMode;
    }
    if ('declaredProfitRupees' in body) {
      const p = Math.round(Number(body.declaredProfitRupees) * 100);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json({ error: 'declaredProfitRupees invalid' }, { status: 400 });
      }
      updates.declaredProfitPaisa = p;
    }
    if ('notes' in body) {
      updates.notes =
        typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    }

    // Recompute the deemed-profit minimum check using merged values.
    const mergedSection = (updates.section ?? existing.section) as PresumptiveSection;
    const mergedMode = (updates.receiptMode ?? existing.receiptMode ?? 'DIGITAL') as ReceiptMode;
    const mergedGross = updates.grossReceiptsPaisa ?? existing.grossReceiptsPaisa;
    const mergedDeclared = updates.declaredProfitPaisa ?? existing.declaredProfitPaisa;

    const pct = deemedProfitPctFor(mergedSection, mergedMode);
    if (pct != null) {
      const minimum = Math.round((mergedGross * pct) / 100);
      if (mergedDeclared < minimum) {
        return NextResponse.json(
          {
            error: `Declared profit ₹${(mergedDeclared / 100).toLocaleString(
              'en-IN',
            )} is below the section ${mergedSection} minimum of ${pct}% (₹${(
              minimum / 100
            ).toLocaleString('en-IN')}).`,
          },
          { status: 422 },
        );
      }
    }
    updates.deemedProfitPct = pct ?? 0;
    updates.updatedAt = new Date();

    const [row] = await db
      .update(presumptiveIncome)
      .set(updates)
      .where(
        and(
          eq(presumptiveIncome.id, idNum),
          eq(presumptiveIncome.userId, session.user.id),
        ),
      )
      .returning();

    return NextResponse.json({ entry: row });
  } catch (err) {
    console.error('[tax/itr4/presumptive/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const idNum = Number(id);
    if (!Number.isFinite(idNum)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const res = await db
      .delete(presumptiveIncome)
      .where(
        and(
          eq(presumptiveIncome.id, idNum),
          eq(presumptiveIncome.userId, session.user.id),
        ),
      )
      .returning({ id: presumptiveIncome.id });
    if (res.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[tax/itr4/presumptive/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
