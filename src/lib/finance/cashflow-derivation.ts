/**
 * Cashflow event derivation — pure functions, no DB.
 *
 * Given already-fetched asset rows, produces a list of candidate
 * `cashflow_events` rows. The caller (the `/api/cashflow-events/derive`
 * route) does the upsert via the (user_id, source_kind, source_id)
 * unique index so re-runs are idempotent — manual overrides are never
 * touched because they share the same key but live with auto_derived=false.
 *
 * Conventions:
 *   • All money in PAISA (integer). No rupee conversions in this lib.
 *   • Dates are ISO YYYY-MM-DD strings.
 *   • Frequencies stored in cashflow_events are ONE_TIME / MONTHLY / YEARLY
 *     only — quarterly / half-yearly annuities are normalised to a
 *     monthly equivalent so downstream projection logic doesn't have to
 *     juggle four buckets.
 *   • Growth_pct is a yearly rate, applied compounding from the event
 *     start_date by whatever projection consumer renders the timeline.
 *
 * Source kinds emitted by this module:
 *   INSURANCE_MATURITY   one-time, tax-free          (LIC endowment / ULIP)
 *   ANNUITY              monthly, taxable            (LIC whole-life / SCSS)
 *   NPS_LUMPSUM          one-time, tax-free (60%)    (NPS Tier-I at retirement)
 *   NPS_ANNUITY          monthly, taxable (40%)      (NPS Tier-I ladder)
 *   PPF_MATURITY         one-time, tax-free
 *   VPF_MATURITY         one-time, tax-free          (lumped under PPF_MATURITY
 *                                                     since the schema doesn't
 *                                                     enumerate VPF — we use
 *                                                     PPF_MATURITY kind with a
 *                                                     "VPF" name prefix; TODO:
 *                                                     add VPF_MATURITY to the
 *                                                     enum if/when needed)
 *   NSC_MATURITY         one-time, taxable
 *   KVP_MATURITY         one-time, taxable
 *   SSY_MATURITY         one-time, tax-free
 *   RENTAL               monthly, taxable, growth 5%
 *   SALARY               monthly, taxable, growth 8%, ends at retirement age
 */

import type {
  CashflowFrequency,
  CashflowSourceKind,
  CashflowTaxTreatment,
  EpfAccount,
  ForexDeposit,
  InsurancePolicy,
  MutualFund,
  NPSAccount,
  NewCashflowEvent,
  RealEstate,
  RetirementAssumptions,
  SalaryIncomeRow,
  SIP,
  SmallSavingsAccount,
} from '@/db';

import { projectFutureValue } from './asset-projection';
// Import constants only — cashflow-derivation is a pure lib (no DB) so
// the constants module keeps it free of `db` dependencies and unit-
// testable without a Postgres connection.
import {
  DEFAULT_GROWTH_RATES,
  type AssetGrowthRates,
} from './asset-growth-rates-constants';

export interface DerivationInput {
  userId: string;
  /** ISO YYYY-MM-DD — typically new Date().toISOString().slice(0,10). */
  today: string;
  insurance: InsurancePolicy[];
  npsAccounts: NPSAccount[];
  smallSavings: SmallSavingsAccount[];
  realEstate: RealEstate[];
  salaryIncome: SalaryIncomeRow[];
  retirement: RetirementAssumptions | null;
  /** Active SIPs feeding mutual funds. Each becomes a recurring MONTHLY
   *  cashflow event for timeline visibility. Goal projection counts
   *  these via the asset-mapping path (yearlyContributionForGoal), so
   *  these are emitted with goalId=null to avoid double-count. */
  sips: SIP[];
  /** Joined for the SIP event label — "HSBC Value Fund SIP" not just
   *  "SIP #4". Indexed by mutualFundId for O(1) lookup. */
  mutualFunds: MutualFund[];
  /** EPF accounts. Sprint 5.5b — project EPF corpus + monthly
   *  contributions forward to retirement and emit one EPF_MATURITY
   *  event per account. Pass an empty array if not loaded; the
   *  function will simply emit no EPF events. */
  epfAccounts?: EpfAccount[];
  /** Forex deposits (Sprint 5.10). Each ACTIVE deposit with a future
   *  maturity_date becomes a one-time FOREX_MATURITY event at maturity.
   *  Foreign amounts converted to INR at derivation time via the rate
   *  map below. Deposits without a maturity_date (ongoing savings) are
   *  skipped — they have no payout event to surface. */
  forexDeposits?: ForexDeposit[];
  /** Live FX rates keyed by 3-letter ISO currency code, e.g.
   *  { USD: 95.27, EUR: 102.4 }. Caller pre-resolves via
   *  getFxRatesToInr(); missing keys cause the corresponding deposit
   *  to be skipped (we won't fabricate an event with an unknown
   *  exchange rate). */
  fxRates?: Record<string, number>;
  /** Per-class growth-rate overrides. When omitted, the
   *  DEFAULT_GROWTH_RATES from asset-growth-rates.ts are used.
   *  Sprint 5.5d — the calling route does a one-time getGrowthRates()
   *  read and passes the result here, keeping this lib pure (no DB). */
  growthRates?: AssetGrowthRates;
}

