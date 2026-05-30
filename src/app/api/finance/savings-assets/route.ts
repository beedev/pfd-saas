/**
 * GET    /api/finance/savings-assets   — asset classes + items, with which
 *                                        are currently counted as savings.
 * PATCH  /api/finance/savings-assets   — body: { assetClass, included, sourceId? }
 *
 * Two flavours of asset class:
 *   - aggregate:  one toggle, one valuePaisa (Stocks / MFs / Gold / NPS / PF).
 *   - itemized:   a list of individual instruments the user picks from,
 *                 each with its own value + maturity date (Chit Funds,
 *                 Insurance policies). Total = sum of ticked items.
 *
 * Itemized classes carry per-item rows in savings_asset_inclusion keyed by
 * (assetClass, sourceId). Aggregate rows have sourceId IS NULL.
 *
 * For coverage we use *projected* numbers on Chit Funds (chit value − foreman
 * fee at maturity) and Insurance (maturity benefit on each policy at its
 * maturity date), not current contribution / cash surrender value. This
 * answers "will my goals be funded?" not "what's the cash today?".
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import {
  db,
  savingsAssetInclusion,
  holdings,
  mutualFunds,
  goldHoldings,
  npsAccounts,
  providentFund,
  chitFunds,
  insurancePolicies,
  fixedDeposits,
} from '@/db';

const MATURING_POLICY_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP', 'MONEY_BACK'];

type Liquidity = 'liquid' | 'semi-liquid' | 'locked';

interface AggregateAsset {
  kind: 'aggregate';
  assetClass: string;
  label: string;
  valuePaisa: number;
  liquidity: Liquidity;
  defaultIncluded: boolean;
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
  defaultIncludedAll: boolean;
}

type AssetRow = AggregateAsset | ItemizedAsset;

/** Lookup helper: returns `included` from the inclusion table for a key. */
function lookupIncluded(
  rows: Array<{ assetClass: string; sourceId: number | null; included: boolean }>,
  assetClass: string,
  sourceId: number | null,
  fallback: boolean,
): boolean {
  const found = rows.find(
    (r) => r.assetClass === assetClass && (r.sourceId ?? null) === sourceId,
  );
  return found ? !!found.included : fallback;
}

