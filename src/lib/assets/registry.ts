/**
 * Asset-class registry — the single declarative list of every net-worth
 * asset class + how to fetch and value it. Adding an asset class is one
 * entry here instead of editing the net-worth snapshot's hardcoded selects
 * (and, going forward, the projection consumers).
 *
 * Each descriptor owns its own DB fetch + valuation rule. `computeNetWorth`
 * iterates the registry so callers never re-list the tables.
 *
 * Money is paisa throughout. Liabilities carry `isLiability` and are
 * subtracted from the asset total.
 */

import { eq } from 'drizzle-orm';
import {
  db,
  holdings,
  mutualFunds,
  goldHoldings,
  npsAccounts,
  epfAccounts,
  smallSavingsAccounts,
  realEstate,
  insurancePolicies,
  liabilities,
  chitFunds,
  fixedDeposits,
} from '@/db';

/** Insurance policy types whose investment/cash value counts toward net worth. */
const CASH_VALUE_POLICIES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export interface AssetClass {
  /** Stable key. */
  key: string;
  /** Display label (also the net-worth snapshot row name). */
  label: string;
  /** Symbol used in the price_snapshots row. */
  snapshotSymbol: string;
  /** True for debt — subtracted from assets. */
  isLiability?: boolean;
  /** Fetch this class's rows for a user. */
  fetch: (userId: string) => Promise<unknown[]>;
  /** Sum the class's current value (paisa) from its rows. */
  valuePaisa: (rows: unknown[]) => number;
}

/** Type-preserving descriptor builder — keeps fetch/valuePaisa row types
 *  aligned per entry while erasing to the common `AssetClass` for the list. */
function defineAssetClass<T>(c: {
  key: string;
  label: string;
  snapshotSymbol: string;
  isLiability?: boolean;
  fetch: (userId: string) => Promise<T[]>;
  valuePaisa: (rows: T[]) => number;
}): AssetClass {
  return c as unknown as AssetClass;
}

const sum = <T>(rows: T[], pick: (r: T) => number | null | undefined): number =>
  rows.reduce((s, r) => s + (pick(r) ?? 0), 0);

/** Order mirrors the original net-worth snapshot rows for stable output. */
export const ASSET_CLASSES: AssetClass[] = [
  defineAssetClass({
    key: 'stocks',
    label: 'Stocks',
    snapshotSymbol: 'STOCKS_TOTAL',
    fetch: (u) => db.select().from(holdings).where(eq(holdings.userId, u)),
    valuePaisa: (rows) => sum(rows, (h) => h.currentValue),
  }),
  defineAssetClass({
    key: 'mutualFunds',
    label: 'Mutual Funds',
    snapshotSymbol: 'MF_TOTAL',
    fetch: (u) => db.select().from(mutualFunds).where(eq(mutualFunds.userId, u)),
    valuePaisa: (rows) => sum(rows, (f) => f.currentValue),
  }),
  defineAssetClass({
    key: 'gold',
    label: 'Gold',
    snapshotSymbol: 'GOLD_TOTAL',
    fetch: (u) => db.select().from(goldHoldings).where(eq(goldHoldings.userId, u)),
    valuePaisa: (rows) => sum(rows, (g) => g.currentValue),
  }),
  defineAssetClass({
    key: 'nps',
    label: 'NPS',
    snapshotSymbol: 'NPS_TOTAL',
    fetch: (u) => db.select().from(npsAccounts).where(eq(npsAccounts.userId, u)),
    valuePaisa: (rows) => sum(rows, (n) => n.totalValue),
  }),
  defineAssetClass({
    key: 'pf',
    label: 'Provident Fund (EPF)',
    snapshotSymbol: 'PF_TOTAL',
    fetch: (u) => db.select().from(epfAccounts).where(eq(epfAccounts.userId, u)),
    valuePaisa: (rows) => sum(rows, (p) => p.totalBalance),
  }),
  defineAssetClass({
    key: 'smallSavings',
    label: 'Small Savings',
    snapshotSymbol: 'SS_TOTAL',
    fetch: (u) => db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, u)),
    valuePaisa: (rows) => sum(rows, (a) => a.currentBalancePaisa),
  }),
  defineAssetClass({
    key: 'realEstate',
    label: 'Real Estate',
    snapshotSymbol: 'RE_TOTAL',
    fetch: (u) => db.select().from(realEstate).where(eq(realEstate.userId, u)),
    valuePaisa: (rows) => sum(rows, (r) => r.currentValuation),
  }),
  defineAssetClass({
    key: 'insurance',
    label: 'Insurance (cash)',
    snapshotSymbol: 'INS_TOTAL',
    fetch: (u) => db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, u)),
    // Only cash-value policy types count toward net worth.
    valuePaisa: (rows) =>
      sum(
        rows.filter((p) => CASH_VALUE_POLICIES.includes(p.policyType)),
        (p) => p.investmentValue,
      ),
  }),
  defineAssetClass({
    key: 'chitFunds',
    label: 'Chit Funds',
    snapshotSymbol: 'CHIT_TOTAL',
    fetch: (u) => db.select().from(chitFunds).where(eq(chitFunds.userId, u)),
    // netContribution across all chits (incl WON — dividend value counts).
    valuePaisa: (rows) => sum(rows, (c) => c.netContribution),
  }),
  defineAssetClass({
    key: 'fixedDeposits',
    label: 'Fixed Deposits',
    snapshotSymbol: 'FD_TOTAL',
    fetch: (u) => db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, u)),
    // Principal of ACTIVE FDs only (accrued interest booked in projections).
    valuePaisa: (rows) =>
      sum(
        rows.filter((f) => f.status === 'ACTIVE'),
        (f) => f.principalPaisa,
      ),
  }),
  defineAssetClass({
    key: 'liabilities',
    label: 'Liabilities',
    snapshotSymbol: 'LIA_TOTAL',
    isLiability: true,
    fetch: (u) => db.select().from(liabilities).where(eq(liabilities.userId, u)),
    valuePaisa: (rows) => sum(rows, (d) => d.currentBalance),
  }),
];

