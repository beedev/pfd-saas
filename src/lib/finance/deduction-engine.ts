/**
 * Chapter VI-A deduction engine — single source of truth.
 *
 * Both /api/tax/summary and /api/tax/regime-compare previously derived
 * their Section-80 buckets independently, with subtly different rules
 * (summary auto-pulled ELSS/SGB/small-savings but counted 80G/80D at
 * face value; regime-compare ran 80D/80G through the sr-citizen-aware
 * helpers but ignored ELSS/SGB/small-savings and health_insurance_
 * policies). This engine folds BOTH derivations together so the two
 * surfaces agree, applying the correct caps once:
 *
 *   • 80C       — manual rows + home-loan principal (FY-aggregated via
 *                 the loan aggregator) + EPF employee balance + small-
 *                 savings (PPF/VPF/NSC/SSY/SCSS) deposits + LIC life
 *                 premiums (annualised) + ELSS mutual funds + SGB.
 *                 Capped at ₹1.5L.
 *   • 80CCD(1B) — NPS Tier-I totalContributed, capped ₹50k. SEPARATE
 *                 from the 80C cap.
 *   • 80D       — manual bucketed rows + annualised health-insurance
 *                 premiums (dedicated health_insurance_policies table
 *                 AND any HEALTH/CRITICAL_ILLNESS rows in insurance_
 *                 policies), through computeSection80d (sr-citizen caps).
 *                 Legacy un-bucketed 80D rows added at face value.
 *   • 80G       — categorised + uncategorised (→ 50_WITH_LIMIT default)
 *                 through computeSection80g at the ELIGIBLE amount.
 *   • 24B       — home-loan interest from the loan aggregator (FY-aware)
 *                 plus any manual 24B rows, capped ₹2L.
 *   • 80EEA     — manual rows, capped ₹1.5L.
 *   • other     — any remaining manual Chapter VI-A sections at face
 *                 value (80E, 80TTA, 80U, …), each capped at its
 *                 SECTION_CAPS ceiling when one exists.
 *
 * All amounts paisa. All queries userId-scoped (multi-tenant).
 *
 * NEW-regime semantics are preserved from the SaaS regime-compare: only
 * tax_deductions rows flagged eligible_under_new contribute to the NEW
 * total (typically 80CCD(2) employer NPS). The derived asset-backed
 * buckets above are OLD-regime only.
 */

import { and, eq } from 'drizzle-orm';
import {
  db,
  taxDeductions,
  mutualFunds,
  epfAccounts,
  smallSavingsAccounts,
  insurancePolicies,
  healthInsurancePolicies,
  liabilities,
  npsAccounts,
  goldHoldings,
  userPreferences,
} from '@/db';
import { computeSection80d } from './section-80d';
import { computeSection80g, type EightyGCategory } from './section-80g';
import { aggregateLoanTaxDeductions } from './loan-tax';
import { SECTION_CAPS, type TaxSection } from './tax-constants';

/** Annualise a premium given its frequency. Mirrors tax/summary +
 *  regime-compare so the derived 80C / 80D figures agree across surfaces.
 *  ANNUAL/YEARLY pass through; SINGLE contributes 0 (one-time, not a
 *  recurring annual premium). */
function annualisePremium(amount: number, freq: string | null): number {
  switch ((freq || 'YEARLY').toUpperCase()) {
    case 'MONTHLY':
      return amount * 12;
    case 'QUARTERLY':
      return amount * 4;
    case 'HALF_YEARLY':
      return amount * 2;
    case 'SINGLE':
      return 0;
    case 'YEARLY':
    case 'ANNUAL':
    default:
      return amount;
  }
}

const EIGHTY_C_CAP_PAISA = 1_50_000 * 100;
const EIGHTY_CCD_1B_CAP_PAISA = 50_000 * 100;

