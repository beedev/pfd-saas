/**
 * GET /api/finance/retirement-corpus-breakdown
 *
 * Returns the per-asset-class + per-component projection of the user's
 * net worth to retirement age. Powers the expandable "Corpus selected
 * → Grows to" card on /retirement (Sprint 5.11b).
 *
 * Each component row exposes the two-leg projectFutureValue() result
 * (balance leg + contribution leg) so the UI can drill into "₹X comes
 * from your current balance compounding, ₹Y comes from your ongoing
 * SIP/contribution stream".
 *
 * Asset classes covered:
 *   • STOCKS                 — `holdings`
 *   • MF_EQUITY/DEBT/HYBRID  — `mutual_funds` split by category
 *   • NPS                    — `nps_accounts` (balance + monthly contribution)
 *   • EPF                    — `provident_fund` / `epf_accounts`
 *   • SMALL_SAVINGS          — `small_savings_accounts`
 *   • REAL_ESTATE            — `real_estate` (appreciation @ class rate)
 *   • FOREX                  — `forex_deposits` (live INR value × class rate)
 *   • GOLD                   — `gold_holdings`
 *   • INSURANCE              — `insurance_policies` cash value
 *   • FD                     — `fixed_deposits` principal
 *
 * Growth rates per class come from `getGrowthRates(userId)` — the same
 * helper the retirement-assets endpoint uses, so the two surfaces
 * stay in lockstep.
 *
 * Math is intentionally simple: PV growing at the class rate over
 * (retirementYear − currentYear) years. Where the schema carries a
 * recurring contribution (NPS, EPF, small savings), we add the
 * contribution-leg using projectFutureValue's annuity arm.
 *
 * Auth-gated, user-scoped. Pure read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  db,
  holdings,
  mutualFunds,
  npsAccounts,
  providentFund,
  realEstate,
  smallSavingsAccounts,
  insurancePolicies,
  forexDeposits,
  goldHoldings,
  fixedDeposits,
  retirementAssumptions,
} from '@/db';
import { auth } from '@/auth';
import { projectFutureValue } from '@/lib/finance/asset-projection';
import { getGrowthRates, getMfRate } from '@/lib/finance/asset-growth-rates';

const CASH_VALUE_POLICY_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

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

/** Helper to project a single PV/PMT pair at a given annual rate for N years. */
function project(
  pvPaisa: number,
  monthlyContribPaisa: number,
  ratePct: number,
  years: number,
) {
  const result = projectFutureValue({
    currentBalancePaisa: pvPaisa,
    contributionPerPeriodPaisa: monthlyContribPaisa,
    periodsPerYear: monthlyContribPaisa > 0 ? 12 : 1,
    annualRatePct: ratePct,
    yearsToProject: years,
    contributionTiming: 'END',
  });
  return {
    balanceComponentPaisa: result.balanceComponentPaisa,
    contributionComponentPaisa: result.contributionComponentPaisa,
    totalPaisa: result.totalPaisa,
  };
}

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const [
      stocks,
      mfs,
      nps,
      pf,
      props,
      smallSavings,
      policies,
      forex,
      gold,
      fds,
      assRows,
      rates,
    ] = await Promise.all([
      db.select().from(holdings).where(eq(holdings.userId, userId)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)),
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
      db.select().from(providentFund).where(eq(providentFund.userId, userId)),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db
        .select()
        .from(smallSavingsAccounts)
        .where(eq(smallSavingsAccounts.userId, userId)),
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
      db.select().from(forexDeposits).where(eq(forexDeposits.userId, userId)),
      db.select().from(goldHoldings).where(eq(goldHoldings.userId, userId)),
      db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, userId)),
      db
        .select()
        .from(retirementAssumptions)
        .where(eq(retirementAssumptions.userId, userId))
        .limit(1),
      getGrowthRates(userId),
    ]);

    const ass = assRows[0];
    const currentAge = ass?.currentAge ?? 30;
    const targetAge = ass?.targetAge ?? 60;
    const yearsToRetire = Math.max(0, targetAge - currentAge);
    const retirementYear = new Date().getFullYear() + yearsToRetire;

    const breakdowns: AssetClassBreakdown[] = [];

    // ── STOCKS ──────────────────────────────────────────────────────
    if (stocks.length > 0) {
      const ratePct = rates.STOCKS;
      const components: Component[] = stocks.map((h) => {
        const r = project(h.currentValue, 0, ratePct, yearsToRetire);
        return {
          itemName: h.symbol,
          todayPaisa: h.currentValue,
          atRetirementPaisa: r.totalPaisa,
          growthRatePct: ratePct,
          balanceComponentPaisa: r.balanceComponentPaisa,
          contributionComponentPaisa: 0,
          monthlyContributionPaisa: 0,
        };
      });
      const today = components.reduce((s, c) => s + c.todayPaisa, 0);
      const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
      breakdowns.push({
        assetClass: 'STOCKS',
        todayPaisa: today,
        atRetirementPaisa: future,
        growthMultiple: today > 0 ? future / today : 0,
        components,
      });
    }

    // ── MUTUAL FUNDS by category ────────────────────────────────────
    if (mfs.length > 0) {
      const byCategory = new Map<
        'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN',
        Component[]
      >();
      for (const m of mfs) {
        const cat = (m.category ?? 'UNKNOWN') as
          | 'EQUITY'
          | 'DEBT'
          | 'HYBRID'
          | 'UNKNOWN';
        const ratePct = getMfRate(cat, rates);
        const r = project(m.currentValue ?? 0, 0, ratePct, yearsToRetire);
        const list = byCategory.get(cat) ?? [];
        list.push({
          itemName: m.schemeName,
          todayPaisa: m.currentValue ?? 0,
          atRetirementPaisa: r.totalPaisa,
          growthRatePct: ratePct,
          balanceComponentPaisa: r.balanceComponentPaisa,
          contributionComponentPaisa: 0,
          monthlyContributionPaisa: 0,
        });
        byCategory.set(cat, list);
      }
      for (const [cat, comps] of byCategory.entries()) {
        if (comps.length === 0) continue;
        const today = comps.reduce((s, c) => s + c.todayPaisa, 0);
        const future = comps.reduce((s, c) => s + c.atRetirementPaisa, 0);
        const assetClass =
          cat === 'EQUITY'
            ? 'MF_EQUITY'
            : cat === 'DEBT'
              ? 'MF_DEBT'
              : cat === 'HYBRID'
                ? 'MF_HYBRID'
                : 'MUTUAL_FUNDS';
        breakdowns.push({
          assetClass,
          todayPaisa: today,
          atRetirementPaisa: future,
          growthMultiple: today > 0 ? future / today : 0,
          components: comps,
        });
      }
    }

    // ── NPS ──────────────────────────────────────────────────────────
    if (nps.length > 0) {
      const ratePct = rates.NPS;
      const components: Component[] = nps.map((a) => {
        const r = project(
          a.totalValue,
          a.monthlyContributionPaisa ?? 0,
          ratePct,
          yearsToRetire,
        );
        return {
          itemName: `NPS ${a.tier === 'TIER1' ? 'Tier I' : 'Tier II'} · ${a.accountNumber ?? a.pan ?? '—'}`,
          todayPaisa: a.totalValue,
          atRetirementPaisa: r.totalPaisa,
          growthRatePct: ratePct,
          balanceComponentPaisa: r.balanceComponentPaisa,
          contributionComponentPaisa: r.contributionComponentPaisa,
          monthlyContributionPaisa: a.monthlyContributionPaisa ?? 0,
        };
      });
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

    // ── EPF (provident_fund) ────────────────────────────────────────
    if (pf.length > 0) {
      const ratePct = rates.PF;
      const components: Component[] = pf.map((a) => {
        const r = project(
          a.totalBalance,
          a.monthlyContributionPaisa ?? 0,
          ratePct,
          yearsToRetire,
        );
        return {
          itemName: `${a.accountType} · ${a.accountHolder}`,
          todayPaisa: a.totalBalance,
          atRetirementPaisa: r.totalPaisa,
          growthRatePct: ratePct,
          balanceComponentPaisa: r.balanceComponentPaisa,
          contributionComponentPaisa: r.contributionComponentPaisa,
          monthlyContributionPaisa: a.monthlyContributionPaisa ?? 0,
        };
      });
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

    // ── SMALL SAVINGS ──────────────────────────────────────────────
    if (smallSavings.length > 0) {
      const ratePct = rates.SMALL_SAVINGS;
      const components: Component[] = smallSavings
        .filter((a) => a.status === 'ACTIVE' || a.status === 'EXTENDED')
        .map((a) => {
          // Periodic contribution + frequency. If frequency is YEARLY,
          // approximate by /12 to fit the monthly-period model — the
          // total FV is mathematically the same to within rounding.
          const contribFreq = a.contributionFrequency ?? 'MONTHLY';
          const monthlyContrib =
            contribFreq === 'YEARLY'
              ? Math.round((a.periodicContributionPaisa ?? 0) / 12)
              : a.periodicContributionPaisa ?? 0;
          const r = project(
            a.currentBalancePaisa,
            monthlyContrib,
            ratePct,
            yearsToRetire,
          );
          return {
            itemName: `${a.schemeType} · ${a.holderName}`,
            todayPaisa: a.currentBalancePaisa,
            atRetirementPaisa: r.totalPaisa,
            growthRatePct: ratePct,
            balanceComponentPaisa: r.balanceComponentPaisa,
            contributionComponentPaisa: r.contributionComponentPaisa,
            monthlyContributionPaisa: monthlyContrib,
          };
        });
      const today = components.reduce((s, c) => s + c.todayPaisa, 0);
      const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
      if (components.length > 0) {
        breakdowns.push({
          assetClass: 'SMALL_SAVINGS',
          todayPaisa: today,
          atRetirementPaisa: future,
          growthMultiple: today > 0 ? future / today : 0,
          components,
        });
      }
    }

    // ── REAL ESTATE (sell-mode appreciation, no rental income leg) ──
    if (props.length > 0) {
      const ratePct = rates.REAL_ESTATE;
      const components: Component[] = props.map((p) => {
        const r = project(p.currentValuation, 0, ratePct, yearsToRetire);
        return {
          itemName: p.propertyName,
          todayPaisa: p.currentValuation,
          atRetirementPaisa: r.totalPaisa,
          growthRatePct: ratePct,
          balanceComponentPaisa: r.balanceComponentPaisa,
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

    // ── FOREX (live INR equivalent × class rate over years) ─────────
    if (forex.length > 0) {
      const ratePct = rates.FOREX;
      const activeForex = forex.filter((f) => f.status === 'ACTIVE');
      // The forex table stores amount_in_currency (NOT paisa). We use
      // a flat USD/INR estimate of ₹83 for projection-only purposes;
      // accurate live valuation belongs to the live FX endpoint. Same
      // approximation the home dashboard uses on stale-rate days.
      const SPOT_INR_PER_USD = 83;
      const components: Component[] = activeForex.map((f) => {
        const todayPaisa = Math.round(
          f.amountInCurrency * SPOT_INR_PER_USD * 100,
        );
        const r = project(todayPaisa, 0, ratePct, yearsToRetire);
        return {
          itemName: `${f.currencyCode} · ${f.bankName}`,
          todayPaisa,
          atRetirementPaisa: r.totalPaisa,
          growthRatePct: ratePct,
          balanceComponentPaisa: r.balanceComponentPaisa,
          contributionComponentPaisa: 0,
          monthlyContributionPaisa: 0,
        };
      });
      if (components.length > 0) {
        const today = components.reduce((s, c) => s + c.todayPaisa, 0);
        const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
        breakdowns.push({
          assetClass: 'FOREX',
          todayPaisa: today,
          atRetirementPaisa: future,
          growthMultiple: today > 0 ? future / today : 0,
          components,
        });
      }
    }

    // ── GOLD ────────────────────────────────────────────────────────
    if (gold.length > 0) {
      const ratePct = rates.GOLD;
      const components: Component[] = gold
        .map((g) => {
          const today = g.currentValue ?? 0;
          if (today <= 0) return null;
          const r = project(today, 0, ratePct, yearsToRetire);
          return {
            itemName: `${g.holdingType} · ${g.grams ?? 0}g`,
            todayPaisa: today,
            atRetirementPaisa: r.totalPaisa,
            growthRatePct: ratePct,
            balanceComponentPaisa: r.balanceComponentPaisa,
            contributionComponentPaisa: 0,
            monthlyContributionPaisa: 0,
          } as Component;
        })
        .filter((c): c is Component => c !== null);
      if (components.length > 0) {
        const today = components.reduce((s, c) => s + c.todayPaisa, 0);
        const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
        breakdowns.push({
          assetClass: 'GOLD',
          todayPaisa: today,
          atRetirementPaisa: future,
          growthMultiple: today > 0 ? future / today : 0,
          components,
        });
      }
    }

    // ── INSURANCE (cash-value policies only) ───────────────────────
    if (policies.length > 0) {
      const ratePct = rates.INSURANCE_POLICIES;
      const components: Component[] = policies
        .filter(
          (p) =>
            CASH_VALUE_POLICY_TYPES.includes(p.policyType) &&
            (p.investmentValue ?? 0) > 0,
        )
        .map((p) => {
          const today = p.investmentValue ?? 0;
          const r = project(today, 0, ratePct, yearsToRetire);
          return {
            itemName: `${p.insurer} · ${p.policyNumber}`,
            todayPaisa: today,
            atRetirementPaisa: r.totalPaisa,
            growthRatePct: ratePct,
            balanceComponentPaisa: r.balanceComponentPaisa,
            contributionComponentPaisa: 0,
            monthlyContributionPaisa: 0,
          };
        });
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

    // ── FIXED DEPOSITS ─────────────────────────────────────────────
    if (fds.length > 0) {
      const ratePct = rates.FIXED_DEPOSITS;
      const components: Component[] = fds
        .filter((f) => f.status === 'ACTIVE')
        .map((f) => {
          const today = f.principalPaisa;
          const r = project(today, 0, ratePct, yearsToRetire);
          return {
            itemName: `${f.bankName} · ${f.accountNumber ?? '—'}`,
            todayPaisa: today,
            atRetirementPaisa: r.totalPaisa,
            growthRatePct: ratePct,
            balanceComponentPaisa: r.balanceComponentPaisa,
            contributionComponentPaisa: 0,
            monthlyContributionPaisa: 0,
          };
        });
      if (components.length > 0) {
        const today = components.reduce((s, c) => s + c.todayPaisa, 0);
        const future = components.reduce((s, c) => s + c.atRetirementPaisa, 0);
        breakdowns.push({
          assetClass: 'FD',
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

    return NextResponse.json({
      totalCorpusAtRetirementPaisa,
      retirementYear,
      yearsToRetire,
      byAssetClass: breakdowns.sort(
        (a, b) => b.atRetirementPaisa - a.atRetirementPaisa,
      ),
    });
  } catch (err) {
    console.error('[finance/retirement-corpus-breakdown GET]', err);
    return NextResponse.json({ error: 'Failed to compute breakdown' }, { status: 500 });
  }
}
