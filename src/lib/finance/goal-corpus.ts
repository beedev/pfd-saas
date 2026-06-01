/**
 * Goal Corpus & Contribution Helpers — Sprint 3.5 Phase 3.
 *
 * Walks the savings_asset_inclusion table for a given user and sums
 * up which assets each goal owns. Shared by:
 *   • /api/finance/goals             — list page funded% column
 *   • /api/finance/goals/[id]        — detail page asset mapping
 *   • /api/finance/goals/[id]/projection — engine seed values
 *
 * Pure read layer — no writes. All amounts in PAISA.
 */

import { and, eq } from 'drizzle-orm';
import {
  db,
  savingsAssetInclusion,
  holdings,
  mutualFunds,
  sips,
  goldHoldings,
  fixedDeposits,
  smallSavingsAccounts,
  chitFunds,
  insurancePolicies,
  npsAccounts,
  providentFund,
  assetClassReturns,
} from '@/db';

export interface CorpusContext {
  inclusions: Array<{
    assetClass: string;
    sourceId: number | null;
    included: boolean;
    goalId: number | null;
    /** 0–100 — fraction of this asset's value that flows to this goal.
     *  Defaults to 100 when no allocation has been set explicitly. */
    allocationPct: number;
  }>;
  holdingsTotal: number;
  mfTotal: number;
  npsTotal: number;
  pfTotal: number;
  /** Itemized classes carry their assumed growth rate per row so the
   *  weighted average for the goal reflects each instrument's actual
   *  yield (FD rate, small-savings scheme rate, chit XIRR, …). */
  golds: Array<{ id: number; value: number; returnPct: number }>;
  fds: Array<{ id: number; value: number; returnPct: number }>;
  ssas: Array<{ id: number; value: number; returnPct: number }>;
  chits: Array<{ id: number; value: number; returnPct: number }>;
  policies: Array<{ id: number; value: number; returnPct: number }>;
  /** Total annual SIP outflow across all ACTIVE SIPs (paisa). */
  mfSipYearly: number;
  /** Per-MF-id yearly SIP paisa. */
  sipPerMfId: Map<number, number>;
  mfIdSet: Set<number>;
  /** User-editable class-level return rate overrides loaded from the
   *  asset_class_returns table. Keys are asset class names; values are
   *  the user's chosen percentages. Falls back to
   *  DEFAULT_RETURN_PCT_BY_CLASS when a class isn't in the table. */
  classReturnOverrides: Record<string, number>;
  /** Per-class flag: when true, instrument rates (FD interest_rate,
   *  Small Savings interest_rate_percent, Chit xirr) take precedence
   *  over the class rate. When false, the class rate applies to ALL
   *  instruments in the class. Same key shape as classReturnOverrides. */
  useInstrumentRate: Record<string, boolean>;
}

/**
 * Default expected annual returns per asset class. These mirror the
 * three-bucket cascade rates the retirement page uses (liquid 6 / stable
 * 8 / growth 11) but at asset-class granularity.
 *
 * The constant below is the COMPILE-TIME fallback. The persisted source
 * of truth lives in the `asset_class_returns` table (per-user), editable
 * via /settings → "Asset growth assumptions". loadCorpusContext() reads
 * the table and overrides this constant in the returned context.
 *
 * Itemized classes (FDs, Small Savings, Chits) further override the
 * class-level default with the actual instrument-level rate where
 * available — e.g. a 7.7% NSC overrides the SMALL_SAVINGS class rate.
 */
export const DEFAULT_RETURN_PCT_BY_CLASS: Record<string, number> = {
  STOCKS: 12,
  MUTUAL_FUNDS: 11,
  GOLD: 9,
  NPS: 9.5,
  PF: 8.25,
  SMALL_SAVINGS: 7.5,
  FIXED_DEPOSITS: 7,
  CHIT_FUNDS: 6,
  REAL_ESTATE: 6,
  INSURANCE_POLICIES: 5,
};

export function defaultReturnPct(
  assetClass: string,
  overrides?: Record<string, number>,
): number {
  if (overrides && assetClass in overrides) return overrides[assetClass];
  return DEFAULT_RETURN_PCT_BY_CLASS[assetClass] ?? 8;
}

