'use client';

/**
 * Retirement Projection — driven by user-selected retirement assets.
 *
 * Replaces the prior "lump-sum all net worth" model with a per-asset picker:
 * NPS / PF / Annuity Policies / Insurance Maturity Ladder / Real Estate.
 * Each contributes to one of two streams: corpus at retirement (lumpsums) or
 * annual income at retirement (rentals + annuities + post-retirement
 * maturities).
 *
 *   netAnnualGap     = futureMonthlyExpense × 12 − annualIncomeAtRetirement
 *   corpusNeeded     = max(0, netAnnualGap × retirementDuration)
 *   gap              = max(0, corpusNeeded − corpusAtRetirement)
 *   requiredSIP      = gap / annuity-FV factor over months-to-retire
 */

import { useEffect, useState, useCallback, ReactNode, useMemo } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardContent,
  DataTable,
  Input,
  StatsDisplay,
} from '@dxp/ui';
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  Coins,
  Loader2,
  Sunset,
} from 'lucide-react';
import {
  LineChart,
  Line,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

import { CashflowTimeline } from '@/components/cashflow-timeline';

/* ─── types mirrored from /api/finance/retirement-assets ──────────────── */

type Mode = 'SELL' | 'RENTAL';

interface RetirementItem {
  id: number;
  label: string;
  sublabel?: string;
  valuePaisa: number;
  annualIncomePaisa?: number;
  maturityDate?: string | null;
  included: boolean;
  mode?: Mode;
  salePriceOverridePaisa?: number | null;
  npsLumpsumPct?: number;
  npsAnnuityRatePct?: number;
  expectedFutureRentPaisa?: number | null;
  /** Annuity-policy start date — when payouts actually begin. */
  startDate?: string | null;
}

type AssetClassKey =
  | 'NPS'
  | 'PF'
  | 'SMALL_SAVINGS'
  | 'ANNUITY_POLICIES'
  | 'INSURANCE_POLICIES'
  | 'REAL_ESTATE';

interface AssetClassRow {
  assetClass: AssetClassKey;
  label: string;
  basis: string;
  items: RetirementItem[];
}

/* ─── types mirrored from /api/cashflow-events ────────────────────────── */

type CashflowSourceKind =
  | 'INSURANCE_MATURITY' | 'ANNUITY' | 'PENSION' | 'NPS_LUMPSUM' | 'NPS_ANNUITY'
  | 'PPF_MATURITY' | 'SSY_MATURITY' | 'NSC_MATURITY' | 'KVP_MATURITY'
  | 'RENTAL' | 'SALARY' | 'BUSINESS' | 'INHERITANCE' | 'OTHER'
  | 'SIP';
type CashflowFrequency = 'ONE_TIME' | 'MONTHLY' | 'YEARLY';
type CashflowTaxTreatment = 'TAX_FREE' | 'TAXABLE' | 'TDS';

interface CashflowEvent {
  id: number;
  name: string;
  sourceKind: CashflowSourceKind;
  sourceId: number | null;
  startDate: string;
  endDate: string | null;
  amountPaisa: number;
  frequency: CashflowFrequency;
  growthPctPerYear: number;
  taxTreatment: CashflowTaxTreatment;
  autoDerived: boolean;
  notes: string | null;
}

const KIND_LABELS: Record<CashflowSourceKind, string> = {
  INSURANCE_MATURITY: 'Insurance maturity',
  ANNUITY: 'Annuity',
  PENSION: 'Pension',
  NPS_LUMPSUM: 'NPS lumpsum',
  NPS_ANNUITY: 'NPS annuity',
  PPF_MATURITY: 'PPF maturity',
  SSY_MATURITY: 'SSY maturity',
  NSC_MATURITY: 'NSC maturity',
  KVP_MATURITY: 'KVP maturity',
  RENTAL: 'Rental',
  SALARY: 'Salary',
  BUSINESS: 'Business',
  INHERITANCE: 'Inheritance',
  OTHER: 'Other',
  SIP: 'SIP contribution',
};

/** Source-kind chip color logic. TAX_FREE → success, TAXABLE → default,
 *  TDS → warning. Mirrors the /planning/cashflows page convention. */
function taxBadgeVariant(t: CashflowTaxTreatment): 'success' | 'warning' | 'default' {
  switch (t) {
    case 'TAX_FREE': return 'success';
    case 'TDS': return 'warning';
    case 'TAXABLE': return 'default';
  }
}

/* ─── small helpers ───────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--dxp-text)]">{label}</label>
      {children}
    </div>
  );
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatINRShort = (paisa: number) => {
  const cr = paisa / 10000000 / 100;
  if (Math.abs(cr) >= 1) return `₹${cr.toFixed(2)}Cr`;
  const l = paisa / 100000 / 100;
  if (Math.abs(l) >= 1) return `₹${l.toFixed(1)}L`;
  return `₹${(paisa / 100).toFixed(0)}`;
};

const fmtMonthYear = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

/* ─── page ────────────────────────────────────────────────────────────── */

export default function RetirementPage() {
  // Assumptions — defaults are placeholders; real values are loaded from the
  // server on mount so they stick across reloads / devices.
  const [currentAge, setCurrentAge] = useState(30);
  const [targetAge, setTargetAge] = useState(60);
  const [monthlyExpense, setMonthlyExpense] = useState(50000);
  const [inflation, setInflation] = useState(6);
  const [expectedReturn, setExpectedReturn] = useState(10);
  const [postRetirementReturn, setPostRetirementReturn] = useState(8);
  const [retirementDuration, setRetirementDuration] = useState(25);
  const [ladderStartAge, setLadderStartAge] = useState(60);
  // Three-bucket SWP — disabled by default; turn on to use the cascade model.
  const [bucketEnabled, setBucketEnabled] = useState(false);
  // Year-by-year table toggle. The chart is good for shape; the table is
  // what the user reaches for to answer "at age 85 is my corpus enough?".
  const [runwayTableOpen, setRunwayTableOpen] = useState(false);
  // Per-card collapse state. The retirement page is long — letting the
  // user collapse sections they aren't focused on makes scanning easier.
  // Defaults: heavy interactive sections open; secondary detail closed.
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({
    assets: true,
    assumptions: true,
    buckets: false,
    projection: true,
    runway: true,
    incomeArrivals: true,
  });
  const toggleSection = (key: string) =>
    setSectionOpen((p) => ({ ...p, [key]: !p[key] }));
  const [liquidPct, setLiquidPct] = useState(10);
  const [stablePct, setStablePct] = useState(30);
  const [growthPct, setGrowthPct] = useState(60);
  const [liquidReturn, setLiquidReturn] = useState(6);
  const [stableReturn, setStableReturn] = useState(8);
  const [growthReturn, setGrowthReturn] = useState(11);
  const [liquidYrsHeld, setLiquidYrsHeld] = useState(1);
  const [stableYrsHeld, setStableYrsHeld] = useState(3);
  // Per-class growth flags — drive which income stream grows with inflation.
  const [growthFlags, setGrowthFlags] = useState<{
    NPS: boolean;
    ANNUITY_POLICIES: boolean;
    INSURANCE_POLICIES: boolean;
    REAL_ESTATE: boolean;
  }>({
    NPS: false,
    ANNUITY_POLICIES: true,
    INSURANCE_POLICIES: false,
    REAL_ESTATE: true,
  });
  // Retirement-asset selection
  const [classes, setClasses] = useState<AssetClassRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Cashflow events — derived from insurance/NPS/PPF/rental/annuity etc.
  // by /api/cashflow-events/derive. Surfaced here as an "Income arrivals"
  // strip so the user can see which events will fire during retirement.
  const [cashflowEvents, setCashflowEvents] = useState<CashflowEvent[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [assetsRes, assRes] = await Promise.all([
        fetch('/api/finance/retirement-assets').then((r) => r.json()),
        fetch('/api/finance/retirement-assumptions').then((r) => r.json()),
      ]);
      setClasses(assetsRes.classes || []);
      if (assRes && !assRes.error) {
        setCurrentAge(assRes.currentAge);
        setTargetAge(assRes.targetAge);
        setMonthlyExpense(assRes.monthlyExpenseRupees);
        setInflation(assRes.inflationPct);
        setExpectedReturn(assRes.expectedReturnPct);
        setPostRetirementReturn(assRes.postRetirementReturnPct ?? 8);
        setRetirementDuration(assRes.retirementDurationYears);
        setLadderStartAge(assRes.ladderStartAge ?? 60);
        setBucketEnabled(!!assRes.bucketEnabled);
        setLiquidPct(assRes.liquidPct ?? 10);
        setStablePct(assRes.stablePct ?? 30);
        setGrowthPct(assRes.growthPct ?? 60);
        setLiquidReturn(assRes.liquidReturnPct ?? 6);
        setStableReturn(assRes.stableReturnPct ?? 8);
        setGrowthReturn(assRes.growthReturnPct ?? 11);
        setLiquidYrsHeld(assRes.liquidYrsHeld ?? 1);
        setStableYrsHeld(assRes.stableYrsHeld ?? 3);
        setGrowthFlags({
          NPS: !!assRes.npsIncomeGrows,
          ANNUITY_POLICIES: assRes.annuityIncomeGrows ?? true,
          INSURANCE_POLICIES: !!assRes.insuranceLadderIncomeGrows,
          REAL_ESTATE: assRes.rentalIncomeGrows ?? true,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fetch all cashflow events once. We filter to the retirement window
  // client-side (depends on currentAge/targetAge/retirementDuration which
  // can change after load).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/cashflow-events').then((r) => r.json());
        setCashflowEvents(r.events || []);
      } catch (e) {
        console.error('Failed to load cashflow events', e);
      }
    })();
  }, []);

  // Persist a single assumption field on blur (numbers or booleans).
  const saveAssumption = (body: Record<string, number | boolean>) => {
    fetch('/api/finance/retirement-assumptions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((e) => console.error(e));
  };

  /** Optimistic toggle / mode / override — patches the server then refetches. */
  const patchSelection = async (body: Record<string, unknown>) => {
    // Local optimistic update
    setClasses((prev) =>
      prev.map((c) => {
        if (c.assetClass !== body.assetClass) return c;
        return {
          ...c,
          items: c.items.map((it) => {
            if (it.id !== body.sourceId) return it;
            const updated: RetirementItem = { ...it };
            if ('included' in body && typeof body.included === 'boolean')
              updated.included = body.included;
            if ('mode' in body && (body.mode === 'SELL' || body.mode === 'RENTAL'))
              updated.mode = body.mode as Mode;
            if ('salePriceOverride' in body) {
              updated.salePriceOverridePaisa =
                body.salePriceOverride === null
                  ? null
                  : Math.round(Number(body.salePriceOverride) * 100);
            }
            if (typeof body.npsLumpsumPct === 'number')
              updated.npsLumpsumPct = body.npsLumpsumPct;
            if (typeof body.npsAnnuityRatePct === 'number')
              updated.npsAnnuityRatePct = body.npsAnnuityRatePct;
            if ('expectedFutureRent' in body) {
              updated.expectedFutureRentPaisa =
                body.expectedFutureRent === null
                  ? null
                  : Math.round(Number(body.expectedFutureRent) * 100);
            }
            return updated;
          }),
        };
      }),
    );
    await fetch('/api/finance/retirement-assets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((e) => console.error(e));
  };

  /* ─── derived projections ─────────────────────────────────────────── */

  const projection = useMemo(() => {
    const yrs = Math.max(0, targetAge - currentAge);
    const r = expectedReturn / 100;
    const pfRate = 0.0825;
    const infl = inflation / 100;
    const monthsToRet = yrs * 12;

    const compound = (p: number, rate: number, years: number) =>
      p * Math.pow(1 + rate, years);

    let corpusAtRetirement = 0;
    // Year-1 income broken out per source so the runway chart can show
    // composition (and so the ladder can naturally end at year ladderYears
    // instead of being smoothed across the full retirement).
    let rentalY1 = 0;
    let annuityY1 = 0;
    let npsY1 = 0;
    let ladderTotal = 0;
    let ladderCount = 0;
    // Per-policy annuity streams — each can have its own start date / age, so
    // the runway and PV must defer them individually instead of treating the
    // whole bucket as starting at retirement.
    const annuityStreams: Array<{ annualPaisa: number; startAge: number }> = [];
    // Aggregate fixed-vs-growing buckets (non-ladder) for the SWP corpus calc.
    let fixedIncomeAtRetirement = 0;
    let growingIncomeAtRetirement = 0;
    let currentValueSelection = 0;
    const breakdown: Record<string, { corpus: number; income: number; today: number }> = {};

    for (const cls of classes) {
      let cCorpus = 0;
      let cIncome = 0;          // fixed-stream contribution
      let cGrowingIncome = 0;   // grows with inflation through retirement
      let cToday = 0;
      for (const it of cls.items) {
        if (!it.included) continue;
        cToday += it.valuePaisa;
        currentValueSelection += it.valuePaisa;
        switch (cls.assetClass) {
          case 'NPS': {
            const lumpPct = (it.npsLumpsumPct ?? 60) / 100;
            const annRate = (it.npsAnnuityRatePct ?? 6) / 100;
            const grown = compound(it.valuePaisa, r, yrs);
            cCorpus += grown * lumpPct;
            // 40% buys annuity → annual payout = balance × yield
            const npsAnnualIncome = grown * (1 - lumpPct) * annRate;
            npsY1 += npsAnnualIncome;
            if (growthFlags.NPS) cGrowingIncome += npsAnnualIncome;
            else cIncome += npsAnnualIncome;
            break;
          }
          case 'PF': {
            cCorpus += compound(it.valuePaisa, pfRate, yrs);
            break;
          }
          case 'ANNUITY_POLICIES': {
            // Each annuity policy has its own start date. Track per-stream;
            // runway + PV handle deferral individually. annuityY1 only
            // counts streams already paying at retirement (year-1 view).
            const inc = it.annualIncomePaisa ?? 0;
            const startAge = it.startDate
              ? currentAge +
                yearsBetween(new Date().toISOString().slice(0, 10), it.startDate)
              : targetAge;
            annuityStreams.push({ annualPaisa: inc, startAge });
            if (startAge <= targetAge) annuityY1 += inc;
            break;
          }
          case 'INSURANCE_POLICIES': {
            // Ladder model: each post-retirement / undated policy contributes
            // one rung. Year-1 ladder income = total / count, runs for
            // `count` years (so 16 policies × ₹2L → ₹2L/yr for 16 years,
            // then zero), instead of smearing over the full retirement.
            // Pre-retirement maturities still compound into corpus.
            if (!it.maturityDate) {
              ladderTotal += it.valuePaisa;
              ladderCount += 1;
              break;
            }
            const matAge =
              currentAge +
              yearsBetween(new Date().toISOString().slice(0, 10), it.maturityDate);
            if (matAge < targetAge) {
              const yrsAfterMaturity = Math.max(0, targetAge - matAge);
              cCorpus += compound(it.valuePaisa, r, yrsAfterMaturity);
            } else {
              ladderTotal += it.valuePaisa;
              ladderCount += 1;
            }
            break;
          }
          case 'REAL_ESTATE': {
            if (it.mode === 'RENTAL') {
              const yearOneRent =
                it.expectedFutureRentPaisa && it.expectedFutureRentPaisa > 0
                  ? it.expectedFutureRentPaisa * 12
                  : (it.annualIncomePaisa ?? 0) * Math.pow(1 + infl, yrs);
              rentalY1 += yearOneRent;
              if (growthFlags.REAL_ESTATE) cGrowingIncome += yearOneRent;
              else cIncome += yearOneRent;
            } else {
              const base =
                it.salePriceOverridePaisa && it.salePriceOverridePaisa > 0
                  ? it.salePriceOverridePaisa
                  : compound(it.valuePaisa, r, yrs);
              cCorpus +=
                it.salePriceOverridePaisa && it.salePriceOverridePaisa > 0
                  ? it.salePriceOverridePaisa
                  : base;
            }
            break;
          }
        }
      }
      corpusAtRetirement += cCorpus;
      fixedIncomeAtRetirement += cIncome;
      growingIncomeAtRetirement += cGrowingIncome;
      // Class-specific aggregates for the row display.
      const ladderShareForRow =
        cls.assetClass === 'INSURANCE_POLICIES' && ladderCount > 0
          ? ladderTotal / ladderCount
          : 0;
      // For annuities, show the total annual payout across all streams
      // (irrespective of deferral) — gives the user the "max annual" figure;
      // the chart visualises when each stream is actually active.
      const annuityShareForRow =
        cls.assetClass === 'ANNUITY_POLICIES'
          ? annuityStreams.reduce((s, a) => s + a.annualPaisa, 0)
          : 0;
      breakdown[cls.assetClass] = {
        corpus: cCorpus,
        income: cIncome + cGrowingIncome + ladderShareForRow + annuityShareForRow,
        today: cToday,
      };
    }
    // Ladder year-1 income = avg payout per ladder year; ladder runs for
    // ladderCount years (e.g. 16 policies × ₹2L → ₹2L/yr for 16 years).
    const ladderY1 = ladderCount > 0 ? ladderTotal / ladderCount : 0;
    const ladderYears = ladderCount;
    const annualIncomeAtRetirement =
      fixedIncomeAtRetirement + growingIncomeAtRetirement + ladderY1 + annuityY1;

    // monthlyExpense state is in rupees; everything else (corpus, income,
    // valuePaisa) is in paisa. Convert expenses to paisa once here so the
    // rest of the projection arithmetic stays in a single unit.
    const futureMonthlyExpensePaisa =
      monthlyExpense * 100 * Math.pow(1 + infl, yrs);
    const futureAnnualExpensePaisa = futureMonthlyExpensePaisa * 12;
    // Kept in rupees for the headline banner copy.
    const futureMonthlyExpense = futureMonthlyExpensePaisa / 100;
    const futureAnnualExpense = futureAnnualExpensePaisa / 100;
    const netAnnualGap = Math.max(
      0,
      futureAnnualExpensePaisa - annualIncomeAtRetirement,
    );

    // SWP-aware corpus needed (replaces the old "gap × duration" 25× rule).
    // Two cashflows discounted at post-retirement return over N years:
    //   • expense stream W₀ growing at inflation g
    //   • income stream I fixed (annuity / LIC are nominally fixed; rentals
    //     are already inflation-grown to retirement and kept flat thereafter)
    // PV(growing) = W₀ × (1 − ((1+g)/(1+r))^N) / (r − g)   when r ≠ g
    //             = W₀ × N / (1+r)                         when r == g
    // PV(fixed)   = I  × (1 − (1+r)^-N) / r                when r > 0
    //             = I  × N                                 when r == 0
    const N = retirementDuration;
    // When bucket mode is on, use the allocation-weighted blended return as
    // the discount rate for all PV calcs. Otherwise fall back to the single
    // post-retirement rate.
    const totalAlloc = liquidPct + stablePct + growthPct;
    const blendedReturnPct =
      totalAlloc > 0
        ? (liquidPct * liquidReturn +
            stablePct * stableReturn +
            growthPct * growthReturn) /
          totalAlloc
        : postRetirementReturn;
    const postR =
      (bucketEnabled ? blendedReturnPct : postRetirementReturn) / 100;
    const g = infl;
    let pvExpense: number;
    if (Math.abs(postR - g) < 1e-9) {
      pvExpense = (futureAnnualExpensePaisa * N) / (1 + postR);
    } else {
      pvExpense =
        (futureAnnualExpensePaisa * (1 - Math.pow((1 + g) / (1 + postR), N))) /
        (postR - g);
    }
    // Fixed-stream PV (annuities + NPS annuity + LIC ladder, nominally flat).
    let pvFixedIncome: number;
    if (postR === 0) {
      pvFixedIncome = fixedIncomeAtRetirement * N;
    } else {
      pvFixedIncome =
        (fixedIncomeAtRetirement * (1 - Math.pow(1 + postR, -N))) / postR;
    }
    // Growing-stream PV (rental, grows at inflation g — same growth as
    // expenses, so this offsets the inflated expense directly).
    let pvGrowingIncome: number;
    if (Math.abs(postR - g) < 1e-9) {
      pvGrowingIncome = (growingIncomeAtRetirement * N) / (1 + postR);
    } else {
      pvGrowingIncome =
        (growingIncomeAtRetirement *
          (1 - Math.pow((1 + g) / (1 + postR), N))) /
        (postR - g);
    }
    // LIC ladder PV — finite stream of `ladderYears` years at year-1 amount
    // ladderY1, deferred by (ladderStartAge - targetAge) years if positive.
    let pvLadder = 0;
    if (ladderYears > 0) {
      let pvAtLadderStart: number;
      if (growthFlags.INSURANCE_POLICIES) {
        if (Math.abs(postR - g) < 1e-9) {
          pvAtLadderStart = (ladderY1 * ladderYears) / (1 + postR);
        } else {
          pvAtLadderStart =
            (ladderY1 *
              (1 - Math.pow((1 + g) / (1 + postR), ladderYears))) /
            (postR - g);
        }
      } else if (postR === 0) {
        pvAtLadderStart = ladderY1 * ladderYears;
      } else {
        pvAtLadderStart =
          (ladderY1 * (1 - Math.pow(1 + postR, -ladderYears))) / postR;
      }
      // Discount back from ladderStartAge to retirement age.
      const ladderDeferral = Math.max(0, ladderStartAge - targetAge);
      pvLadder = pvAtLadderStart / Math.pow(1 + postR, ladderDeferral);
    }
    // Per-policy annuity PV with individual deferral. Annuities are assumed
    // to last the full retirement once they start (LIC whole-life pays till
    // death; modelled as retirementDuration). Class toggle decides growth.
    let pvAnnuity = 0;
    for (const a of annuityStreams) {
      const deferral = Math.max(0, a.startAge - targetAge);
      const yearsActive = Math.max(0, retirementDuration - deferral);
      if (yearsActive <= 0) continue;
      let pvAtStart: number;
      if (growthFlags.ANNUITY_POLICIES) {
        if (Math.abs(postR - g) < 1e-9) {
          pvAtStart = (a.annualPaisa * yearsActive) / (1 + postR);
        } else {
          pvAtStart =
            (a.annualPaisa *
              (1 - Math.pow((1 + g) / (1 + postR), yearsActive))) /
            (postR - g);
        }
      } else if (postR === 0) {
        pvAtStart = a.annualPaisa * yearsActive;
      } else {
        pvAtStart =
          (a.annualPaisa * (1 - Math.pow(1 + postR, -yearsActive))) / postR;
      }
      pvAnnuity += pvAtStart / Math.pow(1 + postR, deferral);
    }
    const pvIncome = pvFixedIncome + pvGrowingIncome + pvLadder + pvAnnuity;
    const corpusNeeded = Math.max(0, pvExpense - pvIncome);
    const gap = Math.max(0, corpusNeeded - corpusAtRetirement);

    // Required SIP to fill gap (future-value of annuity formula).
    const monthlyReturn = r / 12;
    let requiredSip = 0;
    if (gap > 0 && monthsToRet > 0) {
      if (monthlyReturn > 0) {
        requiredSip =
          (gap * monthlyReturn) / (Math.pow(1 + monthlyReturn, monthsToRet) - 1);
      } else {
        requiredSip = gap / monthsToRet;
      }
    }

    // Build chart data: corpus + annual-income lines from age 0 → targetAge.
    const series: Array<{ year: number; corpus: number; income: number; sip: number }> = [];
    for (let y = 0; y <= yrs; y++) {
      // Approximate corpus growth: assume the full corpus accumulates linearly
      // with the compound curve at expected return on today's selection. This
      // is a smoothed visual; the headline number uses the precise calc above.
      const corpusY = corpusAtRetirement * Math.pow(1 / (1 + r), yrs - y);
      // Income line: ramp from 0 today to annualIncomeAtRetirement at year yrs.
      const incomeY = (annualIncomeAtRetirement * y) / Math.max(1, yrs);
      // SIP contribution future value at year y.
      let sipFv = 0;
      if (requiredSip > 0) {
        const m = y * 12;
        sipFv =
          monthlyReturn > 0
            ? requiredSip * ((Math.pow(1 + monthlyReturn, m) - 1) / monthlyReturn)
            : requiredSip * m;
      }
      series.push({
        year: currentAge + y,
        corpus: Math.round(corpusY),
        income: Math.round(incomeY),
        sip: Math.round(sipFv),
      });
    }

    /* ─── Runway: year-by-year corpus depletion during retirement ────── */
    // (postR + N + g declared above with the SWP-corpus formula.)
    // When bucketEnabled, three sub-balances replace the single corpus:
    //   • Liquid  (low return, holds <liquidYrsHeld> years of expense)
    //   • Stable  (medium return, holds <stableYrsHeld> years)
    //   • Growth  (high return, runs the long term)
    // Cascade rules: pull from Liquid → refill from Stable → refill from Growth.
    // Each bucket grows at its own rate before the year's transactions.
    const lR = liquidReturn / 100;
    const sR = stableReturn / 100;
    const gR = growthReturn / 100;
    let liquidBal = bucketEnabled ? (corpusAtRetirement * liquidPct) / 100 : 0;
    let stableBal = bucketEnabled ? (corpusAtRetirement * stablePct) / 100 : 0;
    let growthBal = bucketEnabled ? (corpusAtRetirement * growthPct) / 100 : 0;
    let balance = corpusAtRetirement;
    const runwaySeries: Array<{
      ageAtRetire: number;
      balance: number;
      annualWithdrawal: number;
      annualIncome: number;
      // Per-source breakdown so the chart can stack/layer income composition
      // and show clearly when the LIC ladder drops off.
      rentalIncome: number;
      annuityIncome: number;
      npsIncome: number;
      ladderIncome: number;
      /** Investment return on the year-start corpus (balance × postR). */
      corpusGrowth: number;
      corpusDraw: number;  // how much actually pulled from corpus that year
      // Per-bucket balances (only meaningful when bucketEnabled).
      liquidBal: number;
      stableBal: number;
      growthBal: number;
    }> = [];
    let yearsLasted = 0;
    let depleted = false;
    // Chart only shows the planned retirement window — runs from age
    // targetAge+1 → targetAge+retirementDuration. We simulate a few years
    // past the window so yearsLasted can report a real number when the
    // corpus survives the plan, but the chart is capped at the plan end.
    const SIM_CAP = retirementDuration + 30;
    for (let n = 1; n <= SIM_CAP; n++) {
      // All values in paisa. Each source grows (or stays flat) per its toggle.
      const annualWithdrawal =
        futureAnnualExpensePaisa * Math.pow(1 + infl, n - 1);
      // Per-source year-N income — chart-friendly. Same growth flag applied
      // both here and in the PV/SWP calc so the headline + chart stay in sync.
      const grow = (amount: number, on: boolean) =>
        on ? amount * Math.pow(1 + infl, n - 1) : amount;
      const rentalIncome = grow(rentalY1, growthFlags.REAL_ESTATE);
      // Per-stream annuity: each policy starts at its own age. Growth is
      // applied from this stream's first-active year (not from retirement)
      // so a deferred annuity that pays ₹80K/yr at age 62 doesn't pre-grow.
      const ageThisYear = targetAge + n;
      const annuityIncome = annuityStreams.reduce((sum, a) => {
        if (ageThisYear < a.startAge) return sum;
        const yearsSinceStart = ageThisYear - a.startAge;
        return (
          sum +
          (growthFlags.ANNUITY_POLICIES
            ? a.annualPaisa * Math.pow(1 + infl, yearsSinceStart)
            : a.annualPaisa)
        );
      }, 0);
      const npsIncome = grow(npsY1, growthFlags.NPS);
      // Ladder defers until the user's chosen start-age (LIC endowments
      // mature at a fixed age, often 60, regardless of retirement age).
      const ladderDeferral = Math.max(0, ladderStartAge - targetAge);
      const ladderActiveYear = n - ladderDeferral;
      const ladderIncome =
        ladderActiveYear >= 1 && ladderActiveYear <= ladderYears
          ? grow(ladderY1, growthFlags.INSURANCE_POLICIES)
          : 0;
      const annualIncome = rentalIncome + annuityIncome + npsIncome + ladderIncome;
      const netDraw = Math.max(0, annualWithdrawal - annualIncome);
      let corpusGrowth: number;
      if (bucketEnabled) {
        // 1. Each bucket earns at its own rate.
        const lG = Math.max(0, liquidBal) * lR;
        const sG = Math.max(0, stableBal) * sR;
        const gG = Math.max(0, growthBal) * gR;
        liquidBal += lG;
        stableBal += sG;
        growthBal += gG;
        corpusGrowth = lG + sG + gG;
        // 2. Pull this year's draw from Liquid.
        liquidBal -= netDraw;
        // 3. Refill Liquid from Stable if it dipped below threshold.
        const liquidTarget = liquidYrsHeld * annualWithdrawal;
        if (liquidBal < liquidTarget && stableBal > 0) {
          const need = liquidTarget - liquidBal;
          const move = Math.min(need, stableBal);
          stableBal -= move;
          liquidBal += move;
        }
        // 4. Refill Stable from Growth if it dipped below threshold.
        const stableTarget = stableYrsHeld * annualWithdrawal;
        if (stableBal < stableTarget && growthBal > 0) {
          const need = stableTarget - stableBal;
          const move = Math.min(need, growthBal);
          growthBal -= move;
          stableBal += move;
        }
        balance = liquidBal + stableBal + growthBal;
      } else {
        // Legacy single-rate model.
        corpusGrowth = Math.max(0, balance) * postR;
        balance = balance + corpusGrowth - netDraw;
      }
      // Only chart points within the retirement window. yearsLasted (used in
      // the headline) still uses the full sim below so it can read past the
      // plan if the corpus survives.
      if (n <= retirementDuration) {
        runwaySeries.push({
          ageAtRetire: targetAge + n,
          balance: Math.round(balance),
          annualWithdrawal: Math.round(annualWithdrawal),
          annualIncome: Math.round(annualIncome),
          rentalIncome: Math.round(rentalIncome),
          annuityIncome: Math.round(annuityIncome),
          npsIncome: Math.round(npsIncome),
          ladderIncome: Math.round(ladderIncome),
          corpusGrowth: Math.round(corpusGrowth),
          corpusDraw: Math.round(netDraw),
          liquidBal: Math.round(Math.max(0, liquidBal)),
          stableBal: Math.round(Math.max(0, stableBal)),
          growthBal: Math.round(Math.max(0, growthBal)),
        });
      }
      if (balance > 0) yearsLasted = n;
      if (balance <= 0 && !depleted) depleted = true;
      // Stop the sim once we have everything: past the chart window AND
      // either depleted or comfortably past the plan with positive balance.
      if (n > retirementDuration && (depleted || n >= retirementDuration + 30)) {
        break;
      }
    }
    const finalBalance = runwaySeries.length ? runwaySeries[runwaySeries.length - 1].balance : 0;
    const balanceAtPlanEnd =
      runwaySeries[Math.min(runwaySeries.length, retirementDuration) - 1]?.balance ?? balance;
    const firstYearWithdrawal = runwaySeries[0]?.annualWithdrawal ?? 0;
    const lastYearWithdrawal =
      runwaySeries[Math.min(runwaySeries.length, retirementDuration) - 1]?.annualWithdrawal ?? 0;

    return {
      corpusAtRetirement,
      currentValueSelection,
      annualIncomeAtRetirement,
      futureMonthlyExpense,
      futureAnnualExpense,
      netAnnualGap,
      corpusNeeded,
      gap,
      requiredSip,
      breakdown,
      series,
      // Runway
      yearsLasted,
      balanceAtPlanEnd,
      finalBalance,
      firstYearWithdrawal,
      lastYearWithdrawal,
      runwaySeries,
      ladderYears,
      ladderY1,
    };
  }, [
    classes,
    currentAge,
    targetAge,
    monthlyExpense,
    inflation,
    expectedReturn,
    postRetirementReturn,
    retirementDuration,
    growthFlags,
    ladderStartAge,
    bucketEnabled,
    liquidPct,
    stablePct,
    growthPct,
    liquidReturn,
    stableReturn,
    growthReturn,
    liquidYrsHeld,
    stableYrsHeld,
  ]);

  /* ─── retirement-window cashflow events ───────────────────────────── */
  // Two passes:
  //   1. Window filter — keep only events that fire / are active during
  //      the retirement years [retirementStartYear, lifeExpectancyYear].
  //   2. Selection filter — respect the user's asset-selection toggles
  //      at the top of the page. If the user unticked a specific LIC
  //      policy or NPS account from retirement, its derived events
  //      should NOT appear in the income timeline either. Salary is
  //      always excluded (it ends at retirement). Manual events (no
  //      source_id) always show — the user added them deliberately.
  const isEventSelectedForRetirement = useCallback(
    (e: CashflowEvent): boolean => {
      // Salary stops at retirement by definition — not "income during
      // retirement". Always exclude.
      if (e.sourceKind === 'SALARY') return false;
      // SIPs are pre-retirement OUTFLOWS into MFs, not income at all.
      // They typically stop when the salary stops (no source to fund
      // them). MFs aren't even a retirement asset class — they sit
      // outside retirement-asset-selection. Always exclude. (The SIP
      // source kind was added after Phase 4's filter and wasn't in the
      // original exclusion list — this is the missed update.)
      if (e.sourceKind === 'SIP') return false;
      // Manual events have no source asset to consult; the user added
      // them deliberately, so always include.
      if (e.sourceId == null) return true;

      // Map event kind → retirement asset class. If we can't map it
      // (PENSION/BUSINESS/INHERITANCE/OTHER with a source_id are
      // unusual), default to included.
      const cls = (() => {
        switch (e.sourceKind) {
          case 'INSURANCE_MATURITY': return 'INSURANCE_POLICIES';
          case 'ANNUITY':            return 'ANNUITY_POLICIES';
          case 'NPS_LUMPSUM':
          case 'NPS_ANNUITY':        return 'NPS';
          case 'PPF_MATURITY':
          case 'SSY_MATURITY':
          case 'NSC_MATURITY':
          case 'KVP_MATURITY':       return 'SMALL_SAVINGS';
          case 'RENTAL':             return 'REAL_ESTATE';
          default:                   return null;
        }
      })();
      if (!cls) return true;

      const classRow = classes.find((c) => c.assetClass === cls);
      if (!classRow) return true; // class not loaded yet — be permissive
      const item = classRow.items.find((i) => i.id === e.sourceId);
      if (!item) return true;     // no matching item — be permissive
      if (!item.included) return false;

      // Real estate edge case: a property's rental events should only
      // surface if the user has it in RENTAL mode (not SELL). Selling
      // means the income stream is being liquidated, not received.
      if (e.sourceKind === 'RENTAL' && item.mode && item.mode !== 'RENTAL') {
        return false;
      }
      return true;
    },
    [classes],
  );

  const retirementEvents = useMemo(() => {
    const yearsToRetire = Math.max(0, targetAge - currentAge);
    const retirementStartYear = new Date().getFullYear() + yearsToRetire;
    const lifeExpectancyYear = retirementStartYear + retirementDuration;
    return cashflowEvents
      .filter((e) => {
        const startYear = new Date(e.startDate).getFullYear();
        if (e.frequency === 'ONE_TIME') {
          // TODO: revisit once cashflow-event validation enforces
          // start_date is in the future. For now we include backfilled
          // historical maturities so long as they sit within the
          // retirement window.
          return startYear >= retirementStartYear && startYear <= lifeExpectancyYear;
        }
        // MONTHLY / YEARLY — active in retirement if either it has no
        // end date (lifelong) or it ends after retirement starts.
        if (!e.endDate) return true;
        const endYear = new Date(e.endDate).getFullYear();
        return endYear >= retirementStartYear;
      })
      .filter(isEventSelectedForRetirement);
  }, [cashflowEvents, currentAge, targetAge, retirementDuration, isEventSelectedForRetirement]);

  // Retirement window bounds for the timeline component.
  const retirementWindow = useMemo(() => {
    const yearsToRetire = Math.max(0, targetAge - currentAge);
    const start = new Date().getFullYear() + yearsToRetire;
    return { start, end: start + retirementDuration };
  }, [currentAge, targetAge, retirementDuration]);

  /** Yearly equivalent of a recurring event for the "annual income" tile. */
  const annualEquivalent = (e: CashflowEvent): number => {
    switch (e.frequency) {
      case 'MONTHLY': return e.amountPaisa * 12;
      case 'YEARLY': return e.amountPaisa;
      case 'ONE_TIME': return 0;
    }
  };

  const retirementEventStats = useMemo(() => {
    const oneTime = retirementEvents.filter((e) => e.frequency === 'ONE_TIME');
    const recurring = retirementEvents.filter((e) => e.frequency !== 'ONE_TIME');
    return {
      oneTimeCount: oneTime.length,
      oneTimeTotalPaisa: oneTime.reduce((s, e) => s + e.amountPaisa, 0),
      recurringCount: recurring.length,
      recurringAnnualPaisa: recurring.reduce((s, e) => s + annualEquivalent(e), 0),
    };
  }, [retirementEvents]);

  // On-track indicator
  const savingsCapacity = monthlyExpense * 0.5;
  let trackColor = 'bg-emerald-100 text-emerald-800 border-emerald-500';
  let trackLabel = 'On track';
  if (projection.requiredSip / 100 > savingsCapacity) {
    trackColor = 'bg-rose-100 text-rose-800 border-rose-500';
    trackLabel = 'Behind — SIP exceeds likely savings';
  } else if (projection.requiredSip / 100 > savingsCapacity * 0.5) {
    trackColor = 'bg-amber-100 text-amber-800 border-amber-500';
    trackLabel = 'Tight — SIP uses >50% of savings';
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Retirement Projection</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Pick which assets fund retirement and how each contributes.
        </p>
      </div>

      {/* Retirement assets section */}
      <Card>
        <CardHeader
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('assets')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('assets'); } }}
          className="cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[var(--dxp-text-muted)]">{sectionOpen.assets ? '▼' : '▶'}</span>
              <Coins className="h-5 w-5 text-amber-600" />
              <div>
                <h3 className="text-base font-bold text-[var(--dxp-text)]">Retirement Assets</h3>
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  Expand each class to pick items. Real Estate has a Sell/Rental mode.
                </p>
              </div>
            </div>
            <div className="text-right text-[11px]">
              <p>
                <span className="text-[var(--dxp-text-muted)]">Current value of selection: </span>
                <span className="font-mono font-bold text-[var(--dxp-text)]">
                  {formatINRShort(projection.currentValueSelection)}
                </span>
              </p>
              <p>
                <span className="text-[var(--dxp-text-muted)]">Corpus at retirement (in {Math.max(0, targetAge - currentAge)} yrs): </span>
                <span className="font-mono font-bold text-blue-700">
                  {formatINRShort(projection.corpusAtRetirement)}
                </span>
              </p>
              <p>
                <span className="text-[var(--dxp-text-muted)]">Annual income at retirement: </span>
                <span className="font-mono font-bold text-emerald-700">
                  {formatINRShort(projection.annualIncomeAtRetirement)}/yr
                </span>
              </p>
            </div>
          </div>
        </CardHeader>
        {sectionOpen.assets && (
          <CardContent>
            <div className="space-y-2">
              {classes.map((cls) => {
                const grows =
                  cls.assetClass === 'NPS' ? growthFlags.NPS
                  : cls.assetClass === 'ANNUITY_POLICIES' ? growthFlags.ANNUITY_POLICIES
                  : cls.assetClass === 'INSURANCE_POLICIES' ? growthFlags.INSURANCE_POLICIES
                  : cls.assetClass === 'REAL_ESTATE' ? growthFlags.REAL_ESTATE
                  : null;
                const onToggleGrowth = (next: boolean) => {
                  if (cls.assetClass === 'PF') return; // PF produces no income
                  setGrowthFlags((p) => ({ ...p, [cls.assetClass]: next } as typeof p));
                  const key =
                    cls.assetClass === 'NPS' ? 'npsIncomeGrows'
                    : cls.assetClass === 'ANNUITY_POLICIES' ? 'annuityIncomeGrows'
                    : cls.assetClass === 'INSURANCE_POLICIES' ? 'insuranceLadderIncomeGrows'
                    : 'rentalIncomeGrows';
                  saveAssumption({ [key]: next });
                };
                return (
                  <ClassRow
                    key={cls.assetClass}
                    cls={cls}
                    breakdown={projection.breakdown[cls.assetClass]}
                    onPatch={patchSelection}
                    incomeGrows={grows}
                    onToggleGrowth={grows === null ? undefined : onToggleGrowth}
                    inflationPct={inflation}
                  />
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Assumptions */}
      <Card>
        <CardHeader
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('assumptions')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('assumptions'); } }}
          className="cursor-pointer"
        >
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <span className="text-[var(--dxp-text-muted)]">{sectionOpen.assumptions ? '▼' : '▶'}</span>
            <Sunset className="h-5 w-5 text-[var(--dxp-brand)]" /> Assumptions
          </h3>
        </CardHeader>
        {sectionOpen.assumptions && (
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Current Age">
              <Input
                type="number"
                value={currentAge}
                onChange={(e) => setCurrentAge(Number(e.target.value))}
                onBlur={() => saveAssumption({ currentAge })}
              />
            </Field>
            <Field label="Target Retirement Age">
              <Input
                type="number"
                value={targetAge}
                onChange={(e) => setTargetAge(Number(e.target.value))}
                onBlur={() => saveAssumption({ targetAge })}
              />
            </Field>
            <Field label="Current Monthly Expense (INR)">
              <Input
                type="number"
                value={monthlyExpense}
                onChange={(e) => setMonthlyExpense(Number(e.target.value))}
                onBlur={() => saveAssumption({ monthlyExpenseRupees: monthlyExpense })}
              />
            </Field>
            <Field label="Inflation Rate (%)">
              <Input
                type="number"
                value={inflation}
                onChange={(e) => setInflation(Number(e.target.value))}
                onBlur={() => saveAssumption({ inflationPct: inflation })}
              />
            </Field>
            <Field label="Expected Return (%) — pre-retirement">
              <Input
                type="number"
                value={expectedReturn}
                onChange={(e) => setExpectedReturn(Number(e.target.value))}
                onBlur={() => saveAssumption({ expectedReturnPct: expectedReturn })}
              />
            </Field>
            <Field label="Post-retirement Return (%)">
              <Input
                type="number"
                value={postRetirementReturn}
                onChange={(e) => setPostRetirementReturn(Number(e.target.value))}
                onBlur={() => saveAssumption({ postRetirementReturnPct: postRetirementReturn })}
              />
            </Field>
            <Field label={`Years post-retirement (corpus lasts till age ${targetAge + retirementDuration})`}>
              <Input
                type="number"
                value={retirementDuration}
                onChange={(e) => setRetirementDuration(Number(e.target.value))}
                onBlur={() => saveAssumption({ retirementDurationYears: retirementDuration })}
              />
            </Field>
            <Field label={`LIC ladder starts at age ${ladderStartAge} (defers ${Math.max(0, ladderStartAge - targetAge)} yrs)`}>
              <Input
                type="number"
                value={ladderStartAge}
                onChange={(e) => setLadderStartAge(Number(e.target.value))}
                onBlur={() => saveAssumption({ ladderStartAge })}
              />
            </Field>
          </div>
        </CardContent>
        )}
      </Card>

      {/* Three-bucket SWP allocation */}
      <Card>
        <CardHeader
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('buckets')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('buckets'); } }}
          className="cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <span className="text-[var(--dxp-text-muted)]">{sectionOpen.buckets ? '▼' : '▶'}</span>
                Three-bucket SWP {bucketEnabled ? '· ON' : '· OFF (single-rate)'}
              </h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">
                Split corpus into Liquid / Stable / Growth buckets at retirement.
                Event-driven cascade: pull from Liquid → refill from Stable → refill from Growth.
                Weighted blended return ≈{' '}
                {(
                  (liquidPct * liquidReturn + stablePct * stableReturn + growthPct * growthReturn) /
                  Math.max(1, liquidPct + stablePct + growthPct)
                ).toFixed(2)}
                %
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                // Don't let this propagate to the collapsible header
                e.stopPropagation();
                const next = !bucketEnabled;
                setBucketEnabled(next);
                saveAssumption({ bucketEnabled: next });
              }}
              className={`text-[10px] font-semibold uppercase tracking-wider px-3 py-1 rounded border ${
                bucketEnabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'bg-gray-50 border-gray-300 text-gray-600'
              }`}
            >
              {bucketEnabled ? '↑ Active' : '— Off'}
            </button>
          </div>
        </CardHeader>
        {sectionOpen.buckets && bucketEnabled && (
          <CardContent>
            {(() => {
              const total = liquidPct + stablePct + growthPct;
              const mismatch = Math.abs(total - 100) > 0.01;
              return (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <BucketRow
                      label="Liquid"
                      hint="FD / savings · 1-2 yrs of expense · low risk"
                      tone="emerald"
                      pct={liquidPct}
                      ret={liquidReturn}
                      yrsHeld={liquidYrsHeld}
                      initialPaisa={(projection.corpusAtRetirement * liquidPct) / 100}
                      targetPaisa={liquidYrsHeld * projection.futureAnnualExpense * 100}
                      setPct={(v) => { setLiquidPct(v); saveAssumption({ liquidPct: v }); }}
                      setRet={(v) => { setLiquidReturn(v); saveAssumption({ liquidReturnPct: v }); }}
                      setYrsHeld={(v) => { setLiquidYrsHeld(v); saveAssumption({ liquidYrsHeld: v }); }}
                    />
                    <BucketRow
                      label="Stable"
                      hint="Debt MF / hybrid · 3-8 yrs of expense · medium risk"
                      tone="amber"
                      pct={stablePct}
                      ret={stableReturn}
                      yrsHeld={stableYrsHeld}
                      initialPaisa={(projection.corpusAtRetirement * stablePct) / 100}
                      targetPaisa={stableYrsHeld * projection.futureAnnualExpense * 100}
                      setPct={(v) => { setStablePct(v); saveAssumption({ stablePct: v }); }}
                      setRet={(v) => { setStableReturn(v); saveAssumption({ stableReturnPct: v }); }}
                      setYrsHeld={(v) => { setStableYrsHeld(v); saveAssumption({ stableYrsHeld: v }); }}
                    />
                    <BucketRow
                      label="Growth"
                      hint="Equity MF · rest of corpus · highest return"
                      tone="purple"
                      pct={growthPct}
                      ret={growthReturn}
                      yrsHeld={null}
                      initialPaisa={(projection.corpusAtRetirement * growthPct) / 100}
                      targetPaisa={null}
                      setPct={(v) => { setGrowthPct(v); saveAssumption({ growthPct: v }); }}
                      setRet={(v) => { setGrowthReturn(v); saveAssumption({ growthReturnPct: v }); }}
                    />
                  </div>
                  {mismatch && (
                    <p className="mt-2 text-[11px] text-amber-700">
                      ⚠ Allocations total {total.toFixed(0)}% — they should sum to 100. Math still
                      runs but isn&apos;t a clean partition of the corpus.
                    </p>
                  )}
                </>
              );
            })()}
          </CardContent>
        )}
      </Card>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Corpus needed', value: projection.corpusNeeded / 100, format: 'currency' },
          { label: 'Corpus selected → grows to', value: projection.corpusAtRetirement / 100, format: 'currency' },
          { label: 'Gap', value: projection.gap / 100, format: 'currency' },
          { label: 'Monthly SIP needed', value: projection.requiredSip / 100, format: 'currency' },
        ]}
      />

      <div className={`rounded-lg border-l-4 p-4 ${trackColor}`}>
        <p className="text-sm font-bold">{trackLabel}</p>
        <p className="mt-1 text-xs">
          Income covers <span className="font-mono font-bold">{formatINRShort(projection.annualIncomeAtRetirement)}/yr</span> of the{' '}
          <span className="font-mono font-bold">{formatINRShort(projection.futureAnnualExpense * 100)}/yr</span> projected expense
          (future ₹{monthlyExpense.toLocaleString('en-IN')}/mo × (1+infl)^{targetAge - currentAge}).
          Required SIP: {formatINR(projection.requiredSip)} / Current monthly expense: {formatINR(monthlyExpense * 100)}
        </p>
      </div>

      <Card>
        <CardHeader
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('projection')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('projection'); } }}
          className="cursor-pointer"
        >
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <span className="text-[var(--dxp-text-muted)]">{sectionOpen.projection ? '▼' : '▶'}</span>
            Net worth + income projection
          </h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            From age {currentAge} to {targetAge} — corpus on left axis, annual income on right axis.
          </p>
        </CardHeader>
        {sectionOpen.projection && (
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={projection.series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tickFormatter={(v) => formatINRShort(v)}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => formatINRShort(v)}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={((v: unknown) => formatINR(Number(v))) as never} />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="corpus"
                  name="Corpus (selected assets)"
                  stroke="#2563eb"
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="sip"
                  name="SIP contributions"
                  stroke="#10b981"
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="income"
                  name="Annual income (₹/yr)"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
        )}
      </Card>

      {/* Corpus runway — "how long will the money last after retirement?" */}
      <Card>
        <CardHeader
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('runway')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('runway'); } }}
          className="cursor-pointer"
        >
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <span className="text-[var(--dxp-text-muted)]">{sectionOpen.runway ? '▼' : '▶'}</span>
            Corpus runway after retirement
          </h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Year-by-year balance from age {targetAge}, post-retirement return{' '}
            {postRetirementReturn}%, inflation {inflation}% on expenses.
            Annuity / rental income offsets each year&apos;s withdrawal.
          </p>
        </CardHeader>
        {sectionOpen.runway && (
        <CardContent>
          <StatsDisplay
            currency="INR"
            locale="en-IN"
            columns={4}
            stats={[
              {
                label: 'Corpus lasts',
                value: projection.yearsLasted,
                format: 'number',
              },
              {
                label: `Balance at end of plan (${retirementDuration}y)`,
                value: projection.balanceAtPlanEnd / 100,
                format: 'currency',
              },
              {
                label: 'Year-1 withdrawal',
                value: projection.firstYearWithdrawal / 100,
                format: 'currency',
              },
              {
                label: `Year-${retirementDuration} withdrawal`,
                value: projection.lastYearWithdrawal / 100,
                format: 'currency',
              },
            ]}
          />
          <div className="mt-3 h-80">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={projection.runwaySeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="ageAtRetire"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Age', position: 'insideBottom', offset: -2, fontSize: 11 }}
                />
                <YAxis
                  yAxisId="income"
                  tickFormatter={(v) => formatINRShort(v)}
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Annual income / withdrawal', angle: -90, position: 'insideLeft', fontSize: 10 }}
                />
                <YAxis
                  yAxisId="balance"
                  orientation="right"
                  tickFormatter={(v) => formatINRShort(v)}
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Corpus balance', angle: 90, position: 'insideRight', fontSize: 10 }}
                />
                <Tooltip formatter={((v: unknown) => formatINR(Number(v))) as never} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {/* Stacked income composition — shows when each source contributes */}
                <Area
                  yAxisId="income"
                  type="monotone"
                  dataKey="rentalIncome"
                  name="Rental income"
                  stackId="income"
                  stroke="#f59e0b"
                  fill="#fbbf24"
                  fillOpacity={0.7}
                />
                <Area
                  yAxisId="income"
                  type="monotone"
                  dataKey="annuityIncome"
                  name="LIC annuity"
                  stackId="income"
                  stroke="#a855f7"
                  fill="#c084fc"
                  fillOpacity={0.7}
                />
                <Area
                  yAxisId="income"
                  type="monotone"
                  dataKey="ladderIncome"
                  name={`LIC maturity ladder (${projection.ladderYears}y)`}
                  stackId="income"
                  stroke="#0ea5e9"
                  fill="#38bdf8"
                  fillOpacity={0.7}
                />
                <Area
                  yAxisId="income"
                  type="monotone"
                  dataKey="npsIncome"
                  name="NPS annuity"
                  stackId="income"
                  stroke="#10b981"
                  fill="#34d399"
                  fillOpacity={0.7}
                />
                <Area
                  yAxisId="income"
                  type="monotone"
                  dataKey="corpusGrowth"
                  name={`Corpus growth @ ${postRetirementReturn}%`}
                  stackId="income"
                  stroke="#64748b"
                  fill="#94a3b8"
                  fillOpacity={0.55}
                />
                {/* Withdrawal need overlay — gap above income = drawn from corpus */}
                <Line
                  yAxisId="income"
                  type="monotone"
                  dataKey="annualWithdrawal"
                  name="Annual expense need"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                />
                {/* Corpus balance on its own axis — single line when bucket
                    mode is off; three bucket lines when on. */}
                {!bucketEnabled && (
                  <Line
                    yAxisId="balance"
                    type="monotone"
                    dataKey="balance"
                    name="Corpus balance"
                    stroke="#2563eb"
                    strokeWidth={2.5}
                    strokeDasharray="5 3"
                    dot={false}
                  />
                )}
                {bucketEnabled && (
                  <>
                    <Line
                      yAxisId="balance"
                      type="monotone"
                      dataKey="growthBal"
                      name={`Growth bucket (${growthReturn}%)`}
                      stroke="#7c3aed"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="balance"
                      type="monotone"
                      dataKey="stableBal"
                      name={`Stable bucket (${stableReturn}%)`}
                      stroke="#d97706"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="balance"
                      type="monotone"
                      dataKey="liquidBal"
                      name={`Liquid bucket (${liquidReturn}%)`}
                      stroke="#059669"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="balance"
                      type="monotone"
                      dataKey="balance"
                      name="Total corpus"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      strokeDasharray="5 3"
                      dot={false}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-[11px] text-[var(--dxp-text-muted)]">
            {projection.yearsLasted >= retirementDuration ? (
              <>
                ✓ Corpus survives the full {retirementDuration}-year plan with{' '}
                <span className="font-mono font-bold text-emerald-700">
                  {formatINRShort(projection.balanceAtPlanEnd)}
                </span>{' '}
                left over.
              </>
            ) : (
              <>
                ⚠ Corpus runs out in year {projection.yearsLasted + 1} — short by{' '}
                {Math.max(0, retirementDuration - projection.yearsLasted)} year
                {retirementDuration - projection.yearsLasted === 1 ? '' : 's'} of the {retirementDuration}-year plan.
              </>
            )}
          </p>

          {/* Year-by-year table — what the chart's shape implies, made
              readable in numbers. The user asked: "is the money required
              more than 1 crore at 85 — and can the corpus handle it?"
              Now it's one row to scan, not an axis to squint at. */}
          <div className="mt-4 border-t border-[var(--dxp-border)] pt-3">
            <button
              type="button"
              onClick={() => setRunwayTableOpen((v) => !v)}
              className="flex w-full items-center justify-between text-sm font-semibold text-[var(--dxp-text)] hover:text-[var(--dxp-brand)]"
            >
              <span>
                {runwayTableOpen ? '▼' : '▶'} Year-by-year table ({projection.runwaySeries.length} rows)
              </span>
              <span className="text-xs font-normal text-[var(--dxp-text-muted)]">
                {runwayTableOpen ? 'click to collapse' : 'click to expand'}
              </span>
            </button>
            {runwayTableOpen && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--dxp-border)] text-[var(--dxp-text-muted)]">
                      <th className="px-2 py-1 text-left font-medium">Age</th>
                      <th className="px-2 py-1 text-right font-medium">Expense need</th>
                      <th className="px-2 py-1 text-right font-medium">Rental</th>
                      <th className="px-2 py-1 text-right font-medium">Annuity</th>
                      <th className="px-2 py-1 text-right font-medium">NPS</th>
                      <th className="px-2 py-1 text-right font-medium">Ladder</th>
                      <th className="px-2 py-1 text-right font-medium">Income total</th>
                      <th className="px-2 py-1 text-right font-medium">Corpus growth</th>
                      <th className="px-2 py-1 text-right font-medium">From corpus</th>
                      <th className="px-2 py-1 text-right font-medium">Year-end balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.runwaySeries.map((r) => {
                      const incomeTotal =
                        r.rentalIncome + r.annuityIncome + r.npsIncome + r.ladderIncome;
                      // Flag rows where the corpus dropped below the
                      // year's expense — early-warning amber. And rows
                      // where the corpus has gone negative — rose.
                      const overdrawn = r.balance < 0;
                      const tight = !overdrawn && r.balance < r.annualWithdrawal;
                      return (
                        <tr
                          key={r.ageAtRetire}
                          className={`border-b border-[var(--dxp-border)]/30 hover:bg-[var(--dxp-surface-alt)]/40 ${
                            overdrawn ? 'bg-rose-50/40' : tight ? 'bg-amber-50/40' : ''
                          }`}
                        >
                          <td className="px-2 py-1 font-mono">{r.ageAtRetire}</td>
                          <td className="px-2 py-1 text-right font-mono text-rose-600">
                            {formatINRShort(r.annualWithdrawal)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {r.rentalIncome > 0 ? formatINRShort(r.rentalIncome) : '—'}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {r.annuityIncome > 0 ? formatINRShort(r.annuityIncome) : '—'}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {r.npsIncome > 0 ? formatINRShort(r.npsIncome) : '—'}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {r.ladderIncome > 0 ? formatINRShort(r.ladderIncome) : '—'}
                          </td>
                          <td className="px-2 py-1 text-right font-mono font-semibold">
                            {formatINRShort(incomeTotal)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-emerald-700">
                            {formatINRShort(r.corpusGrowth)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-amber-700">
                            {r.corpusDraw > 0 ? formatINRShort(r.corpusDraw) : '—'}
                          </td>
                          <td
                            className={`px-2 py-1 text-right font-mono font-semibold ${
                              overdrawn ? 'text-rose-700' : 'text-[var(--dxp-text)]'
                            }`}
                          >
                            {formatINRShort(r.balance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] text-[var(--dxp-text-muted)]">
                  Amber row = corpus balance is less than that year&apos;s expense need (tight).
                  Rose row = corpus is negative (depleted).
                </p>
              </div>
            )}
          </div>
        </CardContent>
        )}
      </Card>

      {/* Income arrivals during retirement — surfaces the cashflow_events
          timeline filtered to retirement years. This is a read-only
          inventory; the cascade math already inflates / discounts these
          via NPS / annuity / rental / ladder calculations above. Edits
          happen on /planning/cashflows. */}
      <Card>
        <CardHeader
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('incomeArrivals')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('incomeArrivals'); } }}
          className="cursor-pointer"
        >
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <span className="text-[var(--dxp-text-muted)]">{sectionOpen.incomeArrivals ? '▼' : '▶'}</span>
                <Calendar className="h-5 w-5 text-[var(--dxp-brand)]" />
                Income arrivals during retirement
              </h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                These cashflow events will fire during your retirement years —
                pulled from your insurance/NPS/PPF/rental/annuity data via the
                cashflow_events timeline.
              </p>
            </div>
            <Link href="/planning/cashflows">
              <Button variant="secondary" size="sm">
                Manage events
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        {sectionOpen.incomeArrivals && (
        <CardContent>
          <StatsDisplay
            currency="INR"
            locale="en-IN"
            columns={4}
            stats={[
              { label: 'One-time arrivals', value: retirementEventStats.oneTimeCount, format: 'number' },
              { label: 'Total one-time value', value: retirementEventStats.oneTimeTotalPaisa / 100, format: 'currency' },
              { label: 'Recurring streams', value: retirementEventStats.recurringCount, format: 'number' },
              { label: 'Total annual recurring income', value: retirementEventStats.recurringAnnualPaisa / 100, format: 'currency' },
            ]}
          />
          <div className="mt-4">
            <CashflowTimeline
              events={retirementEvents}
              minYear={retirementWindow.start}
              maxYear={retirementWindow.end}
              showAlreadyActive
              emptyMessage="No cashflow events scheduled for your retirement window. Check that the relevant assets are ticked in the selection table above, and that maturity dates are filled in for your endowment policies."
            />
          </div>
          <p className="mt-3 text-[11px] text-[var(--dxp-text-muted)]">
            Only events from assets you&apos;ve ticked in the selection table
            above are shown here. These feed the corpus depletion chart as
            inflows in the years they fire. To change one, edit it in{' '}
            <Link
              href="/planning/cashflows"
              className="text-[var(--dxp-brand)] underline hover:no-underline"
            >
              Cashflow Events
            </Link>
            .
          </p>
        </CardContent>
        )}
      </Card>
    </div>
  );
}

/* ─── per-class row (expandable list of items) ───────────────────────── */

function ClassRow({
  cls,
  breakdown,
  onPatch,
  incomeGrows,
  onToggleGrowth,
  inflationPct,
}: {
  cls: AssetClassRow;
  breakdown?: { corpus: number; income: number; today: number };
  onPatch: (body: Record<string, unknown>) => void;
  /** null when the class has no income (e.g. PF). */
  incomeGrows: boolean | null;
  onToggleGrowth?: (next: boolean) => void;
  inflationPct: number;
}) {
  const [open, setOpen] = useState(false);
  const tickedCount = cls.items.filter((i) => i.included).length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/*
        Row header. Was a <button>, but the conditional "↑ grows" toggle
        below renders as a nested <button> — invalid HTML, hydration
        warning. role="button" + keyboard handlers gives identical UX
        without breaking the spec.
      */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 rounded-lg cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronUp className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          )}
          <span className="text-sm font-semibold text-gray-900">{cls.label}</span>
          <span className="text-[11px] text-gray-500">
            {tickedCount} / {cls.items.length} selected
          </span>
          {incomeGrows !== null && breakdown && breakdown.income > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleGrowth?.(!incomeGrows);
              }}
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${
                incomeGrows
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'bg-gray-50 border-gray-300 text-gray-600'
              }`}
              title={
                incomeGrows
                  ? `Income grows ${inflationPct}%/yr (inflation). Click to make flat.`
                  : 'Income is flat. Click to grow at inflation.'
              }
            >
              {incomeGrows ? `↑ grows ${inflationPct}%` : '— flat'}
            </button>
          )}
        </div>
        <div className="text-right text-[11px] font-mono">
          {breakdown && breakdown.today > 0 && (
            <p>
              <span className="text-gray-700 font-semibold">{formatINRShort(breakdown.today)}</span>
              <span className="text-gray-500"> today</span>
            </p>
          )}
          {breakdown && breakdown.corpus > 0 && (
            <p>
              <span className="text-blue-700 font-semibold">{formatINRShort(breakdown.corpus)}</span>
              <span className="text-gray-500"> @ retire</span>
            </p>
          )}
          {breakdown && breakdown.income > 0 && (
            <p>
              <span className="text-emerald-700 font-semibold">{formatINRShort(breakdown.income)}/yr</span>
              <span className="text-gray-500"> income</span>
            </p>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1">
          {cls.basis && <p className="text-[11px] italic text-gray-500 mb-1">{cls.basis}</p>}
          {cls.items.length === 0 && (
            <p className="text-[11px] italic text-gray-500">No eligible items.</p>
          )}
          {cls.items.map((it) => (
            <ItemRow
              key={it.id}
              cls={cls.assetClass}
              item={it}
              onPatch={onPatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  cls,
  item,
  onPatch,
}: {
  cls: AssetClassKey;
  item: RetirementItem;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [localSalePrice, setLocalSalePrice] = useState(
    item.salePriceOverridePaisa
      ? String(Math.round(item.salePriceOverridePaisa / 100))
      : '',
  );

  return (
    <div
      className={`rounded-md px-2 py-1.5 ${
        item.included ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
          <input
            type="checkbox"
            checked={item.included}
            onChange={(e) =>
              onPatch({
                assetClass: cls,
                sourceId: item.id,
                included: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <div className="min-w-0">
            <p className="text-sm text-gray-900 truncate">{item.label}</p>
            <p className="text-[10px] text-gray-500 truncate">
              {item.sublabel && <>{item.sublabel}</>}
              {item.maturityDate && <> · matures {fmtMonthYear(item.maturityDate)}</>}
            </p>
          </div>
        </label>
        <div className="text-right shrink-0">
          {item.valuePaisa > 0 && (
            <p className="font-mono text-sm font-semibold text-gray-700">
              {formatINRShort(item.valuePaisa)}
            </p>
          )}
          {item.annualIncomePaisa != null && item.annualIncomePaisa > 0 && (
            <p className="font-mono text-[10px] text-emerald-700">
              {formatINRShort(item.annualIncomePaisa)}/yr
            </p>
          )}
        </div>
      </div>

      {/* Per-class controls */}
      {cls === 'REAL_ESTATE' && item.included && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
          <select
            value={item.mode ?? 'SELL'}
            onChange={(e) =>
              onPatch({
                assetClass: cls,
                sourceId: item.id,
                mode: e.target.value,
              })
            }
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px]"
          >
            <option value="SELL">Sell at retirement</option>
            <option value="RENTAL">Rental income</option>
          </select>
          {item.mode === 'SELL' && (
            <>
              <label className="text-[10px] text-gray-500">Sale price (₹):</label>
              <input
                type="number"
                value={localSalePrice}
                onChange={(e) => setLocalSalePrice(e.target.value)}
                onBlur={() =>
                  onPatch({
                    assetClass: cls,
                    sourceId: item.id,
                    salePriceOverride: localSalePrice === '' ? null : Number(localSalePrice),
                  })
                }
                placeholder={`compound from ${(item.valuePaisa / 100).toFixed(0)}`}
                className="w-36 rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-right"
              />
              {localSalePrice !== '' && Number(localSalePrice) > 0 && (
                <span
                  className={`text-[10px] font-mono ${
                    Number(localSalePrice) * 100 < item.valuePaisa
                      ? 'text-amber-700'
                      : 'text-gray-500'
                  }`}
                  title={
                    Number(localSalePrice) * 100 < item.valuePaisa
                      ? 'Below current valuation — likely a units typo (₹1Cr = 1,00,00,000).'
                      : ''
                  }
                >
                  = {formatINRShort(Number(localSalePrice) * 100)}
                  {Number(localSalePrice) * 100 < item.valuePaisa && ' ⚠'}
                </span>
              )}
            </>
          )}
          {item.mode === 'RENTAL' && (
            <RentalInput
              cls={cls}
              item={item}
              onPatch={onPatch}
            />
          )}
        </div>
      )}

      {cls === 'NPS' && item.included && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-[11px]">
          <label className="text-gray-500">Lumpsum %:</label>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={item.npsLumpsumPct ?? 60}
            onChange={(e) =>
              onPatch({
                assetClass: cls,
                sourceId: item.id,
                npsLumpsumPct: Number(e.target.value),
              })
            }
            className="w-16 rounded border border-gray-300 bg-white px-2 py-0.5 font-mono"
          />
          <label className="text-gray-500">Annuity yield %:</label>
          <input
            type="number"
            min={0}
            step={0.25}
            value={item.npsAnnuityRatePct ?? 6}
            onChange={(e) =>
              onPatch({
                assetClass: cls,
                sourceId: item.id,
                npsAnnuityRatePct: Number(e.target.value),
              })
            }
            className="w-16 rounded border border-gray-300 bg-white px-2 py-0.5 font-mono"
          />
        </div>
      )}
    </div>
  );
}

