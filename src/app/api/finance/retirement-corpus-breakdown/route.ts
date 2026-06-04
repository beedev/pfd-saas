/**
 * GET /api/finance/retirement-corpus-breakdown
 *
 * Per-asset-class breakdown of the user's retirement corpus, matched
 * line-by-line to the "Corpus selected → grows to" KPI tile on
 * /retirement so the two surfaces always reconcile.
 *
 * Source of truth: the tile is computed client-side in
 * `src/app/(dashboard)/retirement/page.tsx` from the asset-picker rows
 * returned by `/api/finance/retirement-assets`. The asset-picker has
 * `retirement_asset_selection.included=true|false` per item; the
 * projection iterates ONLY the corpus-contributing classes:
 *
 *   • NPS               → lumpsum % of (current balance compounded at
 *                         `retirement_assumptions.expected_return_pct`)
 *   • PF                → full balance compounded at 8.25% (hardcoded)
 *   • REAL_ESTATE       → only mode=SELL + included; salePrice override
 *                         wins, else compound at expected rate
 *   • INSURANCE_POLICIES → only pre-retirement maturing endowment/whole-
 *                         life/ULIP/money-back policies with
 *                         annuityAmount=0; payout = maturityBenefit ||
 *                         sumAssured; compounded for the post-maturity
 *                         years using expected_return_pct
 *
 * Classes the top tile does NOT contribute corpus from (STOCKS, MFs,
 * SIPs, SMALL_SAVINGS, GOLD, FOREX, FD, ANNUITY_POLICIES, post-
 * retirement INSURANCE_POLICIES) are intentionally excluded from this
 * endpoint as well — anything else would re-introduce the mismatch
 * between the tile and this card.
 *
 * Per-item selection defaults (read once from retirement_asset_selection;
 * fall back to the same defaults retirement-assets.ts uses):
 *
 *   • NPS / PF                  → default included=true
 *   • REAL_ESTATE               → default included=true; default mode is
 *                                 RENTAL when monthlyRent > 0, else SELL
 *                                 (saas has no retirement_treatment column)
 *   • INSURANCE_POLICIES        → default included=true
 *
 * Auth-gated, user-scoped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  db,
  insurancePolicies,
  npsAccounts,
  providentFund,
  realEstate,
  retirementAssetSelection,
  retirementAssumptions,
  type RetirementAssetSelection,
} from '@/db';
import { auth } from '@/auth';

/** Same set the asset-picker exposes for corpus contribution. */
const MATURING_POLICY_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP', 'MONEY_BACK'];

/** PF compound rate — matches the hardcoded `pfRate=0.0825` the top tile uses. */
const PF_RATE_PCT = 8.25;

interface Component {
  itemName: string;
  todayPaisa: number;
  atRetirementPaisa: number;
  growthRatePct: number;
  balanceComponentPaisa: number;
  contributionComponentPaisa: number;
  monthlyContributionPaisa: number;
}

interface AssetClassBreakdown {
  assetClass: string;
  todayPaisa: number;
  atRetirementPaisa: number;
  growthMultiple: number;
  components: Component[];
}

interface ExcludedFromCorpus {
  realEstate: Array<{
    itemName: string;
    treatment: 'rental_only' | 'self_occupied';
    todayPaisa: number;
    note: string;
  }>;
}

function findSelection(
  rows: RetirementAssetSelection[],
  assetClass: string,
  sourceId: number,
): RetirementAssetSelection | undefined {
  return rows.find((r) => r.assetClass === assetClass && r.sourceId === sourceId);
}

/** Compound a single principal at an annual rate for N years (no contribution leg).
 *  Mirrors the top tile's `Math.pow(1+r, yrs)` exactly — float arithmetic,
 *  no per-item rounding, so the final sum agrees with the browser-side
 *  reduction byte-for-byte. */
function compound(pvPaisa: number, ratePct: number, years: number): number {
  if (years <= 0) return pvPaisa;
  return pvPaisa * Math.pow(1 + ratePct / 100, years);
}

