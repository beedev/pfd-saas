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
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  cashflowEvents,
  db,
  epfAccounts,
  forexDeposits,
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
import { getGrowthRates } from '@/lib/finance/asset-growth-rates';
import { getFxRatesToInr } from '@/lib/services/yahoo-finance';

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const userId = session.user.id;
    const today = new Date().toISOString().slice(0, 10);

    // Fetch all source rows in parallel — scoped by user_id. EPF accounts
    // added in Sprint 5.5b for the new EPF_MATURITY derivation. Growth
    // rates loaded centrally so cashflow + retirement-assets share a
    // single source of truth (Sprint 5.5d).
    const [
      insurance,
      nps,
      smallSavings,
      properties,
      salaries,
      retirementRows,
      sipRows,
      mfRows,
      epfRows,
      forexRows,
      growthRates,
    ] = await Promise.all([
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
      db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, userId)),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db.select().from(salaryIncome).where(eq(salaryIncome.userId, userId)),
      db.select().from(retirementAssumptions).where(eq(retirementAssumptions.userId, userId)).limit(1),
      db.select().from(sips).where(eq(sips.userId, userId)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)),
      db.select().from(epfAccounts).where(eq(epfAccounts.userId, userId)),
      db.select().from(forexDeposits).where(eq(forexDeposits.userId, userId)),
      getGrowthRates(userId),
    ]);

    // Sprint 5.10e — resolve live FX rates for the union of currencies
    // the user holds in forex_deposits. Empty array short-circuits to
    // {} so we don't make an empty Yahoo call.
    const forexCcys = Array.from(new Set(forexRows.map((r) => r.currencyCode)));
    const fxRates = forexCcys.length > 0 ? await getFxRatesToInr(forexCcys) : {};

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
      epfAccounts: epfRows,
      forexDeposits: forexRows,
      fxRates,
      growthRates,
    };
    const candidates = deriveCashflowEvents(input);

    // Phase 1 — UPSERT (insert OR refresh the auto-derived row with
    // current source values). Previously this was onConflictDoNothing,
    // which meant any edit the user made to the underlying asset (e.g.,
    // changing a policy's maturity_date) never propagated — the stale
    // event survived forever because the (user_id, source_kind,
    // source_id) row was kept as-is.
    //
    // setWhere = auto_derived guards user overrides: when the user PATCHes
    // an event we flip auto_derived to false, and subsequent derives
    // leave that row untouched. Only auto-derived rows get refreshed.
    let upserted = 0;
    let refreshed = 0;
    let kept = 0;
    for (const row of candidates) {
      // Snapshot the pre-write state so we can classify the outcome.
      // Three states:
      //   • no existing row     → INSERT (upserted)
      //   • existing auto_derived → UPDATE (refreshed)
      //   • existing user-edited → setWhere predicate skips it (kept)
      const existing = await db
        .select({
          id: cashflowEvents.id,
          autoDerived: cashflowEvents.autoDerived,
          startDate: cashflowEvents.startDate,
          amountPaisa: cashflowEvents.amountPaisa,
        })
        .from(cashflowEvents)
        .where(
          and(
            eq(cashflowEvents.userId, userId),
            eq(cashflowEvents.sourceKind, row.sourceKind),
            row.sourceId == null
              ? sql`source_id IS NULL`
              : eq(cashflowEvents.sourceId, row.sourceId),
          ),
        )
        .limit(1);

      await db
        .insert(cashflowEvents)
        .values(row)
        .onConflictDoUpdate({
          target: [cashflowEvents.userId, cashflowEvents.sourceKind, cashflowEvents.sourceId],
          set: {
            // Refresh every derivable field so edits in the source
            // table flow through. NOT touched: goalId (user earmark),
            // notes for user-promoted rows (autoDerived=false won't
            // reach this branch anyway).
            name: row.name,
            startDate: row.startDate,
            endDate: row.endDate,
            amountPaisa: row.amountPaisa,
            frequency: row.frequency,
            growthPctPerYear: row.growthPctPerYear,
            taxTreatment: row.taxTreatment,
            notes: row.notes,
            updatedAt: new Date(),
          },
          setWhere: eq(cashflowEvents.autoDerived, true),
        });

      if (existing.length === 0) {
        upserted += 1;
      } else if (existing[0].autoDerived) {
        // Detect whether the update actually changed anything observable
        // to the user. Identical re-runs are extremely common (idempotent
        // derive once a day) so distinguishing matters for the summary.
        const changed =
          existing[0].startDate !== row.startDate ||
          existing[0].amountPaisa !== row.amountPaisa;
        if (changed) refreshed += 1;
        else kept += 1;
      } else {
        // User-edited row — setWhere blocked the update; row stays as-is.
        kept += 1;
      }
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
      refreshed,
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
        epfAccounts: epfRows.length,
        forexDeposits: forexRows.filter((d) => d.status === 'ACTIVE').length,
        fxRatesResolved: Object.keys(fxRates).length,
      },
    });
  } catch (err) {
    console.error('[cashflow-events/derive POST]', err);
    return NextResponse.json({ error: 'Failed to derive events' }, { status: 500 });
  }
}

