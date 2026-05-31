/**
 * Goal Projection Engine — Sprint 3.5 Phase 3.
 *
 * Pure functions, no DB. Year-by-year corpus simulation answering:
 *   "If I keep contributing X and my mapped assets grow at Y%, will
 *    this goal be funded when it's due?"
 *
 * The engine runs a calendar-year (Jan-Dec) walk from `today` through
 * the last disbursement year + a one-year buffer. Each year computes:
 *
 *   growth         = opening × expected_return%
 *   inflows        = baseline contribution + earmarked cashflow events
 *   demand         = year's share of disbursement schedule
 *   closing        = max(0, opening + growth + inflows − demand)
 *   shortfall      = max(0, demand − (opening + growth + inflows))
 *
 * Why calendar-year (Jan-Dec) over Indian-FY (Apr-Mar): the demand
 * schedule (target_date, disbursement_start_date) is user-entered ISO
 * dates with no FY anchoring; calendar years make the math simpler and
 * stay correct against those inputs. If we ever surface FY-aligned
 * projections elsewhere we can change the bucket boundaries — the
 * shape of the math is the same.
 *
 * All amounts here are PAISA (integer). Callers convert to/from rupees
 * at the API/UI layer.
 */

import type { FinancialGoal, CashflowEvent } from '@/db';

export interface GoalProjectionInput {
  goal: FinancialGoal;
  /**
   * Sum of current values (paisa) of all assets mapped to this goal
   * via savings_asset_inclusion.included = true. Caller computes and
   * passes in.
   */
  initialCorpusPaisa: number;
  /**
   * Aggregate yearly contributions to this goal from recurring SIPs +
   * earmarked monthly/yearly inflows. Caller pre-computes; we don't
   * walk per-month here.
   */
  yearlyContributionPaisa: number;
  /**
   * Optional: cashflow_events earmarked to this goal (goal_id matches).
   * One-time events land in their year; recurring events are summed
   * to a per-year inflow. growth_pct_per_year compounds the event
   * amount forward from its start_date.
   */
  earmarkedEvents: CashflowEvent[];
  /** ISO date — engine projects from today forward. */
  today: string;
}

export interface ProjectionYear {
  /** Calendar year. */
  year: number;
  /** Corpus at start of year (paisa). */
  openingCorpus: number;
  /** Return earned during year (paisa). */
  growth: number;
  /** Contributions + earmarked events landing this year (paisa). */
  inflows: number;
  /** Goal disbursements this year (paisa). */
  demand: number;
  /** Corpus at end of year (paisa). */
  closingCorpus: number;
  /** max(0, demand − (opening + growth + inflows)) — funding gap. */
  shortfall: number;
}

export interface GoalProjection {
  goalId: number;
  goalName: string;
  /** Years from today to the last disbursement year. */
  horizonYears: number;
  /** True if shortfall === 0 across every disbursement year. */
  fundedAtTargetDate: boolean;
  /** Sum of demand across all years (paisa). */
  totalDemandPaisa: number;
  /** Sum of inflows across all years (paisa). */
  totalInflowsPaisa: number;
  yearByYear: ProjectionYear[];
  /**
   * Monthly contribution from today that makes shortfall = 0 in every
   * disbursement year, holding everything else equal. Null if goal
   * already funded or no target date / SWP start. Found via binary
   * search; engine caps iterations at 30.
   */
  monthlyContributionRequiredPaisa: number | null;
}

/* ──────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ──────────────────────────────────────────────────────────────────── */

function yearOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function isoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Determines disbursement schedule end year. LUMPSUM uses target_date.
 * SWPs use disbursement_start_date + disbursement_years. Falls back to
 * target_date when start_date isn't set (legacy rows).
 */
function disbursementEndYear(goal: FinancialGoal): number | null {
  if (goal.disbursementType === 'LUMPSUM') {
    return yearOf(goal.targetDate);
  }
  const startY =
    yearOf(goal.disbursementStartDate) ?? yearOf(goal.targetDate);
  if (startY === null) return null;
  const span = goal.disbursementYears ?? 1;
  return startY + Math.max(0, span - 1);
}

/**
 * Returns the demand for a given calendar year, in paisa.
 */
function demandForYear(goal: FinancialGoal, year: number): number {
  if (goal.disbursementType === 'LUMPSUM') {
    const targetY = yearOf(goal.targetDate);
    return targetY === year ? goal.targetAmount : 0;
  }
  // SWP flavours
  const startY =
    yearOf(goal.disbursementStartDate) ?? yearOf(goal.targetDate);
  if (startY === null) return 0;
  const span = goal.disbursementYears ?? 1;
  if (year < startY || year >= startY + span) return 0;

  const baseline = goal.disbursementAmountPerYrPaisa ?? 0;
  if (baseline <= 0) return 0;

  if (goal.disbursementType === 'FIXED_PERIOD_SWP') {
    return baseline;
  }
  // INFLATION_SWP — grow by growth_pct_per_yr from start_date
  const growth = goal.growthPctPerYr ?? 0;
  const offset = year - startY;
  return Math.round(baseline * Math.pow(1 + growth / 100, offset));
}

/**
 * Returns earmarked event inflows landing in a given calendar year.
 * One-time events land in their year. Recurring events contribute
 * 12× (monthly) or 1× (yearly) the amount, compounded forward by
 * growth_pct_per_year from their start_date.
 */
