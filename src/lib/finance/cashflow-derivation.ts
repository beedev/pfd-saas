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
  InsurancePolicy,
  NPSAccount,
  NewCashflowEvent,
  RealEstate,
  RetirementAssumptions,
  SalaryIncomeRow,
  SmallSavingsAccount,
} from '@/db';

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
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  if (!retirement) return out;
  const yearsToRetirement = Math.max(0, retirement.targetAge - retirement.currentAge);
  const retirementDate = addYears(today, yearsToRetirement);

  for (const acc of accounts) {
    if (acc.status && acc.status !== 'ACTIVE') continue;
    if (acc.tier !== 'TIER1') continue;
    const corpus = acc.totalValue ?? 0;
    if (corpus <= 0) continue;

    // 60% lump sum withdrawal — tax-free per current NPS rules.
    const lumpSum = Math.round(corpus * 0.6);
    out.push({
      userId,
      name: `NPS Tier-I lumpsum (${acc.accountNumber})`,
      sourceKind: 'NPS_LUMPSUM' satisfies CashflowSourceKind,
      sourceId: acc.id,
      startDate: acc.expectedMaturityDate || retirementDate,
      endDate: acc.expectedMaturityDate || retirementDate,
      amountPaisa: lumpSum,
      frequency: 'ONE_TIME' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      taxTreatment: 'TAX_FREE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes: '60% withdrawal of corpus at retirement (NPS rule)',
    });

    // 40% mandatory annuity. Approximation: 6% annual on the 40%
    // corpus, paid monthly. ANNUITY_RATE is a placeholder — actual
    // payout depends on the chosen annuity provider's quote.
    const annuityCorpus = corpus - lumpSum;
    const ANNUITY_RATE = 0.06;
    const monthlyAnnuity = Math.round((annuityCorpus * ANNUITY_RATE) / 12);
    out.push({
      userId,
      name: `NPS Tier-I annuity (${acc.accountNumber})`,
      sourceKind: 'NPS_ANNUITY' satisfies CashflowSourceKind,
      sourceId: acc.id,
      startDate: acc.expectedMaturityDate || retirementDate,
      endDate: null,
      amountPaisa: monthlyAnnuity,
      frequency: 'MONTHLY' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      taxTreatment: 'TAXABLE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes: `40% of corpus × 6% annuity rate / 12 — recheck against provider quote`,
    });
  }
  return out;
}

function deriveSmallSavings(
  accounts: SmallSavingsAccount[],
  today: string,
  userId: string,
): NewCashflowEvent[] {
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
    if (acc.currentBalancePaisa <= 0) continue;

    // Conservative: use the current balance rather than projecting
    // forward. The detail page already shows a projection — this is
    // the cashflow event "minimum maturity value".
    out.push({
      userId,
      name: `${acc.schemeType} maturity (${acc.accountNumber})`,
      sourceKind: meta.kind,
      sourceId: acc.id,
      startDate: acc.maturityDate,
      endDate: acc.maturityDate,
      amountPaisa: acc.currentBalancePaisa,
      frequency: 'ONE_TIME' satisfies CashflowFrequency,
      growthPctPerYear: 0,
      taxTreatment: meta.tax,
      autoDerived: true,
      notes: `Current balance at ${acc.maturityDate}; projection not applied (conservative).`,
    });
  }
  return out;
}

function deriveRentalIncome(
  properties: RealEstate[],
  today: string,
  userId: string,
): NewCashflowEvent[] {
  const out: NewCashflowEvent[] = [];
  for (const p of properties) {
    if (p.status !== 'OWNED' && p.status !== 'RENTED') continue;
    if (!p.monthlyRent || p.monthlyRent <= 0) continue;
    out.push({
      userId,
      name: `Rental — ${p.propertyName}`,
      sourceKind: 'RENTAL' satisfies CashflowSourceKind,
      sourceId: p.id,
      startDate: p.rentStartDate || today,
      endDate: null,
      amountPaisa: p.monthlyRent,
      frequency: 'MONTHLY' satisfies CashflowFrequency,
      // TODO: a real_estate.rent_escalation_pct column would be the
      // right home for this. Default 5% reflects typical Indian rental
      // escalator clauses.
      growthPctPerYear: 5,
      taxTreatment: 'TAXABLE' satisfies CashflowTaxTreatment,
      autoDerived: true,
      notes: p.rentTenantName ? `Tenant: ${p.rentTenantName}` : null,
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
 * Derive cashflow event candidates from a snapshot of the user's
 * portfolio. Pure: no DB, no time-of-day dependence except `today`.
 *
 * Each event's (sourceKind, sourceId) pair is unique per user, so the
 * caller can upsert with ON CONFLICT DO NOTHING and trust this set as
 * the canonical "what the auto-derive layer thinks is going on".
 */
export function deriveCashflowEvents(input: DerivationInput): NewCashflowEvent[] {
  const { userId, today, insurance, npsAccounts, smallSavings, realEstate, salaryIncome, retirement } = input;
  return [
    ...deriveInsuranceMaturities(insurance, today, userId),
    ...deriveInsuranceAnnuities(insurance, userId),
    ...deriveNps(npsAccounts, retirement, today, userId),
    ...deriveSmallSavings(smallSavings, today, userId),
    ...deriveRentalIncome(realEstate, today, userId),
    ...deriveSalary(salaryIncome, retirement, today, userId),
  ];
}