const LIFE_TYPES = ['TERM_LIFE', 'WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];
const HEALTH_TYPES = ['HEALTH', 'CRITICAL_ILLNESS'];
const SS_80C_SCHEMES = ['PPF', 'VPF', 'NSC', 'SSY', 'SCSS'];

/** Sections the engine derives/handles explicitly. Manual rows in these
 *  sections must NOT also be swept into the generic "other" bucket
 *  (would double-count). 80C/80D/80G/24B/80EEA are folded in via their
 *  dedicated buckets; the NPS-1B variants are derived from npsAccounts. */
const HANDLED_SECTIONS = new Set<string>([
  '80C',
  '80D',
  '80G',
  '24B',
  '80EEA',
  '80CCD_1B',
  '80CCD1B',
  '80CCD(1B)',
]);

export interface DeductionSource {
  source: string;
  amountPaisa: number;
}

export interface DeductionBucket {
  /** Post-cap deduction that lands in the OLD-regime total. */
  appliedPaisa: number;
  /** Pre-cap source contributions, for the expandable UI. */
  sources: DeductionSource[];
}

export interface DeductionResult {
  /** Per-section buckets keyed by canonical section code. */
  buckets: Record<string, DeductionBucket>;
  /** Sum of every bucket's appliedPaisa — the OLD-regime deduction. */
  oldRegimeTotalPaisa: number;
  /** Only the new-regime-eligible portion (eligible_under_new rows). */
  newRegimeTotalPaisa: number;
  /** Per-section list summing to oldRegimeTotalPaisa (expandable UI). */
  breakdown: Array<{ label: string; amountPaisa: number }>;
}

/**
 * Normalise a raw tax_deductions.section string to a canonical bucket
 * key (SECTION_80C → 80C, 80CCD → 80CCD_1B, etc.). Returns null when
 * the section is unrecognised.
 */
function normaliseSection(raw: string | null): TaxSection | null {
  let sec = (raw || '').trim();
  if (sec.startsWith('SECTION_')) sec = sec.replace('SECTION_', '');
  if (sec === '80CCD') sec = '80CCD_1B';
  if (sec === '80CCD(1B)' || sec === '80CCD1B') sec = '80CCD_1B';
  return sec in SECTION_CAPS ? (sec as TaxSection) : null;
}

/**
 * Derive every Chapter VI-A deduction bucket for a user + FY from their
 * real records. Single source of truth for tax/summary + regime-compare.
 */
export async function deriveDeductions(
  userId: string,
  fy: string,
  opts?: {
    /** Adjusted gross total income for the Sec 80G 10%-of-income cap on
     *  _WITH_LIMIT categories. Callers with income context (regime-compare,
     *  tax/summary) should pass it; omitted → cap effectively disabled. */
    adjustedGrossForEightyGPaisa?: number;
  },
): Promise<DeductionResult> {
  const [
    deductions,
    mfs,
    epfRows,
    ssRows,
    lifeAndHealthPolicies,
    healthPolicies,
    loanRows,
    npsRows,
    gold,
    prefsRows,
  ] = await Promise.all([
    db
      .select()
      .from(taxDeductions)
      .where(and(eq(taxDeductions.userId, userId), eq(taxDeductions.financialYear, fy))),
    db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)),
    db.select().from(epfAccounts).where(eq(epfAccounts.userId, userId)),
    db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, userId)),
    db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
    db.select().from(healthInsurancePolicies).where(eq(healthInsurancePolicies.userId, userId)),
    db.select().from(liabilities).where(eq(liabilities.userId, userId)),
    db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
    db.select().from(goldHoldings).where(eq(goldHoldings.userId, userId)),
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
  ]);

  const prefs = prefsRows[0];
  const isSrCitizen = prefs?.isSrCitizen ?? false;
  const parentsAreSrCitizens = prefs?.parentsAreSrCitizens ?? false;

  // ─── Loan aggregator — FY-aware principal/interest from amortisation ──
  const loanAgg = aggregateLoanTaxDeductions(
    loanRows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      status: r.status,
      currentBalance: r.currentBalance,
      originalAmount: r.originalAmount,
      interestRate: r.interestRate,
      monthlyEmi: r.monthlyEmi,
      startDate: r.startDate,
      maturityDate: r.maturityDate,
      remainingTenor: r.remainingTenor,
      principalQualifies80c: r.principalQualifies80c,
      interestQualifies24b: r.interestQualifies24b,
    })),
    fy,
  );
  const loanDeductions =
    'error' in loanAgg
      ? { totalInterestPaisa: 0, totalPrincipalPaisa: 0 }
      : loanAgg;

  // ─── 80C sources ──────────────────────────────────────────────────
  const manual80c = deductions
    .filter((r) => normaliseSection(r.section) === '80C')
    .reduce((s, r) => s + (r.amountPaisa ?? r.deductibleAmount ?? 0), 0);

  const loanPrincipalPaisa = loanDeductions.totalPrincipalPaisa;

  const epfEmployeePaisa = epfRows
    .filter((p) => p.accountType === 'EPF')
    .reduce((s, p) => s + (p.employeeBalance ?? 0), 0);

  const smallSavingsPaisa = ssRows
    .filter((a) => SS_80C_SCHEMES.includes(a.schemeType))
    .reduce((s, a) => s + (a.totalDepositedPaisa ?? 0), 0);

  const lifePremiumPaisa = lifeAndHealthPolicies
    .filter((p) => LIFE_TYPES.includes(p.policyType))
    .reduce((s, p) => s + annualisePremium(p.premiumAmount ?? 0, p.premiumFrequency), 0);

  const elssPaisa = mfs
    .filter((m) => {
      const name = (m.schemeName || '').toLowerCase();
      return (
        m.fundType === 'EQUITY' &&
        (name.includes('elss') || name.includes('tax saver') || name.includes('taxsaver'))
      );
    })
    .reduce((s, m) => s + (m.totalInvestment ?? 0), 0);

  const sgbPaisa = gold
    .filter((g) => g.type === 'GOLD_BOND')
    .reduce((s, g) => s + (g.totalInvestment ?? g.purchasePrice ?? 0), 0);

  const eightyCSources: DeductionSource[] = [
    { source: 'Manual 80C entries', amountPaisa: manual80c },
    { source: 'Home loan principal (FY-aggregated)', amountPaisa: loanPrincipalPaisa },
    { source: 'EPF employee balance', amountPaisa: epfEmployeePaisa },
    { source: 'PPF/VPF/NSC/SSY/SCSS deposits', amountPaisa: smallSavingsPaisa },
    { source: 'Life insurance premiums (annualised)', amountPaisa: lifePremiumPaisa },
    { source: 'ELSS mutual funds (invested)', amountPaisa: elssPaisa },
    { source: 'Sovereign Gold Bonds', amountPaisa: sgbPaisa },
  ].filter((s) => s.amountPaisa > 0);
  const eightyCRaw = eightyCSources.reduce((s, x) => s + x.amountPaisa, 0);
  const eightyCApplied = Math.min(eightyCRaw, EIGHTY_C_CAP_PAISA);

  // ─── 80CCD(1B) — NPS Tier-I, separate ₹50k cap ────────────────────
  const npsTier1Paisa = npsRows
    .filter((n) => n.tier === 'TIER1')
    .reduce((s, n) => s + (n.totalContributed ?? 0), 0);
  const eightyCcd1bApplied = Math.min(npsTier1Paisa, EIGHTY_CCD_1B_CAP_PAISA);
  const eightyCcd1bSources: DeductionSource[] = npsTier1Paisa > 0
    ? [{ source: 'NPS Tier-I contributed', amountPaisa: npsTier1Paisa }]
    : [];

  // ─── 80D — bucketed helper + annualised health premiums ───────────
  const healthPremiumPaisa =
    healthPolicies.reduce(
      (s, p) => s + annualisePremium(p.premiumPaisa ?? 0, p.premiumFrequency),
      0,
    ) +
    lifeAndHealthPolicies
      .filter((p) => HEALTH_TYPES.includes(p.policyType))
      .reduce((s, p) => s + annualisePremium(p.premiumAmount ?? 0, p.premiumFrequency), 0);

  const eightyDBucketRows = [
    ...deductions
      .filter((r) => normaliseSection(r.section) === '80D' && r.eightyDBucket)
      .map((r) => ({
        bucket: r.eightyDBucket as 'SELF_FAMILY' | 'PARENTS',
        amountPaisa: r.amountPaisa ?? 0,
      })),
    ...(healthPremiumPaisa > 0
      ? [{ bucket: 'SELF_FAMILY' as const, amountPaisa: healthPremiumPaisa }]
      : []),
  ];
  const eightyDResult = computeSection80d({
    rows: eightyDBucketRows,
    isSrCitizen,
    parentsAreSrCitizens,
  });
  const eightyDLegacyPaisa = deductions
    .filter((r) => normaliseSection(r.section) === '80D' && !r.eightyDBucket)
    .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
  const eightyDApplied = eightyDResult.totalDeductionPaisa + eightyDLegacyPaisa;
  // Sources reported at FACE value (pre-cap), so the expandable UI shows
  // what was paid; appliedPaisa is the post-cap deduction.
  const manual80dBucketedFace = eightyDBucketRows
    .reduce((s, r) => s + r.amountPaisa, 0) - healthPremiumPaisa;
  const eightyDSources: DeductionSource[] = [
    ...(healthPremiumPaisa > 0
      ? [{ source: 'Health insurance premiums (annualised)', amountPaisa: healthPremiumPaisa }]
      : []),
    ...(manual80dBucketedFace > 0
      ? [{ source: 'Manual 80D (bucketed)', amountPaisa: manual80dBucketedFace }]
      : []),
    ...(eightyDLegacyPaisa > 0
      ? [{ source: 'Manual 80D (legacy)', amountPaisa: eightyDLegacyPaisa }]
      : []),
  ].filter((s) => s.amountPaisa > 0);

  // ─── 80G — categorised + uncategorised through helper at eligible ──
  // The 10% adjusted-gross cap on _WITH_LIMIT categories needs an
  // income figure. The engine has no income context, so it passes a
  // very large adjustedGross — effectively NO cap. The deduction floor
  // is the donation's eligible rate (50%/100%); the _WITH_LIMIT 10%
  // cap is the binding constraint only at high donation levels. Both
  // consumers historically computed 80G with adjustedGross = slab gross
  // (regime-compare) or not at all (summary). To stay engine-pure we
  // surface the helper at the eligible RATE and let the consumer cap.
  // In practice the regime-compare consumer recomputes nothing — it
  // trusts this figure. We therefore pass a generous cap basis and
  // accept the documented limitation (over-counts 80G only when a user
  // donates >10% of income to _WITH_LIMIT trusts, a rare edge).
  const eightyGRows = [
    ...deductions
      .filter((r) => normaliseSection(r.section) === '80G' && r.eightyGCategory)
      .map((r) => ({
        category: r.eightyGCategory as EightyGCategory,
        amountPaisa: r.amountPaisa ?? 0,
      })),
    ...deductions
      .filter((r) => normaliseSection(r.section) === '80G' && !r.eightyGCategory)
      .map((r) => ({
        category: '50_WITH_LIMIT' as EightyGCategory,
        amountPaisa: r.amountPaisa ?? 0,
      })),
  ];
  const eightyGFaceValue = eightyGRows.reduce((s, r) => s + r.amountPaisa, 0);
  const eightyGResult = computeSection80g({
    rows: eightyGRows,
    // Real income for the 10%-of-AGI cap when the caller supplies it
    // (regime-compare/summary); otherwise a basis large enough that the
    // _WITH_LIMIT cap never binds (eligible RATE only).
    adjustedGrossPaisa:
      opts?.adjustedGrossForEightyGPaisa != null
        ? Math.max(0, opts.adjustedGrossForEightyGPaisa)
        : eightyGFaceValue * 100,
  });
  const eightyGApplied = eightyGResult.totalDeductionPaisa;
  const eightyGSources: DeductionSource[] = eightyGFaceValue > 0
    ? [{ source: 'Donations (eligible amount)', amountPaisa: eightyGApplied }]
    : [];

  // ─── 24B — loan interest (FY-aware) + manual 24B rows, ₹2L cap ────
  const loanInterestPaisa = loanDeductions.totalInterestPaisa;
  const manual24bPaisa = deductions
    .filter((r) => normaliseSection(r.section) === '24B')
    .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
  const twentyFourBSources: DeductionSource[] = [
    ...(loanInterestPaisa > 0
      ? [{ source: 'Home loan interest (FY-aggregated)', amountPaisa: loanInterestPaisa }]
      : []),
    ...(manual24bPaisa > 0
      ? [{ source: 'Manual 24(b) entries', amountPaisa: manual24bPaisa }]
      : []),
  ];
  const twentyFourBRaw = loanInterestPaisa + manual24bPaisa;
  const twentyFourBCap = SECTION_CAPS['24B'].capPaisa ?? twentyFourBRaw;
  const twentyFourBApplied = Math.min(twentyFourBRaw, twentyFourBCap);

  // ─── 80EEA — manual rows, ₹1.5L cap ───────────────────────────────
  const eightyEeaRaw = deductions
    .filter((r) => normaliseSection(r.section) === '80EEA')
    .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
  const eightyEeaCap = SECTION_CAPS['80EEA'].capPaisa ?? eightyEeaRaw;
  const eightyEeaApplied = Math.min(eightyEeaRaw, eightyEeaCap);
  const eightyEeaSources: DeductionSource[] = eightyEeaRaw > 0
    ? [{ source: 'Manual 80EEA entries', amountPaisa: eightyEeaRaw }]
    : [];

  // ─── Other manual Chapter VI-A sections (80E, 80TTA, 80U, …) ───────
  const otherBuckets: Record<string, DeductionBucket> = {};
  for (const r of deductions) {
    const sec = normaliseSection(r.section);
    if (!sec || HANDLED_SECTIONS.has(sec)) continue;
    const amt = r.amountPaisa ?? r.deductibleAmount ?? 0;
    if (amt <= 0) continue;
    if (!otherBuckets[sec]) otherBuckets[sec] = { appliedPaisa: 0, sources: [] };
    otherBuckets[sec].sources.push({
      source: r.description || 'Manual entry',
      amountPaisa: amt,
    });
  }
  // Apply per-section caps on the "other" buckets.
  for (const sec of Object.keys(otherBuckets)) {
    const raw = otherBuckets[sec].sources.reduce((s, x) => s + x.amountPaisa, 0);
    const cap = SECTION_CAPS[sec as TaxSection]?.capPaisa ?? raw;
    otherBuckets[sec].appliedPaisa = Math.min(raw, cap);
  }

  // ─── Assemble buckets ─────────────────────────────────────────────
  const buckets: Record<string, DeductionBucket> = {
    ...otherBuckets,
  };
  if (eightyCApplied > 0 || eightyCSources.length > 0)
    buckets['80C'] = { appliedPaisa: eightyCApplied, sources: eightyCSources };
  if (eightyCcd1bApplied > 0)
    buckets['80CCD_1B'] = { appliedPaisa: eightyCcd1bApplied, sources: eightyCcd1bSources };
  if (eightyDApplied > 0)
    buckets['80D'] = { appliedPaisa: eightyDApplied, sources: eightyDSources };
  if (eightyGApplied > 0)
    buckets['80G'] = { appliedPaisa: eightyGApplied, sources: eightyGSources };
  if (twentyFourBApplied > 0)
    buckets['24B'] = { appliedPaisa: twentyFourBApplied, sources: twentyFourBSources };
  if (eightyEeaApplied > 0)
    buckets['80EEA'] = { appliedPaisa: eightyEeaApplied, sources: eightyEeaSources };

  // ─── Totals ───────────────────────────────────────────────────────
  const oldRegimeTotalPaisa = Object.values(buckets).reduce(
    (s, b) => s + b.appliedPaisa,
    0,
  );

  const newRegimeTotalPaisa = deductions
    .filter((r) => r.eligibleUnderNew)
    .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

  // ─── breakdown — per-section list summing to oldRegimeTotalPaisa ──
  const SECTION_LABEL: Record<string, string> = {
    '80C': 'Section 80C',
    '80CCD_1B': 'Section 80CCD(1B) — NPS',
    '80D': 'Section 80D — health',
    '80G': 'Section 80G — donations',
    '24B': 'Section 24(b) — home loan interest',
    '80EEA': 'Section 80EEA — first-home interest',
  };
  const breakdown = Object.entries(buckets)
    .map(([sec, b]) => ({
      label: SECTION_LABEL[sec] ?? (SECTION_CAPS[sec as TaxSection]?.label ?? `Section ${sec}`),
      amountPaisa: b.appliedPaisa,
    }))
    .filter((x) => x.amountPaisa > 0)
    .sort((a, b) => b.amountPaisa - a.amountPaisa);

  return {
    buckets,
    oldRegimeTotalPaisa,
    newRegimeTotalPaisa,
    breakdown,
  };
}
