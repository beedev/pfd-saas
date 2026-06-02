/**
 * GET    /api/finance/retirement-assets   — five asset classes with per-item
 *                                           selection, current values, and
 *                                           mode/override fields.
 * PATCH  /api/finance/retirement-assets   — toggle inclusion / change mode /
 *                                           override sale price / tweak NPS
 *                                           split per item.
 *
 * Items are pulled live from the underlying investment tables:
 *   • NPS               — npsAccounts            (lumpsum + annuity at 60)
 *   • PF                — providentFund          (lumpsum at retirement)
 *   • ANNUITY_POLICIES  — insurancePolicies where annuityAmount > 0
 *   • INSURANCE_POLICIES — insurancePolicies with maturity_date (ladder)
 *   • REAL_ESTATE       — realEstate properties  (sell or rent)
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  retirementAssetSelection,
  npsAccounts,
  providentFund,
  insurancePolicies,
  realEstate,
  smallSavingsAccounts,
  mutualFunds,
  type RetirementAssetSelection,
} from '@/db';
import { auth } from '@/auth';
import { getGrowthRates, getMfRate } from '@/lib/finance/asset-growth-rates';

const MATURING_POLICY_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP', 'MONEY_BACK'];
const ANNUITY_FREQ_TO_PER_YEAR: Record<string, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  YEARLY: 1,
};

type Mode = 'SELL' | 'RENTAL';

interface RetirementItem {
  id: number;
  label: string;
  sublabel?: string;
  /** Current value in paisa, used for lumpsum projection. */
  valuePaisa: number;
  /** For income-stream items (annuity, rental). Annual amount in paisa. */
  annualIncomePaisa?: number;
  /** Dated payouts (insurance maturity ladder). */
  maturityDate?: string | null;
  /** When an annuity policy actually begins paying out. Used so deferred
   *  annuities (e.g. start at age 62) aren't credited as income before then. */
  startDate?: string | null;
  included: boolean;
  mode?: Mode;
  salePriceOverridePaisa?: number | null;
  npsLumpsumPct?: number;
  npsAnnuityRatePct?: number;
  /** REAL_ESTATE in RENTAL mode: user-entered expected monthly rent at retirement (paisa). */
  expectedFutureRentPaisa?: number | null;
  /** Sprint 5.7 — for MUTUAL_FUNDS items, the resolved category + rate
   *  used by projection. Other classes leave these undefined. */
  category?: 'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN';
  returnPct?: number;
}

interface AssetClassRow {
  assetClass:
    | 'NPS'
    | 'PF'
    | 'SMALL_SAVINGS'
    | 'ANNUITY_POLICIES'
    | 'INSURANCE_POLICIES'
    | 'REAL_ESTATE'
    | 'MUTUAL_FUNDS';
  label: string;
  /** Short note about how the class contributes (corpus / income / mixed). */
  basis: string;
  items: RetirementItem[];
  /** Sprint 5.7 — Mutual Funds class row carries per-category breakdown
   *  rows (EQUITY/DEBT/HYBRID/UNKNOWN) showing the resolved rate used.
   *  Other classes leave this undefined. */
  mfBreakdown?: Array<{
    category: 'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN';
    valuePaisa: number;
    returnPct: number;
    fundCount: number;
  }>;
}