/** Loads all balances + inclusion rows for the user in parallel. */
export async function loadCorpusContext(userId: string): Promise<CorpusContext> {
  const [stocks, mfs, sipRows, nps, pf, gold, fds, ssas, chits, ins, inclusions, returnOverrides] =
    await Promise.all([
      db.select().from(holdings).where(eq(holdings.userId, userId)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)),
      db.select().from(sips).where(and(eq(sips.userId, userId), eq(sips.status, 'ACTIVE'))),
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
      db.select().from(providentFund).where(eq(providentFund.userId, userId)),
      db.select().from(goldHoldings).where(eq(goldHoldings.userId, userId)),
      db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, userId)),
      db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, userId)),
      db.select().from(chitFunds).where(eq(chitFunds.userId, userId)),
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
      db.select().from(savingsAssetInclusion).where(eq(savingsAssetInclusion.userId, userId)),
      db.select().from(assetClassReturns).where(eq(assetClassReturns.userId, userId)),
    ]);

  // User's per-class rate overrides from the asset_class_returns table.
  // Maps {STOCKS: 12, MUTUAL_FUNDS: 11, ...}.
  const classReturnOverrides: Record<string, number> = {};
  const useInstrumentRate: Record<string, boolean> = {};
  for (const r of returnOverrides) {
    classReturnOverrides[r.assetClass] = r.returnPct;
    useInstrumentRate[r.assetClass] = r.useInstrumentRate;
  }

  const sipPerMfId = new Map<number, number>();
  let mfSipYearly = 0;
  for (const s of sipRows) {
    // Annualised SIP. MONTHLY is the dominant case (×12); other freqs
    // approximate to the same — close enough for goal projection.
    const yearly = (s.monthlyAmount ?? 0) * 12;
    mfSipYearly += yearly;
    sipPerMfId.set(
      s.mutualFundId,
      (sipPerMfId.get(s.mutualFundId) ?? 0) + yearly,
    );
  }

  return {
    inclusions: inclusions.map((r) => ({
      assetClass: r.assetClass,
      sourceId: r.sourceId ?? null,
      included: r.included,
      goalId: r.goalId ?? null,
      allocationPct: r.allocationPct ?? 100,
    })),
    holdingsTotal: stocks.reduce((s, h) => s + (h.currentValue || 0), 0),
    mfTotal: mfs.reduce((s, f) => s + (f.currentValue || 0), 0),
    npsTotal: nps.reduce((s, n) => s + (n.totalValue || 0), 0),
    pfTotal: pf.reduce((s, p) => s + (p.totalBalance || 0), 0),
    // Itemized rows include each instrument's own assumed return rate
    // where the underlying table exposes it AND the class is set to
    // honor per-instrument rates. The user toggles this per class in
    // /settings. Precedence (top wins):
    //   1. Instrument-level rate — only if useInstrumentRate[class] AND
    //      the instrument actually has a non-zero rate set
    //   2. User class override   (from asset_class_returns)
    //   3. Compile-time default  (DEFAULT_RETURN_PCT_BY_CLASS)
    golds: gold.map((g) => ({
      id: g.id,
      value: g.currentValue ?? 0,
      returnPct: defaultReturnPct('GOLD', classReturnOverrides), // gold has no per-item rate concept
    })),
    fds: fds.map((f) => ({
      id: f.id,
      value: f.maturityAmountPaisa ?? f.principalPaisa,
      returnPct: useInstrumentRate['FIXED_DEPOSITS'] && f.interestRate && f.interestRate > 0
        ? f.interestRate
        : defaultReturnPct('FIXED_DEPOSITS', classReturnOverrides),
    })),
    ssas: ssas.map((a) => ({
      id: a.id,
      value: a.currentBalancePaisa ?? 0,
      returnPct: useInstrumentRate['SMALL_SAVINGS'] && a.interestRatePercent && a.interestRatePercent > 0
        ? a.interestRatePercent
        : defaultReturnPct('SMALL_SAVINGS', classReturnOverrides),
    })),
    chits: chits.map((c) => ({
      id: c.id,
      value: Math.round(
        c.chitValue * (1 - (c.foremanCommissionPct ?? 5) / 100),
      ),
      returnPct: useInstrumentRate['CHIT_FUNDS'] && c.xirr && c.xirr > 0
        ? c.xirr
        : defaultReturnPct('CHIT_FUNDS', classReturnOverrides),
    })),
    policies: ins.map((p) => ({
      id: p.id,
      value:
        p.maturityBenefit && p.maturityBenefit > 0
          ? p.maturityBenefit
          : p.sumAssured || 0,
      returnPct: defaultReturnPct('INSURANCE_POLICIES', classReturnOverrides),
    })),
    mfSipYearly,
    sipPerMfId,
    mfIdSet: new Set(mfs.map((m) => m.id)),
    classReturnOverrides,
    useInstrumentRate,
  };
}

