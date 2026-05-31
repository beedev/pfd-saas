/**
 * Per-Goal Asset Mapping — same shape as /api/finance/savings-assets
 * but the inclusion state is keyed by (goal_id, asset_class, source_id).
 *
 * GET   → all assets + which ones are mapped to this goal (per-row)
 * PATCH → body: { assetClass, sourceId?, included } — flips the
 *         inclusion bit for one (goal, asset) pair.
 *
 * Default semantics: when no row exists in savings_asset_inclusion for
 * a (goal, asset) pair, included defaults to FALSE. The user has to
 * opt in per-goal — we don't auto-map every asset to every goal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import {
  db,
  savingsAssetInclusion,
  financialGoals,
  holdings,
  mutualFunds,
  goldHoldings,
  npsAccounts,
  providentFund,
  smallSavingsAccounts,
  chitFunds,
  insurancePolicies,
  fixedDeposits,
} from '@/db';
import { auth } from '@/auth';

const MATURING_POLICY_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP', 'MONEY_BACK'];

type Liquidity = 'liquid' | 'semi-liquid' | 'locked';

interface AggregateAsset {
  kind: 'aggregate';
  assetClass: string;
  label: string;
  valuePaisa: number;
  liquidity: Liquidity;
  included: boolean;
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
    valuePaisa: number;
    included: boolean;
  }>;
  includedSumPaisa: number;
}

type AssetRow = AggregateAsset | ItemizedAsset;

interface Params {
  params: Promise<{ id: string }>;
}

/** Returns the `included` flag for a (goal, class, source) pair. */
function lookupIncluded(
  rows: Array<{ assetClass: string; sourceId: number | null; included: boolean }>,
  assetClass: string,
  sourceId: number | null,
): boolean {
  const found = rows.find(
    (r) => r.assetClass === assetClass && (r.sourceId ?? null) === sourceId,
  );
  return found ? !!found.included : false;
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

    const [stocks, mfs, gold, nps, pf, ss, chits, ins, fds, inclusions] =
      await Promise.all([
        db.select().from(holdings).where(eq(holdings.userId, session.user.id)),
        db.select().from(mutualFunds).where(eq(mutualFunds.userId, session.user.id)),
        db.select().from(goldHoldings).where(eq(goldHoldings.userId, session.user.id)),
        db.select().from(npsAccounts).where(eq(npsAccounts.userId, session.user.id)),
        db.select().from(providentFund).where(eq(providentFund.userId, session.user.id)),
        db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, session.user.id)),
        db.select().from(chitFunds).where(eq(chitFunds.userId, session.user.id)),
        db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, session.user.id)),
        db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, session.user.id)),
        db
          .select()
          .from(savingsAssetInclusion)
          .where(
            and(
              eq(savingsAssetInclusion.goalId, numericId),
              eq(savingsAssetInclusion.userId, session.user.id),
            ),
          ),
      ]);

    const inclusionRows = inclusions.map((r) => ({
      assetClass: r.assetClass,
      sourceId: r.sourceId,
      included: r.included,
    }));

    // ─── aggregate classes ──────────────────────────────────────────
    const aggregateRows: AggregateAsset[] = [
      {
        kind: 'aggregate',
        assetClass: 'STOCKS',
        label: 'Stocks',
        valuePaisa: stocks.reduce((s, h) => s + (h.currentValue || 0), 0),
        liquidity: 'liquid',
        included: lookupIncluded(inclusionRows, 'STOCKS', null),
      },
      {
        kind: 'aggregate',
        assetClass: 'MUTUAL_FUNDS',
        label: 'Mutual Funds',
        valuePaisa: mfs.reduce((s, f) => s + (f.currentValue || 0), 0),
        liquidity: 'liquid',
        included: lookupIncluded(inclusionRows, 'MUTUAL_FUNDS', null),
      },
      {
        kind: 'aggregate',
        assetClass: 'NPS',
        label: 'NPS',
        valuePaisa: nps.reduce((s, n) => s + (n.totalValue || 0), 0),
        liquidity: 'locked',
        included: lookupIncluded(inclusionRows, 'NPS', null),
        basis: 'Retirement-locked — usually leave off non-retirement goals',
      },
      {
        kind: 'aggregate',
        assetClass: 'PF',
        label: 'Provident Fund',
        valuePaisa: pf.reduce((s, p) => s + (p.totalBalance || 0), 0),
        liquidity: 'locked',
        included: lookupIncluded(inclusionRows, 'PF', null),
        basis: 'Retirement-locked',
      },
    ];

    // ─── itemized: chit funds ───────────────────────────────────────
    const chitItems = chits
      .filter((c) => c.status === 'ACTIVE')
      .sort((a, b) => (a.expectedEndDate ?? '').localeCompare(b.expectedEndDate ?? ''))
      .map((c) => ({
        id: c.id,
        label: c.schemeName,
        sublabel: `${c.foremanName} · ${c.foremanCommissionPct ?? 5}% foreman`,
        maturityDate: c.expectedEndDate ?? null,
        valuePaisa: Math.round(
          c.chitValue * (1 - (c.foremanCommissionPct ?? 5) / 100),
        ),
        included: lookupIncluded(inclusionRows, 'CHIT_FUNDS', c.id),
      }));
    const chitRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'CHIT_FUNDS',
      label: 'Chit Funds',
      liquidity: 'semi-liquid',
      basis: 'Projected at chit maturity (chit value − foreman fee)',
      items: chitItems,
      includedSumPaisa: chitItems.filter((i) => i.included).reduce((s, i) => s + i.valuePaisa, 0),
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
      .map((p) => ({
        ...p,
        included: lookupIncluded(inclusionRows, 'INSURANCE_POLICIES', p.id),
      }));
    const policyRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'INSURANCE_POLICIES',
      label: 'Insurance Policies',
      liquidity: 'semi-liquid',
      basis: 'Projected at each policy maturity date (maturity benefit, ACTIVE only)',
      items: policyItems,
      includedSumPaisa: policyItems.filter((i) => i.included).reduce((s, i) => s + i.valuePaisa, 0),
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
        return {
          id: g.id,
          label: g.name ?? `Gold ${g.type}`,
          sublabel: detail,
          maturityDate: g.sgbMaturityDate ?? null,
          valuePaisa: g.currentValue || 0,
          included: lookupIncluded(inclusionRows, 'GOLD', g.id),
        };
      });
    const goldRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'GOLD',
      label: 'Gold',
      liquidity: 'semi-liquid',
      basis: 'Live current value (SGBs show maturity; physical/ETF mark-to-market)',
      items: goldItems,
      includedSumPaisa: goldItems.filter((i) => i.included).reduce((s, i) => s + i.valuePaisa, 0),
    };

    // ─── itemized: fixed deposits ───────────────────────────────────
    const fdItems = fds
      .filter((f) => f.status === 'ACTIVE')
      .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
      .map((f) => ({
        id: f.id,
        label: f.bankName,
        sublabel: [
          f.accountNumber || null,
          `${f.interestRate.toFixed(2)}%`,
          f.isTaxSaver ? '80C' : null,
        ].filter(Boolean).join(' · '),
        maturityDate: f.maturityDate,
        valuePaisa: f.maturityAmountPaisa ?? f.principalPaisa,
        included: lookupIncluded(inclusionRows, 'FIXED_DEPOSITS', f.id),
      }));
    const fdRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'FIXED_DEPOSITS',
      label: 'Fixed Deposits',
      liquidity: 'semi-liquid',
      basis: 'Projected at each FD maturity date (principal + accrued interest)',
      items: fdItems,
      includedSumPaisa: fdItems.filter((i) => i.included).reduce((s, i) => s + i.valuePaisa, 0),
    };

    // ─── itemized: small savings ────────────────────────────────────
    const ssItems = ss
      .filter((a) => a.status === 'ACTIVE' || a.status === 'EXTENDED')
      .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
      .map((a) => ({
        id: a.id,
        label: `${a.schemeType} · ${a.holderName}`,
        sublabel: [a.accountNumber, `${a.interestRatePercent.toFixed(2)}%`]
          .filter(Boolean)
          .join(' · '),
        maturityDate: a.maturityDate,
        valuePaisa: a.currentBalancePaisa || 0,
        included: lookupIncluded(inclusionRows, 'SMALL_SAVINGS', a.id),
      }));
    const ssRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'SMALL_SAVINGS',
      label: 'Small Savings',
      liquidity: 'locked',
      basis: 'Current balance (PPF/VPF/NSC/KVP/SSY/SCSS)',
      items: ssItems,
      includedSumPaisa: ssItems.filter((i) => i.included).reduce((s, i) => s + i.valuePaisa, 0),
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

    const includedTotalPaisa =
      aggregateRows.filter((a) => a.included).reduce((s, a) => s + a.valuePaisa, 0) +
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

    // Upsert against (goal_id, asset_class, source_id)
    const existing = await db
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
      await db
        .update(savingsAssetInclusion)
        .set({ included, updatedAt: new Date() })
        .where(
          and(
            eq(savingsAssetInclusion.id, existing[0].id),
            eq(savingsAssetInclusion.userId, session.user.id),
          ),
        );
    } else {
      await db.insert(savingsAssetInclusion).values({
        userId: session.user.id,
        assetClass,
        sourceId: sourceIdVal,
        goalId: numericId,
        included,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[goals/:id/assets PATCH]', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
