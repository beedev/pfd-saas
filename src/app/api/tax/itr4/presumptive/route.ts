/**
 * Presumptive-income CRUD (list / create) — Sprint 4.1.
 *
 * Owns the `presumptive_income` table. List is scoped by (user, fy).
 * Create validates that `declaredProfit >= grossReceipts * deemedPct /
 * 100` server-side for 44AD/44ADA; 44AE accepts the declared value
 * as-is (no auto-minimum modelled). Server-side check is deliberate:
 * the UI surfaces the minimum live, but ITR section 44AB(e) audit-
 * trigger is a hard rule and must not be a client-only guard.
 *
 * Auth pattern + findPgError follow the same shape as the rest of
 * the tax routes (see itr-form-selection/route.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, presumptiveIncome, type PresumptiveSection, type ReceiptMode } from '@/db';
import { auth } from '@/auth';
import { deemedProfitPctFor } from '@/lib/finance/itr4-summary';

function findPgError(err: unknown): { code?: string; detail?: string } {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const c = cur as { code?: unknown; detail?: unknown; cause?: unknown };
      if (typeof c.code === 'string') {
        return {
          code: c.code,
          detail: typeof c.detail === 'string' ? c.detail : '',
        };
      }
      cur = c.cause;
    } else {
      break;
    }
  }
  return {};
}

const VALID_SECTIONS: PresumptiveSection[] = ['44AD', '44ADA', '44AE'];
const VALID_MODES: ReceiptMode[] = ['DIGITAL', 'CASH', 'MIXED'];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const rows = await db
      .select()
      .from(presumptiveIncome)
      .where(
        and(
          eq(presumptiveIncome.userId, session.user.id),
          eq(presumptiveIncome.fy, fy),
        ),
      )
      .orderBy(desc(presumptiveIncome.createdAt));

    return NextResponse.json({ entries: rows });
  } catch (err) {
    console.error('[tax/itr4/presumptive GET]', err);
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const {
      fy,
      section,
      businessName,
      natureOfBusiness,
      grossReceiptsRupees,
      receiptMode,
      declaredProfitRupees,
      notes,
    } = body ?? {};

    if (typeof fy !== 'string' || !/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json({ error: 'fy required (YYYY-YY)' }, { status: 400 });
    }
    if (!VALID_SECTIONS.includes(section)) {
      return NextResponse.json(
        { error: 'section must be 44AD / 44ADA / 44AE' },
        { status: 400 },
      );
    }
    if (typeof businessName !== 'string' || !businessName.trim()) {
      return NextResponse.json({ error: 'businessName required' }, { status: 400 });
    }
    const grossPaisa = Math.round(Number(grossReceiptsRupees) * 100);
    const declaredPaisa = Math.round(Number(declaredProfitRupees) * 100);
    if (!Number.isFinite(grossPaisa) || grossPaisa < 0) {
      return NextResponse.json({ error: 'grossReceiptsRupees invalid' }, { status: 400 });
    }
    if (!Number.isFinite(declaredPaisa) || declaredPaisa < 0) {
      return NextResponse.json({ error: 'declaredProfitRupees invalid' }, { status: 400 });
    }
    const mode: ReceiptMode = VALID_MODES.includes(receiptMode)
      ? receiptMode
      : 'DIGITAL';

    // Server-side deemed-profit-minimum check for 44AD/44ADA. 44AE
    // doesn't have an auto-minimum in this engine (per-vehicle math
    // deferred), so we accept declared as-is.
    const pct = deemedProfitPctFor(section as PresumptiveSection, mode);
    if (pct != null) {
      const minimumPaisa = Math.round((grossPaisa * pct) / 100);
      if (declaredPaisa < minimumPaisa) {
        return NextResponse.json(
          {
            error: `Declared profit ₹${(declaredPaisa / 100).toLocaleString(
              'en-IN',
            )} is below the section ${section} minimum of ${pct}% of gross receipts (₹${(
              minimumPaisa / 100
            ).toLocaleString('en-IN')}). Filing below the minimum triggers a mandatory tax audit under sec 44AB(e).`,
          },
          { status: 422 },
        );
      }
    }

    const [row] = await db
      .insert(presumptiveIncome)
      .values({
        userId: session.user.id,
        fy,
        section: section as PresumptiveSection,
        businessName: businessName.trim(),
        natureOfBusiness:
          typeof natureOfBusiness === 'string' && natureOfBusiness.trim()
            ? natureOfBusiness.trim()
            : null,
        grossReceiptsPaisa: grossPaisa,
        receiptMode: mode,
        deemedProfitPct: pct ?? 0,
        declaredProfitPaisa: declaredPaisa,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      })
      .returning();

    return NextResponse.json({ entry: row }, { status: 201 });
  } catch (err) {
    console.error('[tax/itr4/presumptive POST]', err);
    const { code, detail } = findPgError(err);
    if (code === '23505') {
      return NextResponse.json(
        { error: 'Duplicate entry', detail },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