/**
 * Sum of asset values currently mapped (included=true) to the given
 * goal. Per-class semantics:
 *   STOCKS/MUTUAL_FUNDS/NPS/PF → aggregate (sourceId NULL counts all)
 *   GOLD/FIXED_DEPOSITS/SMALL_SAVINGS/CHIT_FUNDS/INSURANCE_POLICIES → per-item
 *
 * Each contribution is weighted by the inclusion row's allocation_pct.
 * E.g. if MFs (₹10L) are 50% to House and 50% to Education, each goal
 * sees ₹5L from MFs. allocationPct defaults to 100 for legacy rows.
 */
export function corpusForGoal(ctx: CorpusContext, goalId: number): number {
  const incs = ctx.inclusions.filter((r) => r.goalId === goalId && r.included);

  let total = 0;
  for (const r of incs) {
    const weight = (r.allocationPct ?? 100) / 100;
    switch (r.assetClass) {
      case 'STOCKS':
        if (r.sourceId === null) total += ctx.holdingsTotal * weight;
        break;
      case 'MUTUAL_FUNDS':
        if (r.sourceId === null) total += ctx.mfTotal * weight;
        break;
      case 'NPS':
        if (r.sourceId === null) total += ctx.npsTotal * weight;
        break;
      case 'PF':
        if (r.sourceId === null) total += ctx.pfTotal * weight;
        break;
      case 'GOLD':
        total += (ctx.golds.find((x) => x.id === r.sourceId)?.value ?? 0) * weight;
        break;
      case 'FIXED_DEPOSITS':
        total += (ctx.fds.find((x) => x.id === r.sourceId)?.value ?? 0) * weight;
        break;
      case 'SMALL_SAVINGS':
        total += (ctx.ssas.find((x) => x.id === r.sourceId)?.value ?? 0) * weight;
        break;
      case 'CHIT_FUNDS':
        total += (ctx.chits.find((x) => x.id === r.sourceId)?.value ?? 0) * weight;
        break;
      case 'INSURANCE_POLICIES':
        total += (ctx.policies.find((x) => x.id === r.sourceId)?.value ?? 0) * weight;
        break;
    }
  }
  return Math.round(total);
}

/**
 * Value-weighted expected annual return across all assets mapped to this
 * goal. The retirement page uses bucket-allocation × bucket-return; here
 * we do the same at asset-class granularity:
 *
 *   weightedReturn = Σ (assetValue × allocationPct × classReturn)
 *                  / Σ (assetValue × allocationPct)
 *
 * Itemized classes (FDs, Small Savings, Chits) use the instrument's own
 * rate where set (a 7.7% NSC, an 8.5% FD, a chit fund with computed XIRR).
 * Aggregate classes use the class default.
 *
 * Returns the per-class breakdown too so the UI can surface
 * "Stocks ₹34K @ 12% · MFs ₹52L @ 11% · weighted: 11.0%".
 */
export interface WeightedReturnBreakdown {
  /** Final value-weighted rate (percent, e.g. 11.0). Falls back to a
   *  sensible default (8) when nothing is mapped yet. */
  weightedReturnPct: number;
  /** One row per asset class that contributes mapped value to this goal. */
  bands: Array<{
    label: string;
    valuePaisa: number;
    returnPct: number;
  }>;
}