/* ─── helpers ───────────────────────────────────────────────────────── */

function addYears(iso: string, years: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function isFutureDate(iso: string | null | undefined, today: string): boolean {
  if (!iso) return false;
  return iso > today;
}

/**
 * Fractional years between two ISO dates. Used by the projection lib
 * which accepts non-integer horizons.
 */
function yearsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
  return Math.max(0, (b - a) / MS_PER_YEAR);
}

/**
 * INR formatter for projection-attribution notes. Keeps the rendered
 * note compact (lakh/crore short forms would be nicer but we don't
 * have an i18n abstraction in this lib yet).
 */
function rupees(paisa: number): string {
  return `₹${Math.round(paisa / 100).toLocaleString('en-IN')}`;
}

/**
 * Normalise an insurance annuity frequency into our MONTHLY/YEARLY axis.
 * QUARTERLY / HALF_YEARLY are stored as MONTHLY with the amount divided
 * so the per-month figure renders correctly.
 *
 * Returns { frequency, monthlyAmountPaisa } — the caller already has
 * the per-period amount, so we transform it here.
 */
function normaliseAnnuity(
  amountPerPeriodPaisa: number,
  frequency: string | null,
): { frequency: CashflowFrequency; amountPaisa: number } {
  switch ((frequency || '').toUpperCase()) {
    case 'YEARLY':
    case 'ANNUAL':
      return { frequency: 'YEARLY', amountPaisa: amountPerPeriodPaisa };
    case 'HALF_YEARLY':
      // Two payouts of `amount` per year ⇒ monthly equivalent = amount × 2 / 12
      return {
        frequency: 'MONTHLY',
        amountPaisa: Math.round((amountPerPeriodPaisa * 2) / 12),
      };
    case 'QUARTERLY':
      return {
        frequency: 'MONTHLY',
        amountPaisa: Math.round((amountPerPeriodPaisa * 4) / 12),
      };
    case 'MONTHLY':
    default:
      return { frequency: 'MONTHLY', amountPaisa: amountPerPeriodPaisa };
  }
}

/* ─── per-source derivation ─────────────────────────────────────────── */

function deriveInsuranceMaturities(
  policies: InsurancePolicy[],
  today: string,
  userId: string,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  for (const p of policies) {
    if (p.status && p.status !== 'ACTIVE') continue;
    // Only investment-style policies have meaningful maturities. Term
    // life has no payout if the holder survives. MONEY_BACK isn't in
    // the current enum but we accept it for forward-compat.
    const maturityTypes = ['ENDOWMENT', 'ULIP', 'WHOLE_LIFE', 'MONEY_BACK'];
    if (!maturityTypes.includes(p.policyType)) continue;
    if (!isFutureDate(p.maturityDate, today)) continue;
    const amount = p.maturityBenefit && p.maturityBenefit > 0
      ? p.maturityBenefit
      : p.sumAssured;
    if (!amount || amount <= 0) continue;

    out.push({
      userId,
      name: `${p.insurer} ${p.policyType} maturity`,
      sourceKind: 'INSURANCE_MATURITY' satisfies CashflowSourceKind,
      sourceId: p.id,
      startDate: p.maturityDate!,
      endDate: p.maturityDate,
      amountPaisa: amount,
      frequency: 'ONE_TIME' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      // LIC traditional endowment / WHOLE_LIFE maturity proceeds are
      // tax-free under Sec 10(10D). ULIP nuance ignored — premiums >2.5L/y
      // post-2021 are taxable; the user can flip the tax treatment
      // manually if it applies.
      taxTreatment: 'TAX_FREE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes: `Policy ${p.policyNumber} matures on ${p.maturityDate}`,
    });
  }
  return out;
}

