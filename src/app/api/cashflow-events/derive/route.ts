/**
 * Cashflow Events — re-derive from source assets.
 *
 * POST /api/cashflow-events/derive
 *
 * Fetches the user's portfolio (insurance, NPS, small savings, real
 * estate, salary income, retirement assumptions), runs the pure
 * derivation lib, and synchronises the cashflow_events table:
 *
 *   1. UPSERT each derived row using the unique
 *      (user_id, source_kind, source_id) index. New rows are inserted;
 *      colliding rows are LEFT UNCHANGED — this protects manual
 *      overrides (auto_derived=false) from being clobbered.
 *
 *   2. DELETE any auto_derived rows whose (source_kind, source_id) pair
 *      is no longer present in the derived set. This keeps the table
 *      tidy when a user deletes a property, surrenders a policy, etc.
 *      Manual rows are never deleted by this route.
 *
 * Response: { upserted, kept, deleted } counts.
 *   upserted — rows newly inserted by this call
 *   kept     — derived candidates that collided with an existing row
 *              (manual override OR a previously derived row — both
 *              cases mean "we did not touch the existing row")
 *   deleted  — orphan auto_derived rows removed
 */

import { NextResponse } from 'next/server';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  cashflowEvents,
  db,
  insurancePolicies,
  mutualFunds,
  npsAccounts,
  realEstate,
  retirementAssumptions,
  salaryIncome,
  sips,
  smallSavingsAccounts,
} from '@/db';
import { auth } from '@/auth';
import {
  deriveCashflowEvents,
  type DerivationInput,
} from '@/lib/finance/cashflow-derivation';

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const userId = session.user.id;
    const today = new Date().toISOString().slice(0, 10);

    // Fetch all source rows in parallel — eight independent queries, all
    // scoped by user_id. sips + mutualFunds added for the SIP-as-cashflow
    // derivation.
    const [
      insurance,
      nps,
      smallSavings,
      properties,
      salaries,
      retirementRows,
      sipRows,
      mfRows,
    ] = await Promise.all([
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
      db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, userId)),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db.select().from(salaryIncome).where(eq(salaryIncome.userId, userId)),
      db.select().from(retirementAssumptions).where(eq(retirementAssumptions.userId, userId)).limit(1),
      db.select().from(sips).where(eq(sips.userId, userId)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)),
    ]);

    const input: DerivationInput = {
      userId,
      today,
      insurance,
      npsAccounts: nps,
      smallSavings,
      realEstate: properties,
      salaryIncome: salaries,
      retirement: retirementRows[0] || null,
      sips: sipRows,
      mutualFunds: mfRows,
    };
    const candidates = deriveCashflowEvents(input);

    // Phase 1 — UPSERT (insert + conflict do-nothing). The unique index
    // guarantees idempotency. We count inserted vs skipped using the
    // `returning()` row count.
    let upserted = 0;
    let kept = 0;
    for (const row of candidates) {
      const result = await db
        .insert(cashflowEvents)
        .values(row)
        .onConflictDoNothing({
          target: [cashflowEvents.userId, cashflowEvents.sourceKind, cashflowEvents.sourceId],
        })
        .returning({ id: cashflowEvents.id });
      if (result.length) upserted += 1;
      else kept += 1;
    }

    // Phase 2 — delete orphan auto_derived rows. An orphan is an
    // auto_derived row whose source_id is NOT in the freshly derived
    // candidate set for its source_kind. We bucket candidates by kind
    // so the IN clauses stay small.
    const candidateIdsByKind = new Map<string, number[]>();
    for (const row of candidates) {
      if (row.sourceId == null) continue;
      const arr = candidateIdsByKind.get(row.sourceKind) ?? [];
      arr.push(row.sourceId);
      candidateIdsByKind.set(row.sourceKind, arr);
    }

    // Existing auto_derived rows for this user, grouped by kind, that
    // have a non-null source_id (rows with null source_id are typically
    // synthetic and we don't manage their lifecycle here).
    const existing = await db
      .select({
        id: cashflowEvents.id,
        sourceKind: cashflowEvents.sourceKind,
        sourceId: cashflowEvents.sourceId,
      })
      .from(cashflowEvents)
      .where(
        and(
          eq(cashflowEvents.userId, userId),
          eq(cashflowEvents.autoDerived, true),
          isNotNull(cashflowEvents.sourceId),
        ),
      );

    const toDelete: number[] = [];
    for (const row of existing) {
      const keepIds = candidateIdsByKind.get(row.sourceKind) ?? [];
      if (row.sourceId == null) continue;
      if (!keepIds.includes(row.sourceId)) {
        toDelete.push(row.id);
      }
    }

    let deleted = 0;
    if (toDelete.length) {
      const result = await db
        .delete(cashflowEvents)
        .where(
          and(
            eq(cashflowEvents.userId, userId),
            inArray(cashflowEvents.id, toDelete),
          ),
        )
        .returning({ id: cashflowEvents.id });
      deleted = result.length;
    }

    return NextResponse.json({
      upserted,
      kept,
      deleted,
      // Helpful breadcrumb: counts of source rows considered, so the
      // user can quickly see "did we look at everything we should have".
      considered: {
        insurance: insurance.length,
        npsAccounts: nps.length,
        smallSavings: smallSavings.length,
        realEstate: properties.length,
        salaryIncome: salaries.length,
        retirementAssumptionsLoaded: retirementRows.length > 0,
        sips: sipRows.filter((s) => s.status === 'ACTIVE').length,
      },
    });
  } catch (err) {
    console.error('[cashflow-events/derive POST]', err);
    return NextResponse.json({ error: 'Failed to derive events' }, { status: 500 });
  }
}

