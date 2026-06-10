/**
 * Per-Goal Asset Mapping — same shape as /api/finance/savings-assets
 * but the inclusion state is keyed by (goal_id, asset_class, source_id),
 * and each row carries an allocation_pct (0–100) describing what fraction
 * of the asset's value flows to this goal.
 *
 * GET   → all assets + which ones are mapped to this goal (per-row),
 *         per-row allocationPct, and per-row otherAllocations[] (the
 *         allocations on OTHER goals for the same asset).
 * PATCH → body: { assetClass, sourceId?, included, allocationPct? }
 *         Validates that the sum of allocation_pct across all goals for
 *         the same (user, asset_class, source_id) is ≤ 100. Returns 409
 *         when over-allocated.
 *
 * Default semantics: when no row exists in savings_asset_inclusion for
 * a (goal, asset) pair, included defaults to FALSE and allocationPct
 * defaults to 100. The user has to opt in per-goal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, ne } from 'drizzle-orm';
import {
  db,
  savingsAssetInclusion,
  financialGoals,
  holdings,
  mutualFunds,
  goldHoldings,
  npsAccounts,
  epfAccounts,
  smallSavingsAccounts,
  chitFunds,
  insurancePolicies,
  fixedDeposits,
} from '@/db';
import { auth } from '@/auth';
import { MATURING_POLICY_TYPES } from '@/lib/finance/retirement-shared';

type Liquidity = 'liquid' | 'semi-liquid' | 'locked';

interface OtherAllocation {
  goalId: number;
  goalName: string;
  allocationPct: number;
}

interface AggregateAsset {
  kind: 'aggregate';
  assetClass: string;
  label: string;
  /** Raw current value of the entire asset class (not weighted). */
  valuePaisa: number;
  liquidity: Liquidity;
  included: boolean;
  /** 0–100; defaults to 100 when no inclusion row exists. */
  allocationPct: number;
  /** Allocations carved out by OTHER goals on the same asset. */
  otherAllocations: OtherAllocation[];
  basis?: string;
}

interface ItemizedAsset {
  kind: 'itemized';
  assetClass: string;
  label: string;
  liquidity: Liquidity;
  basis?: string;
  items: Array<{
    id: number;
    label: string;
    sublabel?: string;
    maturityDate: string | null;
    /** Raw current value of the item (not weighted). */
    valuePaisa: number;
    included: boolean;
    allocationPct: number;
    otherAllocations: OtherAllocation[];
  }>;
  /** Allocation-weighted sum of included items in this class. */
  includedSumPaisa: number;
}

type AssetRow = AggregateAsset | ItemizedAsset;

interface Params {
  params: Promise<{ id: string }>;
}

interface InclusionLookup {
  included: boolean;
  allocationPct: number;
  otherAllocations: OtherAllocation[];
}

/**
 * Returns the lookup record for a (goal, class, source) pair given the
 * full set of inclusion rows for the user. `otherAllocations` lists
 * rows on the SAME (asset_class, source_id) that belong to a different
 * goal AND are currently included.
 */
