/**
 * Asset projection — pure FV math for retirement-class assets.
 *
 * Combines two streams under compound interest:
 *
 *   • The PRESENT VALUE side: an existing balance growing at a known
 *     rate. Standard future-value formula:
 *
 *         balance_fv = PV × (1 + r_period)^n_periods
 *
 *   • The ANNUITY side: a recurring contribution paid every period
 *     (typically monthly into NPS/EPF/PPF). Standard future-value of an
 *     annuity, ordinary (END) timing by default:
 *
 *         contribution_fv = PMT × ((1 + r_period)^n_periods − 1) / r_period
 *
 *     If the user is contributing at the START of each period
 *     (annuity-due), multiply by (1 + r_period) — gives one extra
 *     compounding period to every contribution.
 *
 * The two components are returned separately so callers can show
 * attribution: "₹X comes from the current balance growing, ₹Y comes
 * from the ongoing contribution stream". This matters because the
 * contribution side is the lever the user actually controls.
 *
 * Edge cases:
 *   • r = 0       → contribution_fv reduces to PMT × n_periods (no
 *                   division by zero). Balance side stays PV.
 *   • n_periods=0 → balance_fv = PV, contribution_fv = 0.
 *   • negative contribution / balance → math still works but caller
 *                                      should validate inputs.
 *
 * All amounts are in PAISA (integer). Rates are annual percentages
 * (e.g. 8.25 not 0.0825). No DB, no IO.
 */

export interface ProjectionInput {
  /** Current balance in paisa (PV). */
  currentBalancePaisa: number;
  /** Contribution per period in paisa (PMT). 0 = balance-only projection. */
  contributionPerPeriodPaisa: number;
  /** 1 = yearly contributions, 12 = monthly. The compounding frequency
   *  matches: monthly contributions compound monthly. */
  periodsPerYear: 1 | 12;
  /** Annual rate as a percentage (e.g. 8.25). */
  annualRatePct: number;
  /** Number of years to project forward. May be fractional. */
  yearsToProject: number;
  /** END (ordinary) — pay at the end of each period. BEGIN (annuity-due)
   *  — pay at the start. EPF/NPS are typically END (salary credited
   *  end-of-month then deduction); PPF lump deposits tend toward BEGIN
   *  (April 1st convention). Defaults to END. */
  contributionTiming?: 'BEGIN' | 'END';
}

export interface ProjectionResult {
  /** balance_fv + contribution_fv. */
  totalPaisa: number;
  /** PV × (1 + r_period)^n_periods, in paisa. */
  balanceComponentPaisa: number;
  /** Annuity future-value of the contribution stream, in paisa. */
  contributionComponentPaisa: number;
  /** Echoed for caller convenience (avoids them tracking it separately). */
  yearsProjected: number;
  /** Effective annual rate after compounding adjustments — for now this
   *  is just `annualRatePct` echoed back, but kept on the result so we
   *  can switch to nominal-vs-effective handling without breaking
   *  callers. */
  effectiveAnnualRatePct: number;
}

/**
 * Project a balance + contribution stream forward by `yearsToProject`
 * years using compound interest. Returns components separately so the
 * caller can show attribution.
 */
export function projectFutureValue(input: ProjectionInput): ProjectionResult {
  const {
    currentBalancePaisa,
    contributionPerPeriodPaisa,
    periodsPerYear,
    annualRatePct,
    yearsToProject,
    contributionTiming = 'END',
  } = input;

  // Degenerate horizon — no time = no growth.
  if (yearsToProject <= 0) {
    return {
      totalPaisa: currentBalancePaisa,
      balanceComponentPaisa: currentBalancePaisa,
      contributionComponentPaisa: 0,
      yearsProjected: 0,
      effectiveAnnualRatePct: annualRatePct,
    };
  }

  const rPeriod = annualRatePct / 100 / periodsPerYear;
  const nPeriods = periodsPerYear * yearsToProject;

  // Balance side: standard compound interest.
  const balanceComponentPaisa = Math.round(
    currentBalancePaisa * Math.pow(1 + rPeriod, nPeriods),
  );

  // Annuity side: future-value of regular contributions.
  let contributionComponentPaisa = 0;
  if (contributionPerPeriodPaisa > 0 && nPeriods > 0) {
    if (rPeriod === 0) {
      // 0% rate degenerates the annuity formula — money never grows,
      // so the FV is simply the sum of all contributions.
      contributionComponentPaisa = Math.round(
        contributionPerPeriodPaisa * nPeriods,
      );
    } else {
      const annuityFactor = (Math.pow(1 + rPeriod, nPeriods) - 1) / rPeriod;
      let fv = contributionPerPeriodPaisa * annuityFactor;
      if (contributionTiming === 'BEGIN') {
        // Annuity-due — each contribution gets one extra period of
        // compounding because it lands at the start of the period.
        fv = fv * (1 + rPeriod);
      }
      contributionComponentPaisa = Math.round(fv);
    }
  }

  return {
    totalPaisa: balanceComponentPaisa + contributionComponentPaisa,
    balanceComponentPaisa,
    contributionComponentPaisa,
    yearsProjected: yearsToProject,
    effectiveAnnualRatePct: annualRatePct,
  };
}
