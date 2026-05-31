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
  golds: Array<{ id: number; value: number }>;
  fds: Array<{ id: number; value: number }>;
  ssas: Array<{ id: number; value: number }>;
  chits: Array<{ id: number; value: number }>;
  policies: Array<{ id: number; value: number }>;
  /** Total annual SIP outflow across all ACTIVE SIPs (paisa). */
  mfSipYearly: number;
  /** Per-MF-id yearly SIP paisa. */
  sipPerMfId: Map<number, number>;
  mfIdSet: Set<number>;
}

/** Loads all balances + inclusion rows for the user in parallel. */
export async function loadCorpusContext(userId: string): Promise<CorpusContext> {
  const [stocks, mfs, sipRows, nps, pf, gold, fds, ssas, chits, ins, inclusions] =
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
    ]);

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
    golds: gold.map((g) => ({ id: g.id, value: g.currentValue ?? 0 })),
    fds: fds.map((f) => ({
      id: f.id,
      value: f.maturityAmountPaisa ?? f.principalPaisa,
    })),
    ssas: ssas.map((a) => ({ id: a.id, value: a.currentBalancePaisa ?? 0 })),
    chits: chits.map((c) => ({
      id: c.id,
      value: Math.round(
        c.chitValue * (1 - (c.foremanCommissionPct ?? 5) / 100),
      ),
    })),
    policies: ins.map((p) => ({
      id: p.id,
      value:
        p.maturityBenefit && p.maturityBenefit > 0
          ? p.maturityBenefit
          : p.sumAssured || 0,
    })),
    mfSipYearly,
    sipPerMfId,
    mfIdSet: new Set(mfs.map((m) => m.id)),
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