function deriveInsuranceAnnuities(
  policies: InsurancePolicy[],
  userId: string,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  for (const p of policies) {
    if (p.status && p.status !== 'ACTIVE') continue;
    if (!p.annuityAmount || p.annuityAmount <= 0) continue;
    if (!p.annuityStartDate) continue;

    const { frequency, amountPaisa } = normaliseAnnuity(
      p.annuityAmount,
      p.annuityFrequency,
    );

    out.push({
      userId,
      // Use a distinct sourceKind so this row coexists with the
      // INSURANCE_MATURITY row from the same policy in the unique index.
      name: `${p.insurer} ${p.policyType} annuity`,
      sourceKind: 'ANNUITY' satisfies CashflowSourceKind,
      sourceId: p.id,
      startDate: p.annuityStartDate,
      endDate: null, // lifelong
      amountPaisa,
      frequency,
      // LIC traditional annuities are typically flat. The user can flip
      // growthPctPerYear to e.g. 5 if they have a bonus-linked plan.
      growthPctPerYear: 0,
      taxTreatment: 'TAXABLE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes: `Policy ${p.policyNumber} pays ${p.annuityFrequency || 'monthly'}`,
    });
  }
  return out;
}

function deriveNps(
  accounts: NPSAccount[],
  retirement: RetirementAssumptions | null,
  today: string,
  userId: string,
  growthRates: AssetGrowthRates,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  if (!retirement) return out;
  const yearsToRetirement = Math.max(0, retirement.targetAge - retirement.currentAge);
  const retirementDate = addYears(today, yearsToRetirement);
  const npsRate = growthRates.NPS;

  for (const acc of accounts) {
    if (acc.status && acc.status !== 'ACTIVE') continue;
    if (acc.tier !== 'TIER1') continue;
    const currentCorpus = acc.totalValue ?? 0;
    if (currentCorpus <= 0 && (acc.monthlyContributionPaisa ?? 0) <= 0) continue;

    // Project corpus forward: balance side (currentCorpus grows at NPS
    // rate) + contribution side (monthly contributions compounded).
    // The horizon honours per-account expectedMaturityDate when set
    // (a few users retire from NPS earlier than the global retirement
    // assumption); otherwise fall back to the global retirement target.
    const maturityIso = acc.expectedMaturityDate || retirementDate;
    const horizonYears = yearsBetween(today, maturityIso);
    const projection = projectFutureValue({
      currentBalancePaisa: currentCorpus,
      contributionPerPeriodPaisa: acc.monthlyContributionPaisa ?? 0,
      periodsPerYear: 12,
      annualRatePct: npsRate,
      yearsToProject: horizonYears,
    });
    const projectedCorpus = projection.totalPaisa;

    // 60/40 split applied on the PROJECTED corpus (not the current
    // balance) — this is the Sprint 5.5b correction.
    const lumpSum = Math.round(projectedCorpus * 0.6);
    out.push({
      userId,
      name: `NPS Tier-I lumpsum (${acc.accountNumber})`,
      sourceKind: 'NPS_LUMPSUM' satisfies CashflowSourceKind,
      sourceId: acc.id,
      startDate: maturityIso,
      endDate: maturityIso,
      amountPaisa: lumpSum,
      frequency: 'ONE_TIME' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      taxTreatment: 'TAX_FREE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes:
        `60% of projected corpus at retirement. ` +
        `Projected ${rupees(projectedCorpus)}: ${rupees(projection.balanceComponentPaisa)} ` +
        `from current corpus at ${npsRate}%, ${rupees(projection.contributionComponentPaisa)} ` +
        `from ${rupees(acc.monthlyContributionPaisa ?? 0)}/mo contributions ` +
        `over ${horizonYears.toFixed(1)} years.`,
    });

    // 40% mandatory annuity at 6% yield (provider quote varies).
    const annuityCorpus = projectedCorpus - lumpSum;
    const ANNUITY_RATE = 0.06;
    const monthlyAnnuity = Math.round((annuityCorpus * ANNUITY_RATE) / 12);
    out.push({
      userId,
      name: `NPS Tier-I annuity (${acc.accountNumber})`,
      sourceKind: 'NPS_ANNUITY' satisfies CashflowSourceKind,
      sourceId: acc.id,
      startDate: maturityIso,
      endDate: null,
      amountPaisa: monthlyAnnuity,
      frequency: 'MONTHLY' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      taxTreatment: 'TAXABLE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes:
        `40% of projected corpus (${rupees(annuityCorpus)}) × 6% annuity rate / 12. ` +
        `Recheck against actual provider quote at retirement.`,
    });
  }
  return out;
}