/**
 * One row in the three-bucket SWP allocation card.
 */
function BucketRow({
  label,
  hint,
  tone,
  pct,
  ret,
  yrsHeld,
  initialPaisa,
  targetPaisa,
  setPct,
  setRet,
  setYrsHeld,
}: {
  label: string;
  hint: string;
  tone: 'emerald' | 'amber' | 'purple';
  pct: number;
  ret: number;
  yrsHeld: number | null;
  initialPaisa?: number;
  targetPaisa?: number | null;
  setPct: (v: number) => void;
  setRet: (v: number) => void;
  setYrsHeld?: (v: number) => void;
}) {
  const toneClasses =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : 'border-purple-200 bg-purple-50';
  const hasMismatch =
    typeof initialPaisa === 'number' &&
    typeof targetPaisa === 'number' &&
    targetPaisa > 0 &&
    initialPaisa < targetPaisa;
  return (
    <div className={`rounded-lg border p-3 ${toneClasses}`}>
      <p className="text-sm font-bold text-gray-900">{label}</p>
      <p className="text-[10px] text-gray-600 mb-2">{hint}</p>
      <label className="text-[10px] text-gray-500">Allocation %</label>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm font-mono text-right"
      />
      <label className="text-[10px] text-gray-500 mt-1 block">Return % p.a.</label>
      <input
        type="number"
        min={0}
        step={0.25}
        value={ret}
        onChange={(e) => setRet(Number(e.target.value))}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm font-mono text-right"
      />
      {yrsHeld !== null && setYrsHeld && (
        <>
          <label className="text-[10px] text-gray-500 mt-1 block">
            Hold (years of expense)
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={yrsHeld}
            onChange={(e) => setYrsHeld(Number(e.target.value))}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm font-mono text-right"
          />
        </>
      )}
      {typeof initialPaisa === 'number' && (
        <div className="mt-2 pt-2 border-t border-gray-200 text-[10px]">
          <p className="text-gray-500">At retirement:</p>
          <p className="font-mono">
            Initial: <span className="font-semibold">{formatINRShort(initialPaisa)}</span>
            {typeof targetPaisa === 'number' && (
              <>
                {' '}· Target: <span className="font-semibold">{formatINRShort(targetPaisa)}</span>
              </>
            )}
          </p>
          {hasMismatch && typeof targetPaisa === 'number' && (
            <p className="mt-1 text-amber-700">
              ⚠ Underfunded by {formatINRShort(targetPaisa - initialPaisa)} — upstream bucket will
              refill on year 1.
            </p>
          )}
          {typeof targetPaisa === 'number' &&
            !hasMismatch &&
            initialPaisa > targetPaisa * 1.5 && (
              <p className="mt-1 text-emerald-700">
                ✓ Above target — buffer for {((initialPaisa - targetPaisa) / Math.max(1, targetPaisa)).toFixed(1)}x extra years.
              </p>
            )}
        </div>
      )}
    </div>
  );
}