export function weightedReturnForGoal(
  ctx: CorpusContext,
  goalId: number,
): WeightedReturnBreakdown {
  const incs = ctx.inclusions.filter((r) => r.goalId === goalId && r.included);
  const classBands = new Map<string, { value: number; weightedSum: number }>();

  for (const r of incs) {
    const weight = (r.allocationPct ?? 100) / 100;

    let value = 0;
    let returnPct = defaultReturnPct(r.assetClass, ctx.classReturnOverrides);

    switch (r.assetClass) {
      case 'STOCKS':
        if (r.sourceId === null) value = ctx.holdingsTotal;
        break;
      case 'MUTUAL_FUNDS':
        if (r.sourceId === null) value = ctx.mfTotal;
        break;
      case 'NPS':
        if (r.sourceId === null) value = ctx.npsTotal;
        break;
      case 'PF':
        if (r.sourceId === null) value = ctx.pfTotal;
        break;
      case 'GOLD': {
        const item = ctx.golds.find((x) => x.id === r.sourceId);
        if (item) { value = item.value; returnPct = item.returnPct; }
        break;
      }
      case 'FIXED_DEPOSITS': {
        const item = ctx.fds.find((x) => x.id === r.sourceId);
        if (item) { value = item.value; returnPct = item.returnPct; }
        break;
      }
      case 'SMALL_SAVINGS': {
        const item = ctx.ssas.find((x) => x.id === r.sourceId);
        if (item) { value = item.value; returnPct = item.returnPct; }
        break;
      }
      case 'CHIT_FUNDS': {
        const item = ctx.chits.find((x) => x.id === r.sourceId);
        if (item) { value = item.value; returnPct = item.returnPct; }
        break;
      }
      case 'INSURANCE_POLICIES': {
        const item = ctx.policies.find((x) => x.id === r.sourceId);
        if (item) { value = item.value; returnPct = item.returnPct; }
        break;
      }
    }

    if (value <= 0) continue;
    const weighted = value * weight;
    const prev = classBands.get(r.assetClass) ?? { value: 0, weightedSum: 0 };
    classBands.set(r.assetClass, {
      value: prev.value + weighted,
      weightedSum: prev.weightedSum + weighted * returnPct,
    });
  }

  let totalValue = 0;
  let totalWeighted = 0;
  const bands: WeightedReturnBreakdown['bands'] = [];
  for (const [assetClass, agg] of classBands.entries()) {
    if (agg.value <= 0) continue;
    totalValue += agg.value;
    totalWeighted += agg.weightedSum;
    bands.push({
      label: assetClass,
      valuePaisa: Math.round(agg.value),
      returnPct: agg.weightedSum / agg.value,
    });
  }

  const weightedReturnPct = totalValue > 0 ? totalWeighted / totalValue : 8;
  // Sort bands by value descending so the biggest contributor displays
  // first in the UI breakdown.
  bands.sort((a, b) => b.valuePaisa - a.valuePaisa);
  return { weightedReturnPct, bands };
}

/**
 * Estimated annual contribution into this goal:
 *   • aggregate MUTUAL_FUNDS inclusion → all active SIPs annualised
 *   • per-MF inclusion → that MF's SIP × 12
 *   • plus MONTHLY/YEARLY cashflow events earmarked to this goal
 */
export function yearlyContributionForGoal(
  ctx: CorpusContext,
  goalId: number,
  recurringEvents: Array<{ amountPaisa: number; frequency: string; goalId: number | null }>,
): number {
  const incs = ctx.inclusions.filter((r) => r.goalId === goalId && r.included);
  let total = 0;
  for (const r of incs) {
    if (r.assetClass === 'MUTUAL_FUNDS') {
      const weight = (r.allocationPct ?? 100) / 100;
      if (r.sourceId === null) {
        total += ctx.mfSipYearly * weight;
      } else if (ctx.mfIdSet.has(r.sourceId)) {
        total += (ctx.sipPerMfId.get(r.sourceId) ?? 0) * weight;
      }
    }
  }
  for (const ev of recurringEvents) {
    if (ev.goalId !== goalId) continue;
    if (ev.frequency === 'MONTHLY') total += ev.amountPaisa * 12;
    else if (ev.frequency === 'YEARLY') total += ev.amountPaisa;
  }
  return Math.round(total);
}