function findRow(
  rows: RetirementAssetSelection[],
  assetClass: string,
  sourceId: number,
): RetirementAssetSelection | undefined {
  return rows.find((r) => r.assetClass === assetClass && r.sourceId === sourceId);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const [nps, pf, ins, props, smallSavings, mfs, selections, rates] = await Promise.all([
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, session.user.id)),
      db.select().from(providentFund).where(eq(providentFund.userId, session.user.id)),
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, session.user.id)),
      db.select().from(realEstate).where(eq(realEstate.userId, session.user.id)),
      db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, session.user.id)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, session.user.id)),
      db.select().from(retirementAssetSelection).where(eq(retirementAssetSelection.userId, session.user.id)),
      getGrowthRates(session.user.id),
    ]);

    // ─── NPS ────────────────────────────────────────────────────────────
    const npsItems: RetirementItem[] = nps.map((a) => {
      const sel = findRow(selections, 'NPS', a.id);
      return {
        id: a.id,
        label: `NPS ${a.tier === 'TIER1' ? 'Tier I' : 'Tier II'}`,
        sublabel: a.accountNumber ?? undefined,
        valuePaisa: a.totalValue || 0,
        included: sel ? !!sel.included : true,
        npsLumpsumPct: sel?.npsLumpsumPct ?? 60,
        npsAnnuityRatePct: sel?.npsAnnuityRatePct ?? 6,
      };
    });

    // ─── PF ─────────────────────────────────────────────────────────────
    const pfItems: RetirementItem[] = pf.map((a) => {
      const sel = findRow(selections, 'PF', a.id);
      return {
        id: a.id,
        label: `${a.accountType} · ${a.accountHolder}`,
        sublabel: a.accountNumber ?? undefined,
        valuePaisa: a.totalBalance || 0,
        included: sel ? !!sel.included : true,
      };
    });

    // ─── SMALL_SAVINGS ──────────────────────────────────────────────────
    // PPF/VPF/SSY default-on (long-horizon tax-free corpora that mature
    // around retirement age). NSC/KVP/SCSS off by default — shorter
    // horizons or non-retirement use cases.
    const ssItems: RetirementItem[] = smallSavings
      .filter((a) => a.status === 'ACTIVE' || a.status === 'EXTENDED')
      .map((a) => {
        const sel = findRow(selections, 'SMALL_SAVINGS', a.id);
        return {
          id: a.id,
          label: `${a.schemeType} · ${a.holderName}`,
          sublabel: a.accountNumber ?? undefined,
          valuePaisa: a.currentBalancePaisa,
          maturityDate: a.maturityDate ?? null,
          included: sel
            ? !!sel.included
            : a.schemeType === 'PPF' ||
              a.schemeType === 'VPF' ||
              a.schemeType === 'SSY',
        };
      });

    // ─── ANNUITY_POLICIES ───────────────────────────────────────────────
    const annuityItems: RetirementItem[] = ins
      .filter((p) => p.status === 'ACTIVE' && (p.annuityAmount ?? 0) > 0)
      .sort((a, b) => (a.maturityDate ?? '9999').localeCompare(b.maturityDate ?? '9999'))
      .map((p) => {
        const perYear =
          ANNUITY_FREQ_TO_PER_YEAR[p.annuityFrequency ?? 'YEARLY'] ?? 1;
        const annualPaisa = (p.annuityAmount ?? 0) * perYear;
        const sel = findRow(selections, 'ANNUITY_POLICIES', p.id);
        return {
          id: p.id,
          label: `${p.insurer} ${p.policyType.replace('_', ' ').toLowerCase()}`,
          sublabel: `Policy ${p.policyNumber} · ₹${(p.annuityAmount ?? 0) / 100} ${p.annuityFrequency ?? 'YEARLY'}`,
          valuePaisa: 0,
          annualIncomePaisa: annualPaisa,
          startDate: p.annuityStartDate ?? null,
          included: sel ? !!sel.included : true,
        };
      });

    // ─── INSURANCE_POLICIES (maturity ladder) ───────────────────────────
    // Include every active endowment-style policy that isn't already paying
    // out as an annuity. Policies without a maturity_date still surface — the
    // math treats them as conservative lumpsum at retirement so the user can
    // tick them in and fill maturity dates over time.
    const policyItems: RetirementItem[] = ins
      .filter(
        (p) =>
          p.status === 'ACTIVE' &&
          MATURING_POLICY_TYPES.includes(p.policyType) &&
          (p.annuityAmount ?? 0) === 0,
      )
      .map((p) => ({
        ...p,
        // Same fallback the savings-assets endpoint uses: maturity benefit if
        // entered, else sum assured.
        payoutPaisa:
          p.maturityBenefit && p.maturityBenefit > 0
            ? p.maturityBenefit
            : p.sumAssured || 0,
      }))
      .filter((p) => p.payoutPaisa > 0)
      .sort((a, b) => (a.maturityDate ?? '9999').localeCompare(b.maturityDate ?? '9999'))
      .map((p) => {
        const sel = findRow(selections, 'INSURANCE_POLICIES', p.id);
        return {
          id: p.id,
          label: `${p.insurer} ${p.policyType.replace('_', ' ').toLowerCase()}`,
          sublabel: `Policy ${p.policyNumber}`,
          valuePaisa: p.payoutPaisa,
          maturityDate: p.maturityDate ?? null,
          included: sel ? !!sel.included : true,
        };
      });

    // ─── MUTUAL_FUNDS (Sprint 5.7 — per-fund category drives growth rate) ─
    // Each item row carries the resolved category + rate used. The class
    // row also gets an aggregate `mfBreakdown` so the UI can surface
    // "EQUITY ₹X @ 11% · DEBT ₹Y @ 7% · …" at a glance.
    const mfItems: RetirementItem[] = mfs
      .filter((f) => (f.currentValue ?? 0) > 0)
      .map((f) => {
        const category = (f.category ?? 'UNKNOWN') as 'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN';
        const returnPct = getMfRate(category, rates);
        const sel = findRow(selections, 'MUTUAL_FUNDS', f.id);
        return {
          id: f.id,
          label: f.schemeName,
          sublabel: `${category} · ${returnPct}% growth`,
          valuePaisa: f.currentValue ?? 0,
          category,
          returnPct,
          // Mutual funds default to NOT included in the retirement
          // corpus — the user might have earmarked them for a nearer
          // goal (house, education). They toggle in per-fund if they
          // want a fund to feed retirement specifically.
          included: sel ? !!sel.included : false,
        };
      })
      .sort((a, b) => b.valuePaisa - a.valuePaisa);

    const mfBreakdownMap = new Map<
      'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN',
      { value: number; returnPct: number; count: number }
    >();
    for (const it of mfItems) {
      const cat = it.category!;
      const prev = mfBreakdownMap.get(cat) ?? { value: 0, returnPct: it.returnPct!, count: 0 };
      mfBreakdownMap.set(cat, {
        value: prev.value + it.valuePaisa,
        returnPct: it.returnPct!, // same for all items in a category
        count: prev.count + 1,
      });
    }
    const mfBreakdown = Array.from(mfBreakdownMap.entries()).map(([category, agg]) => ({
      category,
      valuePaisa: agg.value,
      returnPct: agg.returnPct,
      fundCount: agg.count,
    }));

    // ─── REAL_ESTATE ────────────────────────────────────────────────────
    const reItems: RetirementItem[] = props.map((p) => {
      const sel = findRow(selections, 'REAL_ESTATE', p.id);
      const monthlyRent = p.monthlyRent ?? 0;
      return {
        id: p.id,
        label: p.propertyName,
        sublabel: `${p.type} · ${p.city}`,
        valuePaisa: p.currentValuation || 0,
        annualIncomePaisa: monthlyRent * 12,
        included: sel ? !!sel.included : true,
        mode: ((sel?.mode as Mode | null) ?? (monthlyRent > 0 ? 'RENTAL' : 'SELL')) as Mode,
        salePriceOverridePaisa: sel?.salePriceOverridePaisa ?? null,
        expectedFutureRentPaisa: sel?.expectedFutureRentPaisa ?? null,
      };
    });

    const classes: AssetClassRow[] = [
      {
        assetClass: 'NPS',
        label: 'NPS',
        basis: 'At retirement: lumpsum % is withdrawn, the rest buys an annuity (default 60/40 split, 6% yield).',
        items: npsItems,
      },
      {
        assetClass: 'PF',
        label: 'Provident Fund',
        basis: 'Full balance withdrawn at retirement; grows at PF rate (default 8.25%) till then.',
        items: pfItems,
      },
      {
        assetClass: 'SMALL_SAVINGS',
        label: 'Small Savings',
        basis: 'PPF/VPF/SSY — long-horizon tax-free corpus that matures around retirement age. NSC/KVP/SCSS shorter-horizon — off by default.',
        items: ssItems,
      },
      {
        assetClass: 'ANNUITY_POLICIES',
        label: 'Annuity Policies',
        basis: 'Existing annuity payouts (yearly/monthly) — recurring retirement income.',
        items: annuityItems,
      },
      {
        assetClass: 'INSURANCE_POLICIES',
        label: 'Insurance Maturity Ladder',
        basis: 'Endowment / money-back policies maturing on their dates. Pre-retirement maturities compound into corpus; post-retirement maturities land as income in that year.',
        items: policyItems,
      },
      {
        assetClass: 'REAL_ESTATE',
        label: 'Real Estate',
        basis: 'Sell mode: sale price (or compounded valuation) becomes lumpsum at retirement. Rental mode: monthly rent × 12 grown by inflation becomes retirement income.',
        items: reItems,
      },
      {
        assetClass: 'MUTUAL_FUNDS',
        label: 'Mutual Funds',
        basis: 'Per-fund growth rate resolved from category (Equity/Debt/Hybrid). UNKNOWN funds use the umbrella MF rate. Off by default — toggle each fund in if you want it to feed the retirement corpus.',
        items: mfItems,
        mfBreakdown,
      },
    ];

    return NextResponse.json({ classes });
  } catch (err) {
    console.error('GET retirement-assets:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { assetClass, sourceId, included, mode, salePriceOverride, npsLumpsumPct, npsAnnuityRatePct, expectedFutureRent } = body;
    if (typeof assetClass !== 'string' || typeof sourceId !== 'number') {
      return NextResponse.json(
        { error: 'assetClass and sourceId required' },
        { status: 400 },
      );
    }

    const existing = await db
      .select()
      .from(retirementAssetSelection)
      .where(
        and(
          eq(retirementAssetSelection.assetClass, assetClass),
          eq(retirementAssetSelection.sourceId, sourceId),
          eq(retirementAssetSelection.userId, session.user.id),
        ),
      )
      .limit(1);

    const update: Partial<typeof retirementAssetSelection.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof included === 'boolean') update.included = included;
    if (mode === 'SELL' || mode === 'RENTAL') update.mode = mode;
    if (salePriceOverride === null) update.salePriceOverridePaisa = null;
    else if (typeof salePriceOverride === 'number' && salePriceOverride >= 0)
      update.salePriceOverridePaisa = Math.round(salePriceOverride * 100);
    if (typeof npsLumpsumPct === 'number' && npsLumpsumPct >= 0 && npsLumpsumPct <= 100)
      update.npsLumpsumPct = npsLumpsumPct;
    if (typeof npsAnnuityRatePct === 'number' && npsAnnuityRatePct >= 0)
      update.npsAnnuityRatePct = npsAnnuityRatePct;
    if (expectedFutureRent === null) update.expectedFutureRentPaisa = null;
    else if (typeof expectedFutureRent === 'number' && expectedFutureRent >= 0)
      update.expectedFutureRentPaisa = Math.round(expectedFutureRent * 100);

    if (existing.length) {
      await db
        .update(retirementAssetSelection)
        .set(update)
        .where(and(eq(retirementAssetSelection.id, existing[0].id), eq(retirementAssetSelection.userId, session.user.id)));
    } else {
      await db.insert(retirementAssetSelection).values({
        userId: session.user.id,
        assetClass,
        sourceId,
        included: typeof included === 'boolean' ? included : true,
        ...update,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH retirement-assets:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