function earmarkedInflowsForYear(
  events: CashflowEvent[],
  year: number,
): number {
  let total = 0;
  const yearStart = new Date(`${year}-01-01`);
  const yearEnd = new Date(`${year}-12-31`);

  for (const ev of events) {
    const startDate = isoDate(ev.startDate);
    if (!startDate) continue;
    const endDate = isoDate(ev.endDate);

    // Skip if entirely outside the year
    if (startDate > yearEnd) continue;
    if (endDate && endDate < yearStart) continue;

    const startY = startDate.getFullYear();
    const yearsSinceStart = Math.max(0, year - startY);
    const growthFactor = Math.pow(
      1 + (ev.growthPctPerYear ?? 0) / 100,
      yearsSinceStart,
    );
    const adjustedAmount = ev.amountPaisa * growthFactor;

    if (ev.frequency === 'ONE_TIME') {
      if (startDate.getFullYear() === year) {
        total += Math.round(adjustedAmount);
      }
    } else if (ev.frequency === 'MONTHLY') {
      total += Math.round(adjustedAmount * 12);
    } else if (ev.frequency === 'YEARLY') {
      total += Math.round(adjustedAmount);
    }
  }
  return total;
}

/**
 * Runs the corpus simulation for a given baseline contribution
 * (paisa/year). Returned shortfall total tells the binary search
 * whether the contribution is enough.
 */
function simulate(
  goal: FinancialGoal,
  startYear: number,
  endYear: number,
  initialCorpus: number,
  yearlyContribution: number,
  earmarkedEvents: CashflowEvent[],
  expectedReturnPct: number,
): { years: ProjectionYear[]; totalShortfall: number; totalDemand: number; totalInflows: number } {
  const years: ProjectionYear[] = [];
  let corpus = initialCorpus;
  let totalShortfall = 0;
  let totalDemand = 0;
  let totalInflows = 0;

  for (let y = startYear; y <= endYear; y++) {
    const opening = corpus;
    const growth = Math.round((opening * expectedReturnPct) / 100);
    const earmarked = earmarkedInflowsForYear(earmarkedEvents, y);
    const inflows = yearlyContribution + earmarked;
    const demand = demandForYear(goal, y);

    const available = opening + growth + inflows;
    const shortfall = Math.max(0, demand - available);
    const closing = Math.max(0, available - demand);

    years.push({
      year: y,
      openingCorpus: opening,
      growth,
      inflows,
      demand,
      closingCorpus: closing,
      shortfall,
    });

    totalShortfall += shortfall;
    totalDemand += demand;
    totalInflows += inflows;
    corpus = closing;
  }

  return { years, totalShortfall, totalDemand, totalInflows };
}

/* ──────────────────────────────────────────────────────────────────── */
/* Public API                                                          */
/* ──────────────────────────────────────────────────────────────────── */

export function projectGoal(input: GoalProjectionInput): GoalProjection {
  const {
    goal,
    initialCorpusPaisa,
    yearlyContributionPaisa,
    earmarkedEvents,
    today,
  } = input;

  const todayDate = isoDate(today) ?? new Date();
  const startYear = todayDate.getFullYear();
  const endYear = disbursementEndYear(goal);
  // +1 buffer year so the user can see the post-target corpus state.
  const lastYear = endYear !== null ? endYear + 1 : startYear + 1;
  const horizonYears = Math.max(1, lastYear - startYear);

  const expectedReturnPct = goal.expectedReturnPct ?? 8;

  const sim = simulate(
    goal,
    startYear,
    lastYear,
    initialCorpusPaisa,
    yearlyContributionPaisa,
    earmarkedEvents,
    expectedReturnPct,
  );

  const fundedAtTargetDate = sim.totalShortfall === 0;

  // ─── Binary search for required monthly contribution ────────────
  // We only run this if there's a real disbursement schedule to fund
  // against. Otherwise the answer is undefined.
  let monthlyContributionRequiredPaisa: number | null = null;
  if (endYear !== null && endYear >= startYear) {
    if (sim.totalShortfall === 0) {
      // Already funded with current contribution — no extra needed
      // beyond what they're doing. Returning null signals "you're set".
      monthlyContributionRequiredPaisa = null;
    } else {
      // Binary search yearly contribution that drives shortfall → 0.
      // Lower bound: 0. Upper bound: full target / 1 year (generous).
      let lo = 0;
      // Pick an upper bound large enough to definitely fund the goal.
      // Total demand divided by 1 year of contribution is overkill but
      // safe; the search converges fast either way.
      let hi = Math.max(sim.totalDemand, goal.targetAmount, 1) + 1;
      for (let iter = 0; iter < 30; iter++) {
        const mid = Math.floor((lo + hi) / 2);
        const probe = simulate(
          goal,
          startYear,
          lastYear,
          initialCorpusPaisa,
          mid,
          earmarkedEvents,
          expectedReturnPct,
        );
        if (probe.totalShortfall === 0) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
        if (hi - lo <= 1) break;
      }
      // hi is the smallest yearly contribution that funds the goal.
      // Convert to monthly. Subtract what they're already contributing
      // so the answer is the *additional* monthly need on top of
      // current SIPs/earmarks. If current contribution already covers,
      // we wouldn't have entered this branch.
      const requiredYearly = hi;
      const additionalYearly = Math.max(
        0,
        requiredYearly - yearlyContributionPaisa,
      );
      monthlyContributionRequiredPaisa = Math.round(additionalYearly / 12);
    }
  }

  return {
    goalId: goal.id,
    goalName: goal.name,
    horizonYears,
    fundedAtTargetDate,
    totalDemandPaisa: sim.totalDemand,
    totalInflowsPaisa: sim.totalInflows,
    yearByYear: sim.years,
    monthlyContributionRequiredPaisa,
  };
}