/**
 * EPF — project current corpus + ongoing contributions to retirement
 * and emit one EPF_MATURITY event per account (Sprint 5.5b new).
 *
 * Tax: EPF withdrawal at retirement is tax-free per sec 10(12) provided
 * the member has 5+ years of continuous service. By the time a user
 * reaches their target retirement age this is essentially always true,
 * so we mark TAX_FREE. (Mid-career rollovers / partial withdrawals are
 * out of scope here — those would need a separate event.)
 */
function deriveEpf(
  accounts: EpfAccount[],
  retirement: RetirementAssumptions | null,
  today: string,
  userId: string,
  growthRates: AssetGrowthRates,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  if (!retirement) return out;
  const yearsToRetirement = Math.max(0, retirement.targetAge - retirement.currentAge);
  const retirementDate = addYears(today, yearsToRetirement);
  const pfRate = growthRates.PF;

  for (const acc of accounts) {
    if (acc.isActive === false) continue;
    // We use total_balance which already aggregates
    // employee_balance + employer_balance + interest_balance per the
    // schema convention. (Some accounts have only the totalBalance
    // populated; trusting the aggregate keeps us robust to either case.)
    const currentBalance = acc.totalBalance ?? 0;
    const monthlyContrib = acc.monthlyContributionPaisa ?? 0;
    if (currentBalance <= 0 && monthlyContrib <= 0) continue;

    // PPF-extension dates only apply to PPF rows in epf_accounts (legacy
    // — most PPF lives in small_savings now). For EPF proper, retire at
    // the global retirement date.
    const maturityIso = acc.ppfMaturityDate || retirementDate;
    const horizonYears = yearsBetween(today, maturityIso);
    const projection = projectFutureValue({
      currentBalancePaisa: currentBalance,
      contributionPerPeriodPaisa: monthlyContrib,
      periodsPerYear: 12,
      annualRatePct: pfRate,
      yearsToProject: horizonYears,
    });

    if (projection.totalPaisa <= 0) continue;

    out.push({
      userId,
      name: `${acc.accountType} maturity (${acc.accountNumber ?? acc.accountHolder})`,
      sourceKind: 'EPF_MATURITY' satisfies CashflowSourceKind,
      sourceId: acc.id,
      startDate: maturityIso,
      endDate: maturityIso,
      amountPaisa: projection.totalPaisa,
      frequency: 'ONE_TIME' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      // EPF withdrawal at retirement (5+ years service) is tax-free.
      taxTreatment: 'TAX_FREE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes:
        `Projected ${rupees(projection.totalPaisa)} at retirement: ` +
        `${rupees(projection.balanceComponentPaisa)} from current corpus at ${pfRate}%, ` +
        `${rupees(projection.contributionComponentPaisa)} from ${rupees(monthlyContrib)}/mo ` +
        `contributions over ${horizonYears.toFixed(1)} years. Tax-free at retirement (5+ yrs service).`,
    });
  }
  return out;
}