/** Keyed view of the registry for callers that want one specific class
 *  (e.g. a projection consumer sourcing just its aggregate current-value
 *  legs) without re-listing the table + reduction. Built once at module
 *  load from the canonical `ASSET_CLASSES` array so it can never drift. */
export const ASSET_CLASS_BY_KEY: Record<string, AssetClass> = Object.fromEntries(
  ASSET_CLASSES.map((ac) => [ac.key, ac]),
);

/**
 * Current-value (paisa) for a single asset class, sourced from the SAME
 * fetch + `valuePaisa` rule the net-worth snapshot uses. This is the one
 * place "what does this asset class total today" is defined; projection
 * consumers that need an aggregate current-value leg read it from here
 * instead of re-declaring the `db.select().from(X)` + reduction.
 *
 * Only use this where the consumer's notion of "current value" is exactly
 * the net-worth one. Consumers that value an asset differently for a
 * projection (per-item maturity payouts, mode-dependent sale prices, etc.)
 * must keep their own computation — see the projection routes.
 */
export async function assetClassCurrentValuePaisa(
  key: string,
  userId: string,
): Promise<number> {
  const ac = ASSET_CLASS_BY_KEY[key];
  if (!ac) throw new Error(`Unknown asset class key: ${key}`);
  const rows = await ac.fetch(userId);
  return ac.valuePaisa(rows);
}

export interface AssetClassValue {
  key: string;
  label: string;
  snapshotSymbol: string;
  isLiability: boolean;
  valuePaisa: number;
}

export interface NetWorthResult {
  breakdown: AssetClassValue[];
  totalAssetsPaisa: number;
  liabilitiesPaisa: number;
  netWorthPaisa: number;
}

/** Compute the full net-worth breakdown for a user by iterating the registry. */
export async function computeNetWorth(userId: string): Promise<NetWorthResult> {
  const breakdown = await Promise.all(
    ASSET_CLASSES.map(async (ac): Promise<AssetClassValue> => {
      const rows = await ac.fetch(userId);
      return {
        key: ac.key,
        label: ac.label,
        snapshotSymbol: ac.snapshotSymbol,
        isLiability: !!ac.isLiability,
        valuePaisa: ac.valuePaisa(rows),
      };
    }),
  );
  const totalAssetsPaisa = breakdown
    .filter((b) => !b.isLiability)
    .reduce((s, b) => s + b.valuePaisa, 0);
  const liabilitiesPaisa = breakdown
    .filter((b) => b.isLiability)
    .reduce((s, b) => s + b.valuePaisa, 0);
  return {
    breakdown,
    totalAssetsPaisa,
    liabilitiesPaisa,
    netWorthPaisa: totalAssetsPaisa - liabilitiesPaisa,
  };
}
