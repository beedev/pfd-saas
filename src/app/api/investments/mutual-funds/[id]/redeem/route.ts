/**
 * POST /api/investments/mutual-funds/[id]/redeem — redeem (withdraw) units.
 *
 * Body: { requestDate?: 'YYYY-MM-DD', afterCutoff?: boolean,
 *         mode: 'units'|'amount', value: number, redeemAll?: boolean,
 *         navOverride?: number /* rupees *\/ }
 *
 * Resolves the applicable business-day NAV date (SEBI cutoff rule), then:
 *   - NAV published (or override given) → settle now (SELL txn +
 *     capital_gains + reduce holding).
 *   - NAV not yet published → store PENDING; the settlement worker fills
 *     it once AMFI publishes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, mutualFunds, mfRedemptions } from '@/db';
import { auth } from '@/auth';
import { getSchemeCodeByIsin, getHistoricalNavOn } from '@/lib/services/amfi';
import { resolveApplicableNavDate, isAfterCutoffNow, nowIST } from '@/lib/finance/mf-nav-date';
import { settleRedemption } from '@/lib/finance/mf-redeem-settle';

/** GET — list this fund's redemptions (newest first). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  const mfId = Number(id);
  if (!Number.isInteger(mfId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const rows = await db
    .select()
    .from(mfRedemptions)
    .where(and(eq(mfRedemptions.userId, session.user.id), eq(mfRedemptions.mutualFundId, mfId)))
    .orderBy(desc(mfRedemptions.createdAt));
  return NextResponse.json({ redemptions: rows });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  try {
    const { id } = await params;
    const mfId = Number(id);
    if (!Number.isInteger(mfId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const mode: 'units' | 'amount' = body.mode === 'amount' ? 'amount' : 'units';
    const redeemAll = body.redeemAll === true;
    const navOverride = typeof body.navOverride === 'number' && body.navOverride > 0 ? body.navOverride : null;

    const [mf] = await db
      .select()
      .from(mutualFunds)
      .where(and(eq(mutualFunds.id, mfId), eq(mutualFunds.userId, userId)))
      .limit(1);
    if (!mf) return NextResponse.json({ error: 'Mutual fund not found' }, { status: 404 });
    if (mf.units <= 0) {
      return NextResponse.json({ error: 'No units held to redeem' }, { status: 400 });
    }

    // One open redemption per fund at a time. Prevents double/over-redeem
    // and keeps redeemAll honest about units already locked in-flight: a
    // second request while one is awaiting NAV is rejected rather than
    // racing the holding down past zero.
    const [openPending] = await db
      .select({ id: mfRedemptions.id })
      .from(mfRedemptions)
      .where(
        and(
          eq(mfRedemptions.userId, userId),
          eq(mfRedemptions.mutualFundId, mfId),
          eq(mfRedemptions.status, 'PENDING'),
        ),
      )
      .limit(1);
    if (openPending) {
      return NextResponse.json(
        {
          error:
            'A redemption for this fund is already pending settlement. Wait for it to settle (or enter its NAV) before redeeming again.',
        },
        { status: 409 },
      );
    }

    // Request inputs.
    const requestDate: string = /^\d{4}-\d{2}-\d{2}$/.test(body.requestDate)
      ? body.requestDate
      : nowIST().dateIso;
    // afterCutoff: explicit wins; else infer for a same-day request.
    const afterCutoff =
      typeof body.afterCutoff === 'boolean'
        ? body.afterCutoff
        : requestDate === nowIST().dateIso && isAfterCutoffNow(mf.fundType);

    const value = redeemAll ? mf.units : Number(body.value);
    const effectiveMode = redeemAll ? 'units' : mode;
    if (!Number.isFinite(value) || value <= 0) {
      return NextResponse.json({ error: 'value must be a positive number' }, { status: 400 });
    }
    if (effectiveMode === 'units' && value > mf.units + 1e-9) {
      return NextResponse.json(
        { error: `Cannot redeem ${value} units — only ${mf.units} held.` },
        { status: 400 },
      );
    }

    const applicableNavDate = resolveApplicableNavDate(requestDate, afterCutoff);

    // Create the redemption (PENDING). Settlement may flip it immediately.
    const [redemption] = await db
      .insert(mfRedemptions)
      .values({
        userId,
        mutualFundId: mfId,
        requestDate,
        afterCutoff,
        applicableNavDate,
        mode: effectiveMode,
        requestedValue: value,
        status: 'PENDING',
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      })
      .returning();

    // Resolve the applicable NAV: override → that (asserted for the
    // applicable date); else AMFI, which also tells us the date the NAV
    // truly belongs to (a holiday rolls to the next published day).
    let navRupees: number | null = navOverride;
    let navDateIso: string = applicableNavDate;
    if (navRupees == null) {
      const schemeCode = await getSchemeCodeByIsin(mf.isin);
      if (schemeCode) {
        const navOn = await getHistoricalNavOn(schemeCode, applicableNavDate);
        if (navOn != null) {
          navRupees = navOn.navRupees;
          navDateIso = navOn.navDateIso;
        }
      }
    }

    if (navRupees != null) {
      const settled = await settleRedemption(userId, redemption, navRupees, navDateIso);
      return NextResponse.json({ status: settled.status, redemption: settled }, { status: 201 });
    }

    return NextResponse.json(
      {
        status: 'PENDING',
        redemption,
        message: `NAV for ${applicableNavDate} isn't published yet — this redemption will settle automatically once it is (or enter the NAV manually).`,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Redemption failed';
    console.error('[mutual-funds/[id]/redeem POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