function deriveSmallSavings(
  accounts: SmallSavingsAccount[],
  _retirement: RetirementAssumptions | null,
  today: string,
  userId: string,
  growthRates: AssetGrowthRates,
): NewCashflowEvent[] {
  // _retirement reserved for future per-scheme retirement-anchored
  // logic (e.g., PPF extension blocks based on age). Currently each
  // small-savings scheme uses its own maturityDate.
  const out: NewCashflowEvent[] = [];

  // Mapping from scheme → (sourceKind, taxTreatment). SCSS pays out
  // quarterly during the term so it's modelled as ANNUITY, not a
  // maturity event.
  const KIND_BY_SCHEME: Record<
    SmallSavingsAccount['schemeType'],
    { kind: CashflowSourceKind; tax: CashflowTaxTreatment } | null
  > = {
    PPF:  { kind: 'PPF_MATURITY',  tax: 'TAX_FREE' },
    VPF:  { kind: 'PPF_MATURITY',  tax: 'TAX_FREE' }, // see file header note
    NSC:  { kind: 'NSC_MATURITY',  tax: 'TAXABLE' },
    KVP:  { kind: 'KVP_MATURITY',  tax: 'TAXABLE' },
    SSY:  { kind: 'SSY_MATURITY',  tax: 'TAX_FREE' },
    SCSS: null, // handled separately as ANNUITY below
  };

  for (const acc of accounts) {
    if (acc.status === 'CLOSED' || acc.status === 'MATURED') continue;

    if (acc.schemeType === 'SCSS') {
      // SCSS interest is paid quarterly. We normalise to monthly so it
      // sits next to other ANNUITY-style cashflows.
      const annualInterestPaisa = Math.round(
        (acc.currentBalancePaisa * acc.interestRatePercent) / 100,
      );
      const monthlyPaisa = Math.round(annualInterestPaisa / 12);
      if (monthlyPaisa > 0) {
        out.push({
          userId,
          name: `SCSS payout (${acc.accountNumber})`,
          sourceKind: 'ANNUITY' satisfies CashflowSourceKind,
          sourceId: acc.id,
          startDate: acc.openingDate,
          endDate: acc.maturityDate,
          amountPaisa: monthlyPaisa,
          frequency: 'MONTHLY' satisfies CashflowFrequency,
          growthPctPerYear: 0,
          taxTreatment: 'TAXABLE' satisfies CashflowTaxTreatment,
          autoDerived: true,
          notes: `Quarterly interest payouts on SCSS principal — normalised to monthly`,
        });
      }
      continue;
    }

    const meta = KIND_BY_SCHEME[acc.schemeType];
    if (!meta) continue;
    if (!isFutureDate(acc.maturityDate, today)) continue;
    if (acc.currentBalancePaisa <= 0 && (acc.periodicContributionPaisa ?? 0) <= 0) continue;

    // Per-scheme rate priority:
    //   1. Per-instrument interest_rate_percent (govt-set rate locked
    //      at account opening — the closest thing to truth we have).
    //   2. SMALL_SAVINGS class rate from asset-growth-rates as a fallback
    //      when the instrument's rate is zero / unset.
    const ratePct =
      acc.interestRatePercent > 0
        ? acc.interestRatePercent
        : growthRates.SMALL_SAVINGS;

    const horizonYears = yearsBetween(today, acc.maturityDate);

    // Compute the effective contribution horizon per scheme:
    //   • PPF / VPF — contribute until maturity (full horizon).
    //   • SSY — contributions stop at child age 14 (then the corpus
    //           continues to grow but no new deposits). We approximate
    //           by capping years at min(horizonYears, 14). The user
    //           can refine this on the detail page if it matters.
    //   • NSC / KVP — lumpsum schemes. Even if a non-zero periodic
    //           contribution is recorded, it shouldn't apply post-open.
    //           We zero out the contribution stream here so the
    //           projection is pure compound interest on principal.
    let contributionPerPeriod = acc.periodicContributionPaisa ?? 0;
    let contributionYears = horizonYears;
    if (acc.schemeType === 'NSC' || acc.schemeType === 'KVP') {
      contributionPerPeriod = 0;
    } else if (acc.schemeType === 'SSY') {
      // Simplification noted: contribution years capped at 14 (SSY
      // rule). For high precision we'd need the child's DOB + age-14
      // arithmetic per beneficiary.
      contributionYears = Math.min(horizonYears, 14);
    }

    // For SSY when contributionYears < horizonYears we run TWO
    // projections: (a) contribution stream up to contributionYears,
    // (b) compound the resulting corpus from contributionYears to
    // maturity at the same rate, no further deposits.
    let projectedPaisa = 0;
    let breakdownNote: string;
    const periodsPerYear: 1 | 12 =
      acc.contributionFrequency === 'YEARLY' ? 1 : 12;

    if (contributionYears < horizonYears) {
      const phaseA = projectFutureValue({
        currentBalancePaisa: acc.currentBalancePaisa,
        contributionPerPeriodPaisa: contributionPerPeriod,
        periodsPerYear,
        annualRatePct: ratePct,
        yearsToProject: contributionYears,
      });
      const phaseB = projectFutureValue({
        currentBalancePaisa: phaseA.totalPaisa,
        contributionPerPeriodPaisa: 0,
        periodsPerYear,
        annualRatePct: ratePct,
        yearsToProject: horizonYears - contributionYears,
      });
      projectedPaisa = phaseB.totalPaisa;
      breakdownNote =
        `Projected ${rupees(projectedPaisa)} at ${acc.maturityDate}: ` +
        `${rupees(phaseA.balanceComponentPaisa)} from current balance + ` +
        `${rupees(phaseA.contributionComponentPaisa)} from ${rupees(contributionPerPeriod)}/` +
        `${periodsPerYear === 12 ? 'mo' : 'yr'} contributions for ${contributionYears.toFixed(1)}y, ` +
        `then compounded at ${ratePct}% for the remaining ${(horizonYears - contributionYears).toFixed(1)}y. ` +
        `(SSY contributions stop at child age 14 — approximated.)`;
    } else {
      const proj = projectFutureValue({
        currentBalancePaisa: acc.currentBalancePaisa,
        contributionPerPeriodPaisa: contributionPerPeriod,
        periodsPerYear,
        annualRatePct: ratePct,
        yearsToProject: horizonYears,
      });
      projectedPaisa = proj.totalPaisa;
      const contribNote =
        contributionPerPeriod > 0
          ? `${rupees(proj.contributionComponentPaisa)} from ${rupees(contributionPerPeriod)}/` +
            `${periodsPerYear === 12 ? 'mo' : 'yr'} contributions`
          : `no recurring contributions (lumpsum scheme)`;
      breakdownNote =
        `Projected ${rupees(projectedPaisa)} at ${acc.maturityDate}: ` +
        `${rupees(proj.balanceComponentPaisa)} from current balance at ${ratePct}%, ${contribNote} ` +
        `over ${horizonYears.toFixed(1)} years.`;
    }

    out.push({
      userId,
      name: `${acc.schemeType} maturity (${acc.accountNumber})`,
      sourceKind: meta.kind,
      sourceId: acc.id,
      startDate: acc.maturityDate,
      endDate: acc.maturityDate,
      amountPaisa: projectedPaisa,
      frequency: 'ONE_TIME' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      taxTreatment: meta.tax,
      autoDerived: true,
      notes: breakdownNote,
    });
  }
  return out;
}

