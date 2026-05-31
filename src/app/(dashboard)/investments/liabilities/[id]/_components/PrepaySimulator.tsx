'use client';

/**
 * Prepayment what-if simulator for any non-credit-card loan.
 *
 * Two levers (monthly extra + one-time lump sum), a small balance-curve chart,
 * and a stats panel answering the two questions that actually matter:
 *   "How much interest do I save?"   and   "How soon does the loan close?"
 *
 * Models tenure-reduction prepay (EMI constant, schedule shortens). All money
 * flows through here in paisa; the parent passes paisa, we render rupees.
 */

import { useMemo, useState } from 'react';
import { Card, CardHeader, CardContent } from '@dxp/ui';
import {
  ChevronDown,
  ChevronUp,
  TrendingDown,
  CalendarClock,
  Wallet,
  Sparkles,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { comparePrepay } from '@/lib/finance/prepay-simulator';

interface Props {
  /** Current outstanding (paisa). */
  outstandingPaisa: number;
  /** Annual interest rate as percent (e.g. 9.5). */
  annualRate: number;
  /** Contractual EMI (paisa). */
  baseEmiPaisa: number;
  /** Date of the next EMI — used to project payoff date. */
  nextEmiDate: string | null;
}

const fmtINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const fmtINRCompact = (paisa: number) => {
  const r = paisa / 100;
  const abs = Math.abs(r);
  if (abs >= 1_00_00_000) return `₹${(r / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(r / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(r / 1_000).toFixed(1)}K`;
  return `₹${Math.round(r).toLocaleString('en-IN')}`;
};

const fmtMonthYear = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : '—';

const monthsToYearsLabel = (m: number) => {
  if (m <= 0) return '0 months';
  const y = Math.floor(m / 12);
  const rem = m % 12;
  if (y === 0) return `${m} mo`;
  if (rem === 0) return `${y} yr`;
  return `${y} yr ${rem} mo`;
};

export function PrepaySimulator({
  outstandingPaisa,
  annualRate,
  baseEmiPaisa,
  nextEmiDate,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [monthlyExtraRupees, setMonthlyExtraRupees] = useState<number>(0);
  const [lumpRupees, setLumpRupees] = useState<number>(0);
  const [penaltyPct, setPenaltyPct] = useState<number>(0);

  // Cap sliders sensibly: lump sum up to the full outstanding; monthly extra
  // up to 2× EMI (anything bigger is unrealistic monthly capacity).
  const lumpMaxRupees = Math.floor(outstandingPaisa / 100);
  const monthlyMaxRupees = Math.max(10000, Math.floor((baseEmiPaisa * 2) / 100));
  const monthlyStep = Math.max(500, Math.round(monthlyMaxRupees / 200));
  const lumpStep = Math.max(5000, Math.round(lumpMaxRupees / 200));

  const cmp = useMemo(
    () =>
      comparePrepay(
        {
          outstandingPaisa,
          annualRate,
          baseEmiPaisa,
          monthlyExtraPaisa: Math.round(monthlyExtraRupees * 100),
          lumpSumPaisa: Math.round(lumpRupees * 100),
          penaltyPct,
        },
        nextEmiDate,
      ),
    [
      outstandingPaisa,
      annualRate,
      baseEmiPaisa,
      monthlyExtraRupees,
      lumpRupees,
      penaltyPct,
      nextEmiDate,
    ],
  );

  // Build the chart series: overlay both curves on the same x axis (months).
  // Baseline runs full length; scenario shortens — pad with zeros so the area
  // visually closes at the payoff month.
  const chartData = useMemo(() => {
    const baseCurve = cmp.base.balanceCurve;
    const scenCurve = cmp.scenario.balanceCurve;
    const len = Math.max(baseCurve.length, scenCurve.length);
    const start = nextEmiDate ? new Date(nextEmiDate) : null;
    const data: Array<{ month: number; label: string; base: number; scenario: number }> = [];
    for (let i = 0; i < len; i++) {
      let label = `M${i}`;
      if (start) {
        const d = new Date(start);
        d.setMonth(d.getMonth() + i);
        label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      }
      data.push({
        month: i,
        label,
        base: Math.max(0, baseCurve[i] ?? 0) / 100,
        scenario: Math.max(0, scenCurve[i] ?? 0) / 100,
      });
    }
    return data;
  }, [cmp, nextEmiDate]);

  const hasAnyPrepay = monthlyExtraRupees > 0 || lumpRupees > 0;
  const interestSavedPaisa = cmp.interestSavedPaisa;

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <div className="text-left">
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                What if I prepay extra?
              </h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">
                Tenure-reduction model · EMI stays {fmtINR(baseEmiPaisa)}
                {hasAnyPrepay && (
                  <>
                    {' '}
                    ·{' '}
                    <span className="font-semibold text-emerald-700">
                      saves {fmtINRCompact(interestSavedPaisa)} · closes{' '}
                      {cmp.monthsSaved} mo sooner
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[var(--dxp-text-muted)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--dxp-text-muted)]" />
          )}
        </button>
      </CardHeader>

      {expanded && (
        <CardContent>
          <div className="space-y-5">
            {/* Lump sum slider */}
            <SliderRow
              label="Lump sum today"
              hint="One-time prepayment from a bonus, FD maturity, etc."
              value={lumpRupees}
              setValue={setLumpRupees}
              min={0}
              max={lumpMaxRupees}
              step={lumpStep}
              presets={[
                { label: '₹50k', v: 50_000 },
                { label: '₹1L', v: 1_00_000 },
                { label: '₹2L', v: 2_00_000 },
                { label: '₹5L', v: 5_00_000 },
              ].filter((p) => p.v <= lumpMaxRupees)}
            />

            {/* Monthly extra slider */}
            <SliderRow
              label="Extra every month"
              hint="Added to EMI each month — compounds fastest."
              value={monthlyExtraRupees}
              setValue={setMonthlyExtraRupees}
              min={0}
              max={monthlyMaxRupees}
              step={monthlyStep}
              presets={[
                { label: '₹2k', v: 2_000 },
                { label: '₹5k', v: 5_000 },
                { label: '₹10k', v: 10_000 },
                { label: '₹25k', v: 25_000 },
              ].filter((p) => p.v <= monthlyMaxRupees)}
            />

            {/* Penalty (compact, default 0). Only shown if user wants to model it. */}
            <div className="flex items-center justify-between gap-3 rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] px-3 py-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Prepay penalty (on lump sum)
                </p>
                <p className="text-[11px] text-[var(--dxp-text-muted)]">
                  Floating-rate home loans: 0% by RBI. Fixed: 2–4% common.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.5}
                  value={penaltyPct}
                  onChange={(e) => setPenaltyPct(Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
                  className="w-16 rounded border border-[var(--dxp-border)] bg-white px-2 py-1 text-right font-mono text-sm focus:border-[var(--dxp-brand)] focus:outline-none"
                />
                <span className="text-xs text-[var(--dxp-text-muted)]">%</span>
              </div>
            </div>

            {/* Stats grid — the two answers, big and clear */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                icon={<TrendingDown className="h-4 w-4 text-emerald-600" />}
                label="Interest saved"
                value={fmtINRCompact(interestSavedPaisa)}
                sub={`was ${fmtINRCompact(cmp.base.totalInterestPaisa)} → ${fmtINRCompact(cmp.scenario.totalInterestPaisa)}`}
                tone="positive"
              />
              <Stat
                icon={<CalendarClock className="h-4 w-4 text-blue-600" />}
                label="Loan closes"
                value={fmtMonthYear(cmp.scenario.payoffDateIso)}
                sub={
                  cmp.monthsSaved > 0
                    ? `${cmp.monthsSaved} mo sooner (${monthsToYearsLabel(cmp.monthsSaved)})`
                    : `was ${fmtMonthYear(cmp.base.payoffDateIso)}`
                }
                tone={cmp.monthsSaved > 0 ? 'positive' : 'neutral'}
              />
              <Stat
                icon={<Wallet className="h-4 w-4 text-[var(--dxp-text-muted)]" />}
                label="New tenure"
                value={`${cmp.scenario.months} mo`}
                sub={`${monthsToYearsLabel(cmp.scenario.months)} (was ${cmp.base.months})`}
                tone="neutral"
              />
              <Stat
                icon={<Wallet className="h-4 w-4 text-[var(--dxp-text-muted)]" />}
                label="Total outflow"
                value={fmtINRCompact(cmp.scenario.totalPaidPaisa)}
                sub={`baseline ${fmtINRCompact(cmp.base.totalPaidPaisa)}`}
                tone="neutral"
              />
            </div>

            {/* Balance curve chart */}
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="prepayBase" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="prepayScen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--dxp-border-light)" />
                  <XAxis
                    dataKey="label"
                    interval="preserveStartEnd"
                    minTickGap={40}
                    fontSize={11}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtINRCompact(v * 100)}
                    width={60}
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(v) => fmtINR(Number(v) * 100)}
                    labelFormatter={(l) => `Month: ${l}`}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="base"
                    name="Baseline (no prepay)"
                    stroke="#3b82f6"
                    fill="url(#prepayBase)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="scenario"
                    name="With prepay"
                    stroke="#10b981"
                    fill="url(#prepayScen)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[11px] text-[var(--dxp-text-muted)]">
              Outstanding {fmtINR(outstandingPaisa)} · ROI {annualRate}% · EMI{' '}
              {fmtINR(baseEmiPaisa)}
              {nextEmiDate &&
                ` · next EMI ${new Date(nextEmiDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/* ─── small subcomponents ──────────────────────────────────────────────── */

interface SliderRowProps {
  label: string;
  hint: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
  presets: Array<{ label: string; v: number }>;
}

function SliderRow({ label, hint, value, setValue, min, max, step, presets }: SliderRowProps) {
  return (
    <div>
      <label className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        <span>{label}</span>
        <span className="flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              setValue(Math.max(min, Math.min(max, Math.round(v))));
            }}
            className="w-32 rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-2 py-1 text-right font-mono text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
          />
          <span className="text-[10px] text-[var(--dxp-text-muted)]">₹</span>
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full"
      />
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--dxp-text-muted)]">
        <span>{hint}</span>
        <div className="flex gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setValue(p.v)}
              className={`rounded border px-2 py-0.5 transition-colors ${
                value === p.v
                  ? 'border-[var(--dxp-brand)] bg-blue-50 text-[var(--dxp-brand)]'
                  : 'border-[var(--dxp-border)] hover:bg-[var(--dxp-surface)]'
              }`}
            >
              {p.label}
            </button>
          ))}
          {value > 0 && (
            <button
              type="button"
              onClick={() => setValue(0)}
              className="rounded border border-[var(--dxp-border)] px-2 py-0.5 text-[var(--dxp-text-muted)] hover:bg-[var(--dxp-surface)]"
            >
              reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'positive' | 'neutral';
}

function Stat({ icon, label, value, sub, tone }: StatProps) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === 'positive'
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-[var(--dxp-border-light)] bg-[var(--dxp-surface)]'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {icon}
        {label}
      </div>
      <p
        className={`mt-1 font-mono text-lg font-bold ${
          tone === 'positive' ? 'text-emerald-700' : 'text-[var(--dxp-text)]'
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] text-[var(--dxp-text-muted)]">{sub}</p>
    </div>
  );
}