export async function GET() {
  try {
    const [stocks, mfs, gold, nps, pf, chits, ins, fds, inclusions] =
      await Promise.all([
        db.select().from(holdings),
        db.select().from(mutualFunds),
        db.select().from(goldHoldings),
        db.select().from(npsAccounts),
        db.select().from(providentFund),
        db.select().from(chitFunds),
        db.select().from(insurancePolicies),
        db.select().from(fixedDeposits),
        db
          .select()
          .from(savingsAssetInclusion)
          .where(isNull(savingsAssetInclusion.goalId)),
      ]);

    const inclusionRows = inclusions.map((r) => ({
      assetClass: r.assetClass,
      sourceId: r.sourceId,
      included: r.included,
    }));

    // ─── aggregate classes (flat, one toggle each) ──────────────────────
    const aggregates: Array<Omit<AggregateAsset, 'included' | 'kind'>> = [
      {
        assetClass: 'STOCKS',
        label: 'Stocks',
        valuePaisa: stocks.reduce((s, h) => s + (h.currentValue || 0), 0),
        liquidity: 'liquid',
        defaultIncluded: true,
      },
      {
        assetClass: 'MUTUAL_FUNDS',
        label: 'Mutual Funds',
        valuePaisa: mfs.reduce((s, f) => s + (f.currentValue || 0), 0),
        liquidity: 'liquid',
        defaultIncluded: true,
      },
      {
        assetClass: 'NPS',
        label: 'NPS',
        valuePaisa: nps.reduce((s, n) => s + (n.totalValue || 0), 0),
        liquidity: 'locked',
        defaultIncluded: false,
      },
      {
        assetClass: 'PF',
        label: 'Provident Fund',
        valuePaisa: pf.reduce((s, p) => s + (p.totalBalance || 0), 0),
        liquidity: 'locked',
        defaultIncluded: false,
      },
    ];

    const aggregateRows: AggregateAsset[] = aggregates.map((a) => ({
      kind: 'aggregate',
      ...a,
      included: lookupIncluded(inclusionRows, a.assetClass, null, a.defaultIncluded),
    }));

    // ─── itemized: chit funds (each ACTIVE chit becomes one item) ───────
    const chitItems = chits
      .filter((c) => c.status === 'ACTIVE')
      .sort((a, b) => (a.expectedEndDate ?? '').localeCompare(b.expectedEndDate ?? ''))
      .map((c) => {
        const matured = Math.round(
          c.chitValue * (1 - (c.foremanCommissionPct ?? 5) / 100),
        );
        return {
          id: c.id,
          label: c.schemeName,
          sublabel: `${c.foremanName} · ${c.foremanCommissionPct ?? 5}% foreman`,
          maturityDate: c.expectedEndDate ?? null,
          valuePaisa: matured,
          included: lookupIncluded(
            inclusionRows,
            'CHIT_FUNDS',
            c.id,
            true, // chits default to included
          ),
        };
      });

    const chitRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'CHIT_FUNDS',
      label: 'Chit Funds',
      liquidity: 'semi-liquid',
      basis: 'Projected at chit maturity (chit value − foreman fee)',
      items: chitItems,
      includedSumPaisa: chitItems
        .filter((i) => i.included)
        .reduce((s, i) => s + i.valuePaisa, 0),
      defaultIncludedAll: true,
    };

    // ─── itemized: insurance policies (endowment-style, ACTIVE) ─────────
    const policyItems = ins
      .filter(
        (p) =>
          p.status === 'ACTIVE' && MATURING_POLICY_TYPES.includes(p.policyType),
      )
      .map((p) => ({
        ...p,
        // Pick the most informative value available: explicit maturity benefit
        // if entered, else fall back to sum assured.
        projectedPaisa:
          p.maturityBenefit && p.maturityBenefit > 0
            ? p.maturityBenefit
            : p.sumAssured || 0,
      }))
      .filter((p) => p.projectedPaisa > 0)
      .sort((a, b) => (a.maturityDate ?? '9999').localeCompare(b.maturityDate ?? '9999'))
      .map((p) => ({
        id: p.id,
        label: `${p.insurer} ${p.policyType.replace('_', ' ').toLowerCase()}`,
        sublabel: `Policy ${p.policyNumber}`,
        maturityDate: p.maturityDate ?? null,
        valuePaisa: p.projectedPaisa,
        included: lookupIncluded(
          inclusionRows,
          'INSURANCE_POLICIES',
          p.id,
          false, // user picks per policy
        ),
      }));

    // ─── itemized: gold holdings (Physical, SGB, ETF, Digital) ──────────
    const goldItems = gold
      .filter((g) => (g.currentValue || 0) > 0)
      .sort((a, b) =>
        (a.sgbMaturityDate ?? 'zzz').localeCompare(b.sgbMaturityDate ?? 'zzz'),
      )
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
          included: lookupIncluded(inclusionRows, 'GOLD', g.id, false),
        };
      });

    const goldRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'GOLD',
      label: 'Gold',
      liquidity: 'semi-liquid',
      basis: 'Live current value (SGBs show maturity; physical/ETF mark-to-market)',
      items: goldItems,
      includedSumPaisa: goldItems
        .filter((i) => i.included)
        .reduce((s, i) => s + i.valuePaisa, 0),
      defaultIncludedAll: false,
    };

    // ─── itemized: fixed deposits (each ACTIVE FD = one item) ───────────
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
        ]
          .filter(Boolean)
          .join(' · '),
        maturityDate: f.maturityDate,
        // Projected maturity (interest at maturity included). Falls back to
        // principal if the maturity field wasn't computed yet for any reason.
        valuePaisa: f.maturityAmountPaisa ?? f.principalPaisa,
        included: lookupIncluded(inclusionRows, 'FIXED_DEPOSITS', f.id, true),
      }));

    const fdRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'FIXED_DEPOSITS',
      label: 'Fixed Deposits',
      liquidity: 'semi-liquid',
      basis: 'Projected at each FD maturity date (principal + accrued interest)',
      items: fdItems,
      includedSumPaisa: fdItems
        .filter((i) => i.included)
        .reduce((s, i) => s + i.valuePaisa, 0),
      defaultIncludedAll: true,
    };

    const policyRow: ItemizedAsset = {
      kind: 'itemized',
      assetClass: 'INSURANCE_POLICIES',
      label: 'Insurance Policies',
      liquidity: 'semi-liquid',
      basis: 'Projected at each policy maturity date (maturity benefit, ACTIVE only)',
      items: policyItems,
      includedSumPaisa: policyItems
        .filter((i) => i.included)
        .reduce((s, i) => s + i.valuePaisa, 0),
      defaultIncludedAll: false,
    };

    const rows: AssetRow[] = [
      aggregateRows[0], // Stocks
      aggregateRows[1], // MFs
      fdRow,
      chitRow,
      goldRow,
      aggregateRows[2], // NPS
      aggregateRows[3], // PF
      policyRow,
    ];

    const includedTotalPaisa =
      aggregateRows
        .filter((a) => a.included)
        .reduce((s, a) => s + a.valuePaisa, 0) +
      fdRow.includedSumPaisa +
      chitRow.includedSumPaisa +
      goldRow.includedSumPaisa +
      policyRow.includedSumPaisa;

    return NextResponse.json({ classes: rows, includedTotalPaisa });
  } catch (err) {
    console.error('GET savings-assets failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetClass, included, sourceId } = body;
    if (typeof assetClass !== 'string' || typeof included !== 'boolean') {
      return NextResponse.json(
        { error: 'assetClass (string) and included (boolean) required' },
        { status: 400 },
      );
    }
    const sourceIdVal: number | null =
      typeof sourceId === 'number' ? sourceId : null;

    // Upsert against (asset_class, source_id, goal_id IS NULL).
    const existing = await db
      .select()
      .from(savingsAssetInclusion)
      .where(
        and(
          eq(savingsAssetInclusion.assetClass, assetClass),
          sourceIdVal === null
            ? isNull(savingsAssetInclusion.sourceId)
            : eq(savingsAssetInclusion.sourceId, sourceIdVal),
          isNull(savingsAssetInclusion.goalId),
        ),
      )
      .limit(1);

    if (existing.length) {
      await db
        .update(savingsAssetInclusion)
        .set({ included, updatedAt: new Date() })
        .where(eq(savingsAssetInclusion.id, existing[0].id));
    } else {
      await db.insert(savingsAssetInclusion).values({
        assetClass,
        sourceId: sourceIdVal,
        included,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH savings-assets failed:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