/**
 * Real-estate Rental-mode input: the user enters an expected monthly rent
 * AT RETIREMENT (already future-value). Used directly in the math without
 * inflation growth, so "₹50K/mo after I retire" means exactly that.
 *
 * If the property has a current monthly_rent on file (annualIncomePaisa >0),
 * we show it as context but the user's expected-future-rent always wins.
 */
function RentalInput({
  cls,
  item,
  onPatch,
}: {
  cls: AssetClassKey;
  item: RetirementItem;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [local, setLocal] = useState(
    item.expectedFutureRentPaisa
      ? String(Math.round(item.expectedFutureRentPaisa / 100))
      : '',
  );
  return (
    <>
      <label className="text-[10px] text-gray-500">
        Expected rent at retirement (₹/mo):
      </label>
      <input
        type="number"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() =>
          onPatch({
            assetClass: cls,
            sourceId: item.id,
            expectedFutureRent: local === '' ? null : Number(local),
          })
        }
        placeholder={
          item.annualIncomePaisa
            ? `current: ${Math.round((item.annualIncomePaisa ?? 0) / 12 / 100)}`
            : 'none on file'
        }
        className="w-32 rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-right"
      />
      {local !== '' && Number(local) > 0 && (
        <span className="text-[10px] font-mono text-gray-500">
          = {formatINRShort(Number(local) * 100)}/mo · {formatINRShort(Number(local) * 100 * 12)}/yr
        </span>
      )}
      {item.annualIncomePaisa != null && item.annualIncomePaisa > 0 && (
        <span className="text-[10px] text-gray-500">
          (current rent: {formatINRShort(item.annualIncomePaisa)}/yr — inflation-grown if no future override)
        </span>
      )}
    </>
  );
}

/** Calendar-year difference between two ISO dates, rounded down. */
function yearsBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  const moDiff = b.getUTCMonth() - a.getUTCMonth();
  if (moDiff < 0 || (moDiff === 0 && b.getUTCDate() < a.getUTCDate())) y -= 1;
  return Math.max(0, y);
}
