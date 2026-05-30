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
  type RetirementAssetSelection,
} from '@/db';

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
}

interface AssetClassRow {
  assetClass:
    | 'NPS'
    | 'PF'
    | 'ANNUITY_POLICIES'
    | 'INSURANCE_POLICIES'
    | 'REAL_ESTATE';
  label: string;
  /** Short note about how the class contributes (corpus / income / mixed). */
  basis: string;
  items: RetirementItem[];
}

function findRow(
  rows: RetirementAssetSelection[],
  assetClass: string,
  sourceId: number,
): RetirementAssetSelection | undefined {
  return rows.find((r) => r.assetClass === assetClass && r.sourceId === sourceId);
}

export async function GET() {
  try {
    const [nps, pf, ins, props, selections] = await Promise.all([
      db.select().from(npsAccounts),
      db.select().from(providentFund),
      db.select().from(insurancePolicies),
      db.select().from(realEstate),
      db.select().from(retirementAssetSelection),
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
    ];

    return NextResponse.json({ classes });
  } catch (err) {
    console.error('GET retirement-assets:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
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
        .where(eq(retirementAssetSelection.id, existing[0].id));
    } else {
      await db.insert(retirementAssetSelection).values({
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