/** Calendar-year difference between two ISO dates, rounded down. Mirrors
 *  the helper of the same name in /retirement/page.tsx. */
function yearsBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  const moDiff = b.getUTCMonth() - a.getUTCMonth();
  if (moDiff < 0 || (moDiff === 0 && b.getUTCDate() < a.getUTCDate())) y -= 1;
  return Math.max(0, y);
}

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const [nps, pf, props, policies, selections, assRows] = await Promise.all([
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
      db.select().from(providentFund).where(eq(providentFund.userId, userId)),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
      db
        .select()
        .from(retirementAssetSelection)
        .where(eq(retirementAssetSelection.userId, userId)),
      db
        .select()
        .from(retirementAssumptions)
        .where(eq(retirementAssumptions.userId, userId))
        .limit(1),
    ]);

    const ass = assRows[0];
    const currentAge = ass?.currentAge ?? 30;
    const targetAge = ass?.targetAge ?? 60;
    const expectedReturnPct = ass?.expectedReturnPct ?? 10;
    const yearsToRetire = Math.max(0, targetAge - currentAge);
    const retirementYear = new Date().getFullYear() + yearsToRetire;
    const todayISO = new Date().toISOString().slice(0, 10);

    const breakdowns: AssetClassBreakdown[] = [];

    /* ─── NPS ─────────────────────────────────────────────────────────
     * Top tile math (page.tsx):
     *   const lumpPct = (it.npsLumpsumPct ?? 60) / 100;
     *   const grown   = compound(it.valuePaisa, expectedReturn, yrs);
     *   cCorpus      += grown * lumpPct;
     * Only the lumpsum portion contributes to corpus; the annuity
     * portion is an income stream, not corpus. */
    {
      const components: Component[] = [];
      for (const a of nps) {
        const sel = findSelection(selections, 'NPS', a.id);
        const included = sel ? !!sel.included : true;
        if (!included) continue;
        const lumpPct = (sel?.npsLumpsumPct ?? 60) / 100;
        const grown = compound(a.totalValue, expectedReturnPct, yearsToRetire);
        // Keep unrounded floats so the final sum matches the browser's
        // float reduction byte-for-byte.
        const corpusToday = a.totalValue * lumpPct;
        const corpusAtRetirement = grown * lumpPct;
        components.push({
          itemName: `NPS ${a.tier === 'TIER1' ? 'Tier I' : 'Tier II'} · ${a.accountNumber ?? a.pan ?? '—'} (${Math.round(lumpPct * 100)}% lumpsum)`,
          todayPaisa: corpusToday,
          atRetirementPaisa: corpusAtRetirement,
          growthRatePct: expectedReturnPct,
          balanceComponentPaisa: corpusAtRetirement,
          contributionComponentPaisa: 0,
          monthlyContributionPaisa: 0,
        });
      }
      if (components.length > 0) {
        const today = components.reduce((s, c) => s + c.todayPaisa, 0);
        const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
        breakdowns.push({
          assetClass: 'NPS',
          todayPaisa: today,
          atRetirementPaisa: future,
          growthMultiple: today > 0 ? future / today : 0,
          components,
        });
      }
    }

    /* ─── PF (EPF) ────────────────────────────────────────────────────
     * Top tile math:
     *   cCorpus += compound(it.valuePaisa, pfRate, yrs);  // pfRate = 0.0825 hardcoded
     * Full balance, hardcoded 8.25%. No contribution leg (top tile
     * doesn't fold in monthlyContributionPaisa). */
    {
      const components: Component[] = [];
      for (const a of pf) {
        const sel = findSelection(selections, 'PF', a.id);
        const included = sel ? !!sel.included : true;
        if (!included) continue;
        const corpusAtRetirement = compound(
          a.totalBalance,
          PF_RATE_PCT,
          yearsToRetire,
        );
        components.push({
          itemName: `${a.accountType} · ${a.accountHolder}`,
          todayPaisa: a.totalBalance,
          atRetirementPaisa: corpusAtRetirement,
          growthRatePct: PF_RATE_PCT,
          balanceComponentPaisa: corpusAtRetirement,
          contributionComponentPaisa: 0,
          monthlyContributionPaisa: 0,
        });
      }
      if (components.length > 0) {
        const today = components.reduce((s, c) => s + c.todayPaisa, 0);
        const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
        breakdowns.push({
          assetClass: 'EPF',
          todayPaisa: today,
          atRetirementPaisa: future,
          growthMultiple: today > 0 ? future / today : 0,
          components,
        });
      }
    }

    /* ─── REAL ESTATE — split by retirement_treatment ─────────────────
     *
     * Sprint 5.12 — the per-row `retirement_treatment` column is now
     * the canonical signal for whether a property contributes to the
     * corpus. The `retirement_asset_selection` picker override still
     * wins when present (lets the user temporarily flip a property's
     * inclusion from the /retirement asset-picker without changing
     * its strategic intent on the real-estate detail page).
     *
     * Treatment → default behaviour:
     *   • 'sell'           → included=true, mode=SELL  → enters corpus
     *   • 'rental_only'    → included=true, mode=RENTAL → income stream
     *                        only; surfaced in excludedFromCorpus
     *   • 'self_occupied'  → included=false (no corpus, no rental);
     *                        also surfaced in excludedFromCorpus so the
     *                        user can reconcile their net worth vs.
     *                        corpus tile drop. */
    const sellProps: Array<{
      prop: typeof props[number];
      salePriceOverridePaisa: number | null;
    }> = [];
    const heldOutsideCorpus: ExcludedFromCorpus['realEstate'] = [];
    for (const p of props) {
      const sel = findSelection(selections, 'REAL_ESTATE', p.id);
      const treatment = (p.retirementTreatment ?? 'sell') as
        | 'sell'
        | 'rental_only'
        | 'self_occupied';
      const defaultIncluded = treatment !== 'self_occupied';
      const defaultMode: 'SELL' | 'RENTAL' =
        treatment === 'rental_only' ? 'RENTAL' : 'SELL';
      const included = sel ? !!sel.included : defaultIncluded;
      const mode: 'SELL' | 'RENTAL' =
        ((sel?.mode as 'SELL' | 'RENTAL' | null) ?? defaultMode);

      if (included && mode === 'SELL') {
        sellProps.push({
          prop: p,
          salePriceOverridePaisa: sel?.salePriceOverridePaisa ?? null,
        });
      } else if (included && mode === 'RENTAL') {
        // Rental properties are intentionally held outside the
        // corpus (income stream, not liquidation). Surface as a
        // disclosure so the corpus drop vs. net worth is explainable.
        heldOutsideCorpus.push({
          itemName: p.propertyName,
          treatment: 'rental_only',
          todayPaisa: p.currentValuation,
          note: 'Rental income flows through cashflow separately',
        });
      } else if (treatment === 'self_occupied') {
        // Self-occupied properties — kept forever, no income, no
        // liquidation. Surface as a disclosure too.
        heldOutsideCorpus.push({
          itemName: p.propertyName,
          treatment: 'self_occupied',
          todayPaisa: p.currentValuation,
          note: 'Self-occupied — no rental, no liquidation',
        });
      }
      // else: excluded entirely from the retirement story (user
      // toggled off in the picker). Not surfaced here — belongs on
      // whichever other goal the user earmarked it for.
    }

    if (sellProps.length > 0) {
      const components: Component[] = sellProps.map(({ prop: p, salePriceOverridePaisa }) => {
        const corpusAtRetirement =
          salePriceOverridePaisa && salePriceOverridePaisa > 0
            ? salePriceOverridePaisa
            : compound(p.currentValuation, expectedReturnPct, yearsToRetire);
        return {
          itemName:
            salePriceOverridePaisa && salePriceOverridePaisa > 0
              ? `${p.propertyName} (sale price override)`
              : p.propertyName,
          todayPaisa: p.currentValuation,
          atRetirementPaisa: corpusAtRetirement,
          growthRatePct:
            salePriceOverridePaisa && salePriceOverridePaisa > 0 ? 0 : expectedReturnPct,
          balanceComponentPaisa: corpusAtRetirement,
          contributionComponentPaisa: 0,
          monthlyContributionPaisa: 0,
        };
      });
      const today = components.reduce((s, c) => s + c.todayPaisa, 0);
      const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
      breakdowns.push({
        assetClass: 'REAL_ESTATE',
        todayPaisa: today,
        atRetirementPaisa: future,
        growthMultiple: today > 0 ? future / today : 0,
        components,
      });
    }

    /* ─── INSURANCE_POLICIES (pre-retirement maturing only) ──────────
     * Top tile math:
     *   - Only WHOLE_LIFE/ENDOWMENT/ULIP/MONEY_BACK with annuityAmount=0
     *   - Payout = maturityBenefit || sumAssured (the asset-picker's
     *     fallback resolution)
     *   - If maturity is BEFORE retirement: compound the payout for
     *     `yrsAfterMaturity = max(0, yrs - matYrs)` at expected return,
     *     contribute to corpus.
     *   - If maturity is AFTER retirement OR undated: enters the ladder
     *     (income stream), NOT corpus → excluded from this breakdown.
     */
    {
      const components: Component[] = [];
      for (const p of policies) {
        if (p.status !== 'ACTIVE') continue;
        if (!MATURING_POLICY_TYPES.includes(p.policyType)) continue;
        if ((p.annuityAmount ?? 0) !== 0) continue;
        const payoutPaisa =
          p.maturityBenefit && p.maturityBenefit > 0
            ? p.maturityBenefit
            : p.sumAssured || 0;
        if (payoutPaisa <= 0) continue;

        const sel = findSelection(selections, 'INSURANCE_POLICIES', p.id);
        const included = sel ? !!sel.included : true;
        if (!included) continue;

        // Ladder model: undated or post-retirement maturities are
        // income (ladder), not corpus. Skip them here.
        if (!p.maturityDate) continue;
        const matYrs = yearsBetween(todayISO, p.maturityDate);
        if (matYrs >= yearsToRetire) continue; // post-retirement → ladder, not corpus

        const yrsAfterMaturity = Math.max(0, yearsToRetire - matYrs);
        const corpusAtRetirement = compound(
          payoutPaisa,
          expectedReturnPct,
          yrsAfterMaturity,
        );
        components.push({
          itemName: `${p.insurer} ${p.policyType.replace('_', ' ').toLowerCase()} · ${p.policyNumber}`,
          todayPaisa: payoutPaisa,
          atRetirementPaisa: corpusAtRetirement,
          growthRatePct: expectedReturnPct,
          balanceComponentPaisa: corpusAtRetirement,
          contributionComponentPaisa: 0,
          monthlyContributionPaisa: 0,
        });
      }
      if (components.length > 0) {
        const today = components.reduce((s, c) => s + c.todayPaisa, 0);
        const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
        breakdowns.push({
          assetClass: 'INSURANCE',
          todayPaisa: today,
          atRetirementPaisa: future,
          growthMultiple: today > 0 ? future / today : 0,
          components,
        });
      }
    }

    const totalCorpusAtRetirementPaisa = breakdowns.reduce(
      (s, b) => s + b.atRetirementPaisa,
      0,
    );

    const excludedFromCorpus: ExcludedFromCorpus = {
      realEstate: heldOutsideCorpus,
    };

    return NextResponse.json({
      totalCorpusAtRetirementPaisa,
      retirementYear,
      yearsToRetire,
      byAssetClass: breakdowns.sort(
        (a, b) => b.atRetirementPaisa - a.atRetirementPaisa,
      ),
      excludedFromCorpus,
    });
  } catch (err) {
    console.error('[finance/retirement-corpus-breakdown GET]', err);
    return NextResponse.json({ error: 'Failed to compute breakdown' }, { status: 500 });
  }
}