/**
 * Sprint 5.12 — compute the ISO end-date for a rental stream given the
 * property's retirement intent. Returns null when the stream runs
 * open-ended (no end date stored on the event row).
 *
 *   • self_occupied — caller skips emission entirely (no event)
 *   • sell          — rental terminates at the retirement year; the
 *                     property is liquidated then so income stops too
 *   • rental_only   — open-ended (null) — kept forever, generates
 *                     income post-retirement
 *
 * Helper exists so the caller's loop stays focused on the per-row
 * decision; expressed as a small pure function for trivial unit
 * testability if/when we add tests for this lib.
 */
function rentalEndDate(
  treatment: RealEstate['retirementTreatment'],
  retirementDate: string | null,
): string | null {
  if (treatment === 'rental_only') return null;
  if (treatment === 'sell') return retirementDate;
  // self_occupied is filtered before this is called; defensive null
  // makes the function total.
  return null;
}

function deriveRentalIncome(
  properties: RealEstate[],
  today: string,
  userId: string,
  retirement: RetirementAssumptions | null,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];

  // Sprint 5.12 — rental stream lifecycle is keyed off the property's
  // retirement_treatment. We compute the retirement-year cutoff once
  // for sell-mode properties (rental_only uses null = open-ended;
  // self_occupied is skipped before we reach this point).
  const retirementDate = retirement
    ? addYears(today, Math.max(0, retirement.targetAge - retirement.currentAge))
    : null;

  for (const p of properties) {
    if (p.status !== 'OWNED' && p.status !== 'RENTED') continue;
    if (!p.monthlyRent || p.monthlyRent <= 0) continue;
    const treatment = p.retirementTreatment ?? 'sell';
    // self_occupied — no rental event regardless of monthly_rent. The
    // user has signalled "I live here," so any stale monthly_rent
    // value should not surface as income on the cashflow timeline.
    if (treatment === 'self_occupied') continue;

    const endDate = rentalEndDate(treatment, retirementDate);
    const lifecycleNote =
      treatment === 'sell'
        ? '(ends at retirement — property is sold then)'
        : '(kept indefinitely — rental_only)';
    const tenantNote = p.rentTenantName ? `Tenant: ${p.rentTenantName}` : '';
    const combinedNote = tenantNote
      ? `${tenantNote}. ${lifecycleNote}`
      : lifecycleNote;

    out.push({
      userId,
      name: `Rental — ${p.propertyName}`,
      sourceKind: 'RENTAL' satisfies CashflowSourceKind,
      sourceId: p.id,
      startDate: p.rentStartDate || today,
      endDate,
      amountPaisa: p.monthlyRent,
      frequency: 'MONTHLY' satisfies CashflowFrequency,
      // TODO: a real_estate.rent_escalation_pct column would be the
      // right home for this. Default 5% reflects typical Indian rental
      // escalator clauses.
      growthPctPerYear: 5,
      taxTreatment: 'TAXABLE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes: combinedNote,
    });
  }
  return out;
}