function buildLookup(
  allRows: Array<{
    goalId: number | null;
    assetClass: string;
    sourceId: number | null;
    included: boolean;
    allocationPct: number;
  }>,
  goalNames: Map<number, string>,
  thisGoalId: number,
  assetClass: string,
  sourceId: number | null,
): InclusionLookup {
  const sameAsset = allRows.filter(
    (r) => r.assetClass === assetClass && (r.sourceId ?? null) === sourceId,
  );
  const thisRow = sameAsset.find((r) => r.goalId === thisGoalId);
  const otherAllocations: OtherAllocation[] = sameAsset
    .filter(
      (r) =>
        r.goalId !== null &&
        r.goalId !== thisGoalId &&
        r.included,
    )
    .map((r) => ({
      goalId: r.goalId as number,
      goalName: goalNames.get(r.goalId as number) ?? `Goal #${r.goalId}`,
      allocationPct: r.allocationPct,
    }));
  return {
    included: thisRow ? !!thisRow.included : false,
    allocationPct: thisRow ? thisRow.allocationPct : 100,
    otherAllocations,
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

    // Confirm goal belongs to user before we leak asset state
    const goalRows = await db
      .select()
      .from(financialGoals)
      .where(
        and(
          eq(financialGoals.id, numericId),
          eq(financialGoals.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!goalRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [stocks, mfs, gold, nps, pf, ss, chits, ins, fds, allInclusions, allGoals] =
      await Promise.all([
        db.select().from(holdings).where(eq(holdings.userId, session.user.id)),
        db.select().from(mutualFunds).where(eq(mutualFunds.userId, session.user.id)),
        db.select().from(goldHoldings).where(eq(goldHoldings.userId, session.user.id)),
        db.select().from(npsAccounts).where(eq(npsAccounts.userId, session.user.id)),
        db.select().from(epfAccounts).where(eq(epfAccounts.userId, session.user.id)),
        db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, session.user.id)),
        db.select().from(chitFunds).where(eq(chitFunds.userId, session.user.id)),
        db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, session.user.id)),
        db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, session.user.id)),
        // ALL of the user's inclusion rows (not just this goal's). Needed
        // to compute otherAllocations[] and per-row defaults.
        db
          .select()
          .from(savingsAssetInclusion)
          .where(eq(savingsAssetInclusion.userId, session.user.id)),
        db
          .select({ id: financialGoals.id, name: financialGoals.name })
          .from(financialGoals)
          .where(eq(financialGoals.userId, session.user.id)),
      ]);

    const goalNames = new Map<number, string>();
    for (const g of allGoals) goalNames.set(g.id, g.name);

    const allRows = allInclusions.map((r) => ({
      goalId: r.goalId ?? null,
      assetClass: r.assetClass,
      sourceId: r.sourceId ?? null,
      included: r.included,
      allocationPct: r.allocationPct ?? 100,
    }));

    const lookup = (assetClass: string, sourceId: number | null) =>
      buildLookup(allRows, goalNames, numericId, assetClass, sourceId);

    // ─── aggregate classes ──────────────────────────────────────────
    const stocksTotal = stocks.reduce((s, h) => s + (h.currentValue || 0), 0);
    const mfsTotal = mfs.reduce((s, f) => s + (f.currentValue || 0), 0);
    const npsTotal = nps.reduce((s, n) => s + (n.totalValue || 0), 0);
    const pfTotal = pf.reduce((s, p) => s + (p.totalBalance || 0), 0);

    const stocksLk = lookup('STOCKS', null);
    const mfsLk = lookup('MUTUAL_FUNDS', null);
    const npsLk = lookup('NPS', null);
    const pfLk = lookup('PF', null);

    const aggregateRows: AggregateAsset[] = [
      {
        kind: 'aggregate',
        assetClass: 'STOCKS',
        label: 'Stocks',
        valuePaisa: stocksTotal,
        liquidity: 'liquid',
        included: stocksLk.included,
        allocationPct: stocksLk.allocationPct,
        otherAllocations: stocksLk.otherAllocations,
      },
      {
        kind: 'aggregate',
        assetClass: 'MUTUAL_FUNDS',
        label: 'Mutual Funds',
        valuePaisa: mfsTotal,
        liquidity: 'liquid',
        included: mfsLk.included,
        allocationPct: mfsLk.allocationPct,
        otherAllocations: mfsLk.otherAllocations,
      },
      {
        kind: 'aggregate',
        assetClass: 'NPS',
        label: 'NPS',
        valuePaisa: npsTotal,
        liquidity: 'locked',
        included: npsLk.included,
        allocationPct: npsLk.allocationPct,
        otherAllocations: npsLk.otherAllocations,
        basis: 'Retirement-locked — usually leave off non-retirement goals',
      },
      {
        kind: 'aggregate',
        assetClass: 'PF',
        label: 'Provident Fund',
        valuePaisa: pfTotal,
        liquidity: 'locked',
        included: pfLk.included,
        allocationPct: pfLk.allocationPct,
        otherAllocations: pfLk.otherAllocations,
        basis: 'Retirement-locked',
      },
    ];

    // Helper: allocation-weighted sum of an itemized list's included rows.
    const weightedSum = (items: Array<{ valuePaisa: number; included: boolean; allocationPct: number }>) =>
      items
        .filter((i) => i.included)
        .reduce((s, i) => s + Math.round((i.valuePaisa * i.allocationPct) / 100), 0);

    // ─── itemized: chit funds ───────────────────────────────────────
    const chitItems = chits
      .filter((c) => c.status === 'ACTIVE')
      .sort((a, b) => (a.expectedEndDate ?? '').localeCompare(b.expectedEndDate ?? ''))
      .map((c) => {
        const lk = lookup('CHIT_FUNDS', c.id);
        return {
          id: c.id,
          label: c.schemeName,
          sublabel: `${c.foremanName} · ${c.foremanCommissionPct ?? 5}% foreman`,
          maturityDate: c.expectedEndDate ?? null,
          valuePaisa: Math.round(
            c.chitValue * (1 - (c.foremanCommissionPct ?? 5) / 100),
          ),
          included: lk.included,
          allocationPct: lk.allocationPct,
          otherAllocations: lk.otherAllocations,
        };
      });
    const chitRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'CHIT_FUNDS',
      label: 'Chit Funds',
      liquidity: 'semi-liquid',
      basis: 'Projected at chit maturity (chit value − foreman fee)',
      items: chitItems,
      includedSumPaisa: weightedSum(chitItems),
    };

    // ─── itemized: insurance policies ───────────────────────────────
    const policyItems = ins
      .filter(
        (p) => p.status === 'ACTIVE' && MATURING_POLICY_TYPES.includes(p.policyType),
      )
      .map((p) => ({
        id: p.id,
        label: `${p.insurer} ${p.policyType.replace('_', ' ').toLowerCase()}`,
        sublabel: `Policy ${p.policyNumber}`,
        maturityDate: p.maturityDate ?? null,
        valuePaisa:
          p.maturityBenefit && p.maturityBenefit > 0
            ? p.maturityBenefit
            : p.sumAssured || 0,
      }))
      .filter((p) => p.valuePaisa > 0)
      .sort((a, b) => (a.maturityDate ?? '9999').localeCompare(b.maturityDate ?? '9999'))
      .map((p) => {
        const lk = lookup('INSURANCE_POLICIES', p.id);
        return {
          ...p,
          included: lk.included,
          allocationPct: lk.allocationPct,
          otherAllocations: lk.otherAllocations,
        };
      });
    const policyRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'INSURANCE_POLICIES',
      label: 'Insurance Policies',
      liquidity: 'semi-liquid',
      basis: 'Projected at each policy maturity date (maturity benefit, ACTIVE only)',
      items: policyItems,
      includedSumPaisa: weightedSum(policyItems),
    };

    // ─── itemized: gold ─────────────────────────────────────────────
    const goldItems = gold
      .filter((g) => (g.currentValue || 0) > 0)
      .sort((a, b) => (a.sgbMaturityDate ?? 'zzz').localeCompare(b.sgbMaturityDate ?? 'zzz'))
      .map((g) => {
        const detail =
          g.type === 'GOLD_BOND' && g.sgbSeries
            ? `SGB · ${g.sgbSeries}`
            : `${g.type}${g.grams ? ` · ${g.grams}g` : ''}${g.purity ? ` · ${g.purity}` : ''}`;
        const lk = lookup('GOLD', g.id);
        return {
          id: g.id,
          label: g.name ?? `Gold ${g.type}`,
          sublabel: detail,
          maturityDate: g.sgbMaturityDate ?? null,
          valuePaisa: g.currentValue || 0,
          included: lk.included,
          allocationPct: lk.allocationPct,
          otherAllocations: lk.otherAllocations,
        };
      });
    const goldRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'GOLD',
      label: 'Gold',
      liquidity: 'semi-liquid',
      basis: 'Live current value (SGBs show maturity; physical/ETF mark-to-market)',
      items: goldItems,
      includedSumPaisa: weightedSum(goldItems),
    };

    // ─── itemized: fixed deposits ───────────────────────────────────
    const fdItems = fds
      .filter((f) => f.status === 'ACTIVE')
      .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
      .map((f) => {
        const lk = lookup('FIXED_DEPOSITS', f.id);
        return {
          id: f.id,
          label: f.bankName,
          sublabel: [
            f.accountNumber || null,
            `${f.interestRate.toFixed(2)}%`,
            f.isTaxSaver ? '80C' : null,
          ].filter(Boolean).join(' · '),
          maturityDate: f.maturityDate,
          valuePaisa: f.maturityAmountPaisa ?? f.principalPaisa,
          included: lk.included,
          allocationPct: lk.allocationPct,
          otherAllocations: lk.otherAllocations,
        };
      });
    const fdRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'FIXED_DEPOSITS',
      label: 'Fixed Deposits',
      liquidity: 'semi-liquid',
      basis: 'Projected at each FD maturity date (principal + accrued interest)',
      items: fdItems,
      includedSumPaisa: weightedSum(fdItems),
    };

    // ─── itemized: small savings ────────────────────────────────────
    const ssItems = ss
      .filter((a) => a.status === 'ACTIVE' || a.status === 'EXTENDED')
      .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
      .map((a) => {
        const lk = lookup('SMALL_SAVINGS', a.id);
        return {
          id: a.id,
          label: `${a.schemeType} · ${a.holderName}`,
          sublabel: [a.accountNumber, `${a.interestRatePercent.toFixed(2)}%`]
            .filter(Boolean)
            .join(' · '),
          maturityDate: a.maturityDate,
          valuePaisa: a.currentBalancePaisa || 0,
          included: lk.included,
          allocationPct: lk.allocationPct,
          otherAllocations: lk.otherAllocations,
        };
      });
    const ssRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'SMALL_SAVINGS',
      label: 'Small Savings',
      liquidity: 'locked',
      basis: 'Current balance (PPF/VPF/NSC/KVP/SSY/SCSS)',
      items: ssItems,
      includedSumPaisa: weightedSum(ssItems),
    };

    const rows: AssetRow[] = [
      aggregateRows[0], // Stocks
      aggregateRows[1], // MFs
      fdRow,
      chitRow,
      goldRow,
      aggregateRows[2], // NPS
      aggregateRows[3], // PF
      ssRow,
      policyRow,
    ];

    // Aggregate weighted total: aggregates use their own allocationPct,
    // itemized rows already pre-weight via includedSumPaisa.
    const aggregateWeighted = aggregateRows
      .filter((a) => a.included)
      .reduce(
        (s, a) => s + Math.round((a.valuePaisa * a.allocationPct) / 100),
        0,
      );
    const includedTotalPaisa =
      aggregateWeighted +
      fdRow.includedSumPaisa +
      chitRow.includedSumPaisa +
      goldRow.includedSumPaisa +
      ssRow.includedSumPaisa +
      policyRow.includedSumPaisa;

    return NextResponse.json({ classes: rows, includedTotalPaisa });
  } catch (err) {
    console.error('[goals/:id/assets GET]', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
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

    // Confirm goal belongs to user
    const goalRows = await db
      .select({ id: financialGoals.id })
      .from(financialGoals)
      .where(
        and(
          eq(financialGoals.id, numericId),
          eq(financialGoals.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!goalRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const { assetClass, included, sourceId } = body;
    if (typeof assetClass !== 'string' || typeof included !== 'boolean') {
      return NextResponse.json(
        { error: 'assetClass (string) and included (boolean) required' },
        { status: 400 },
      );
    }
    const sourceIdVal: number | null = typeof sourceId === 'number' ? sourceId : null;

    // Validate allocationPct shape (when provided)
    let requestedPct: number | undefined;
    if (body.allocationPct !== undefined && body.allocationPct !== null) {
      if (typeof body.allocationPct !== 'number' || !Number.isFinite(body.allocationPct)) {
        return NextResponse.json(
          { error: 'allocationPct must be a number' },
          { status: 400 },
        );
      }
      if (body.allocationPct < 0 || body.allocationPct > 100) {
        return NextResponse.json(
          { error: 'allocationPct must be between 0 and 100' },
          { status: 400 },
        );
      }
      requestedPct = body.allocationPct;
    }

    // Atomic: validate cross-row allocation BEFORE the write.
    const result = await db.transaction(async (tx) => {
      // Load OTHER goals' allocations on this same (user, asset_class, source_id).
      const otherRows = await tx
        .select({
          goalId: savingsAssetInclusion.goalId,
          included: savingsAssetInclusion.included,
          allocationPct: savingsAssetInclusion.allocationPct,
        })
        .from(savingsAssetInclusion)
        .where(
          and(
            eq(savingsAssetInclusion.userId, session.user.id),
            eq(savingsAssetInclusion.assetClass, assetClass),
            sourceIdVal === null
              ? isNull(savingsAssetInclusion.sourceId)
              : eq(savingsAssetInclusion.sourceId, sourceIdVal),
            // Exclude this goal's own row (so we can recompute it cleanly)
            ne(savingsAssetInclusion.goalId, numericId),
          ),
        );

      // Sum of other goals' active allocations
      const otherSum = otherRows
        .filter((r) => r.included)
        .reduce((s, r) => s + (r.allocationPct ?? 100), 0);

      // Determine final pct for this row
      let finalPct: number;
      if (!included) {
        // Toggling off — preserve any previous pct but don't validate
        // (it won't contribute to the sum anymore).
        finalPct = requestedPct ?? 100;
      } else if (requestedPct !== undefined) {
        finalPct = requestedPct;
      } else {
        // Default: take whatever's left, fall back to 100 if no room.
        const remainder = 100 - otherSum;
        finalPct = remainder > 0 ? remainder : 100;
      }

      // Cross-row validation (only when included=true)
      if (included && otherSum + finalPct > 100 + 0.001) {
        // Build a friendly error naming the other goals
        const otherGoalIds = otherRows
          .filter((r) => r.included)
          .map((r) => r.goalId)
          .filter((g): g is number => g !== null);
        const otherGoals = otherGoalIds.length
          ? await tx
              .select({ id: financialGoals.id, name: financialGoals.name })
              .from(financialGoals)
              .where(eq(financialGoals.userId, session.user.id))
          : [];
        const nameMap = new Map(otherGoals.map((g) => [g.id, g.name]));
        const names = otherRows
          .filter((r) => r.included && r.goalId !== null)
          .map((r) =>
            `${nameMap.get(r.goalId as number) ?? `Goal #${r.goalId}`} (${r.allocationPct ?? 100}%)`,
          );
        return {
          conflict: true as const,
          message: `Cannot allocate ${finalPct}% — ${otherSum}% is already allocated across ${names.join(', ')}`,
        };
      }

      // Upsert against (goal_id, asset_class, source_id)
      const existing = await tx
        .select()
        .from(savingsAssetInclusion)
        .where(
          and(
            eq(savingsAssetInclusion.assetClass, assetClass),
            sourceIdVal === null
              ? isNull(savingsAssetInclusion.sourceId)
              : eq(savingsAssetInclusion.sourceId, sourceIdVal),
            eq(savingsAssetInclusion.goalId, numericId),
            eq(savingsAssetInclusion.userId, session.user.id),
          ),
        )
        .limit(1);

      if (existing.length) {
        await tx
          .update(savingsAssetInclusion)
          .set({
            included,
            allocationPct: finalPct,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(savingsAssetInclusion.id, existing[0].id),
              eq(savingsAssetInclusion.userId, session.user.id),
            ),
          );
      } else {
        await tx.insert(savingsAssetInclusion).values({
          userId: session.user.id,
          assetClass,
          sourceId: sourceIdVal,
          goalId: numericId,
          included,
          allocationPct: finalPct,
        });
      }

      return { conflict: false as const, allocationPct: finalPct };
    });

    if (result.conflict) {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }
    return NextResponse.json({ ok: true, allocationPct: result.allocationPct });
  } catch (err) {
    console.error('[goals/:id/assets PATCH]', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