function deriveSalary(
  rows: SalaryIncomeRow[],
  retirement: RetirementAssumptions | null,
  today: string,
  userId: string,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  if (!rows.length || !retirement) return out;

  // Take the most-recent FY's salary as the "current" baseline. Each
  // employer becomes a separate event so manual overrides per employer
  // remain independent.
  const sortedByFy = [...rows].sort((a, b) =>
    b.financialYear.localeCompare(a.financialYear),
  );
  const seenEmployers = new Set<string>();
  const latestPerEmployer: SalaryIncomeRow[] = [];
  for (const r of sortedByFy) {
    const key = `${r.employerName}|${r.employerTan}`;
    if (seenEmployers.has(key)) continue;
    seenEmployers.add(key);
    latestPerEmployer.push(r);
  }

  const yearsToRetirement = Math.max(0, retirement.targetAge - retirement.currentAge);
  const endDate = addYears(today, yearsToRetirement);

  for (const r of latestPerEmployer) {
    // Gross monthly take-home approximation. We can't strictly compute
    // net (would need TDS-by-month) so we use taxableSalary ÷ 12 as a
    // reasonable proxy — the user can override on the event row.
    const monthlyPaisa = Math.round(r.taxableSalaryPaisa / 12);
    if (monthlyPaisa <= 0) continue;
    out.push({
      userId,
      name: `Salary — ${r.employerName}`,
      sourceKind: 'SALARY' satisfies CashflowSourceKind,
      sourceId: r.id,
      startDate: today,
      endDate,
      amountPaisa: monthlyPaisa,
      frequency: 'MONTHLY' satisfies CashflowFrequency,
      growthPctPerYear: 8, // typical annual increment
      taxTreatment: 'TAXABLE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes: `Based on FY ${r.financialYear} Form 16; ends at retirement (age ${retirement.targetAge}).`,
    });
  }
  return out;
}

/* ─── public entry point ────────────────────────────────────────────── */

/**
 * SIP contributions — emit one MONTHLY event per active SIP. Surfaces
 * the user's ongoing investment commitments on the unified cashflow
 * timeline ("I'm putting ₹36k/mo into MFs indefinitely") alongside
 * income inflows. Lifelong by convention unless the SIP carries an
 * end_date (rare — most SIPs run until manually stopped).
 *
 * Goal projection counts SIPs via the asset-mapping path
 * (goal-corpus.ts → yearlyContributionForGoal). To prevent
 * double-counting we emit with goalId=null — the SIP event is timeline-
 * visibility only, not a contributor to goal demand resolution.
 */
function deriveSips(sips: SIP[], mfs: MutualFund[], userId: string): NewCashflowEvent[] {
  const mfById = new Map(mfs.map((m) => [m.id, m]));
  return sips
    .filter((s) => s.status === 'ACTIVE' && s.monthlyAmount > 0)
    .map((s) => {
      const mf = mfById.get(s.mutualFundId);
      const fundLabel = mf?.schemeName ?? `Fund #${s.mutualFundId}`;
      // Sprint 5.7 — surface the linked MF's category in the event's
      // notes so timeline consumers can see which subclass-rate bucket
      // the underlying fund belongs to. The math here is unchanged —
      // SIPs are flat outflows from the user's pocket; the per-category
      // growth math runs in goal/retirement projections that consume
      // the linked MF, not in cashflow events themselves.
      const category = mf?.category ?? 'UNKNOWN';
      const categoryLabel =
        category === 'UNKNOWN' ? '' : ` · ${category[0]}${category.slice(1).toLowerCase()}`;
      return {
        userId,
        name: `SIP — ${fundLabel}${categoryLabel}`,
        sourceKind: 'SIP' satisfies CashflowSourceKind,
        sourceId: s.id,
        startDate: s.startDate,
        endDate: s.endDate ?? null,
        amountPaisa: s.monthlyAmount,
        frequency: 'MONTHLY' satisfies CashflowFrequency,
        // SIPs are a forward commitment in nominal rupees. No growth on
        // the SIP amount itself (the underlying fund grows; the SIP
        // outflow is fixed). If the user step-ups their SIP they can
        // edit the event manually.
        growthPctPerYear: 0,
        // SIPs are post-tax outflows from the user's pocket; not
        // income, not subject to TDS at this layer. Mark TAX_FREE so
        // future tax-aware projections don't apply a slab to them.
        taxTreatment: 'TAX_FREE' satisfies CashflowTaxTreatment,
        autoDerived: true,
        notes: `₹${(s.monthlyAmount / 100).toLocaleString('en-IN')} monthly SIP — auto-counted via MF asset mapping for goals (category: ${category})`,
      };
    });
}

/**
 * Sprint 5.10e — forex deposit maturities.
 *
 * Each ACTIVE deposit with a future `maturity_date` becomes a one-time
 * FOREX_MATURITY event at the maturity date. The INR amount is the
 * foreign principal converted at the rate present at derivation time.
 *
 * Documented simplification: we do NOT project future FX rates. The
 * INR payout is computed at TODAY's rate, then surfaced AT maturity.
 * Forecasting USD/INR is genuinely hard (PPP vs interest-rate parity
 * argue different directions); a flat-rate projection is the most
 * honest "we don't know" stance. The asset-class growth rate (FOREX:
 * 5%) handles the long-run drift in the projection layer separately.
 *
 * Deposits without a maturity_date (ongoing savings, "rainy day USD
 * stash") are skipped — they have no payout event. Their balance still
 * shows on the net-worth tile via the live-rate path.
 *
 * Currencies with no live rate in `fxRates` are also skipped (we won't
 * fabricate an event with an unknown exchange rate) — the UI surfaces
 * "rate unavailable" so the user can refresh and re-derive.
 */
function deriveForexDeposits(
  deposits: ForexDeposit[],
  today: string,
  userId: string,
  fxRates: Record<string, number>,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  for (const d of deposits) {
    if (d.status !== 'ACTIVE') continue;
    if (!isFutureDate(d.maturityDate, today)) continue;
    const rate = fxRates[d.currencyCode.toUpperCase()];
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const amount = parseFloat(d.amountInCurrency as unknown as string);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const amountPaisa = Math.round(amount * rate * 100);
    out.push({
      userId,
      name: `Forex maturity — ${d.bankName} (${d.currencyCode})`,
      sourceKind: 'FOREX_MATURITY' as CashflowSourceKind,
      sourceId: d.id,
      startDate: d.maturityDate!, // filter guarantees non-null + future
      endDate: null,
      amountPaisa,
      frequency: 'ONE_TIME' as CashflowFrequency,
      growthPctPerYear: 0, // see lib-level note above re: flat FX rate
      // TAXABLE proxy — foreign-deposit interest is generally taxable
      // for residents, and any FX gain on principal is too. The exact
      // breakdown depends on NRE vs NRO + residency; TAXABLE here
      // nudges the planning layer to plan for it.
      taxTreatment: 'TAXABLE' as CashflowTaxTreatment,
      autoDerived: true,
      notes: `${amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${d.currencyCode} at live rate ₹${rate.toFixed(4)}/${d.currencyCode}. INR amount fixed at derivation time (no FX projection)`,
    });
  }
  return out;
}

/**
 * Derive cashflow event candidates from a snapshot of the user's
 * portfolio. Pure: no DB, no time-of-day dependence except `today`.
 *
 * Each event's (sourceKind, sourceId) pair is unique per user, so the
 * caller can upsert with ON CONFLICT DO NOTHING and trust this set as
 * the canonical "what the auto-derive layer thinks is going on".
 */
export function deriveCashflowEvents(input: DerivationInput): NewCashflowEvent[] {
  const {
    userId,
    today,
    insurance,
    npsAccounts,
    smallSavings,
    realEstate,
    salaryIncome,
    retirement,
    sips,
    mutualFunds,
    epfAccounts,
    forexDeposits,
    fxRates,
    growthRates,
  } = input;
  // Fall back to compile-time defaults if the caller didn't preload
  // per-user rates. Production callers (api/cashflow-events/derive)
  // always preload; this default keeps tests / dev tools simple.
  const rates: AssetGrowthRates = growthRates ?? { ...DEFAULT_GROWTH_RATES };
  return [
    ...deriveInsuranceMaturities(insurance, today, userId),
    ...deriveInsuranceAnnuities(insurance, userId),
    ...deriveNps(npsAccounts, retirement, today, userId, rates),
    ...deriveEpf(epfAccounts ?? [], retirement, today, userId, rates),
    ...deriveSmallSavings(smallSavings, retirement, today, userId, rates),
    ...deriveRentalIncome(realEstate, today, userId, retirement),
    ...deriveSalary(salaryIncome, retirement, today, userId),
    ...deriveSips(sips, mutualFunds, userId),
    ...deriveForexDeposits(forexDeposits ?? [], today, userId, fxRates ?? {}),
  ];
}
