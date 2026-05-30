'use client';

import { useMemo, useState } from 'react';
import { Card, CardHeader, CardContent } from '@dxp/ui';
import { ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import {
  computeMidFlightBid,
  bestMidFlightBid,
  breakEvenMidFlightBid,
  type MidFlightBidArgs,
} from '@/lib/finance/chit-calculator';

interface ChitProp {
  chitValue: number;
  monthlyInstallment: number;
  durationMonths: number;
  foremanCommissionPct: number | null;
  documentChargesPaisa?: number | null;
  promptPaymentDiscountPct?: number | null;
  startDate: string;
  status: 'ACTIVE' | 'WON' | 'COMPLETED' | 'WITHDRAWN';
  winMonth: number | null;
  installmentsPaid: number | null;
  totalDividends: number | null;
  totalPaid: number | null;
}

interface InstallmentProp {
  monthNumber: number;
  paidOn: string;
  installmentPaid: number;
  dividendReceived: number | null;
}

interface BidAdvisorProps {
  chit: ChitProp;
  installments: InstallmentProp[];
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paisa / 100,
  );

const formatINRCompact = (paisa: number) => {
  const r = paisa / 100;
  if (Math.abs(r) >= 10000000) return `₹${(r / 10000000).toFixed(2)}Cr`;
  if (Math.abs(r) >= 100000) return `₹${(r / 100000).toFixed(2)}L`;
  if (Math.abs(r) >= 1000) return `₹${(r / 1000).toFixed(1)}K`;
  return `₹${Math.round(r).toLocaleString('en-IN')}`;
};

export function BidAdvisor({ chit, installments }: BidAdvisorProps) {
  const installmentsPaid = chit.installmentsPaid ?? 0;
  const currentMonth = installmentsPaid + 1;

  // Hide guards. Advisor is only useful while you're still eligible to bid.
  const closed =
    chit.status === 'COMPLETED' || chit.status === 'WITHDRAWN' || chit.status === 'WON';
  const alreadyWonInPast = chit.winMonth != null && chit.winMonth <= installmentsPaid;
  const cycleDone = installmentsPaid >= chit.durationMonths;
  if (closed || alreadyWonInPast || cycleDone) return null;

  // Effective dividend rate: prefer recent (last 6 installments) when available,
  // else lifetime. Recent better predicts current bid market.
  const totalDividends = chit.totalDividends ?? 0;
  const recentRows = installments
    .slice()
    .sort((a, b) => b.monthNumber - a.monthNumber)
    .slice(0, 6);
  const recentMonthsCount = recentRows.length;
  const recentDivSum = recentRows.reduce((s, r) => s + (r.dividendReceived ?? 0), 0);

  const usingFallbackDiv = installmentsPaid < 2;
  const lifetimeDivPct = installmentsPaid >= 1
    ? (totalDividends / (chit.monthlyInstallment * installmentsPaid)) * 100
    : 7;
  const recentDivPct = recentMonthsCount >= 3
    ? (recentDivSum / (chit.monthlyInstallment * recentMonthsCount)) * 100
    : lifetimeDivPct;
  const futureDivPct = recentMonthsCount >= 3 ? recentDivPct : lifetimeDivPct;
  const futureDivSource = recentMonthsCount >= 3 ? `recent ${recentMonthsCount}mo` : 'lifetime';

  // Chit constants
  const foremanPct = chit.foremanCommissionPct ?? 5;
  const docCharges = chit.documentChargesPaisa ?? 0;
  const promptPct = chit.promptPaymentDiscountPct ?? 0;
  const foremanCommission = (foremanPct / 100) * chit.chitValue;
  const naturalEndCheque = chit.chitValue - foremanCommission - docCharges;
  const minBidPaisa = foremanCommission;
  const maxBidPaisa = Math.round(chit.chitValue * 0.30);

  // Slider in BID space (what you give up). Cheque is derived.
  //   min bid = foreman commission (smallest legal bid)
  //   max bid = 30% × V (regulatory cap)
  //   cheque  = V − bid − docCharges

  const [expanded, setExpanded] = useState<boolean>(chit.winMonth == null);
  const [yourBid, setYourBid] = useState<number>(() =>
    Math.round((minBidPaisa + maxBidPaisa) / 2),
  );
  const [fdRatePct, setFdRatePct] = useState<number>(8);
  // User-overridable starting future dividend rate (default = auto-derived).
  // Decays linearly to 0 by chit end. Average over future months = this / 2.
  const [overrideDivPct, setOverrideDivPct] = useState<number | null>(null);
  const effectiveFutureDivPct = overrideDivPct ?? futureDivPct;

  const chequePaisa = chit.chitValue - yourBid - docCharges;

  // Reconstruct past flows. For bulk-imported chits (e.g., Dhanalakshmi has
  // only 1 per-month row but 26 months paid), generate synthetic entries for
  // missing months so the chit-level totals (totalPaid, totalDividends) are
  // honored. Otherwise XIRR explodes because past outflows are missing.
  const reconstructedPastFlows = useMemo(() => {
    const actualMap = new Map(installments.map((i) => [i.monthNumber, i]));
    const actualInstallSum = installments.reduce((s, i) => s + i.installmentPaid, 0);
    const actualDivSum = installments.reduce((s, i) => s + (i.dividendReceived ?? 0), 0);
    const missingCount = Math.max(0, installmentsPaid - installments.length);
    const avgMissingInstall = missingCount > 0
      ? Math.max(0, ((chit.totalPaid ?? 0) - actualInstallSum) / missingCount)
      : 0;
    const avgMissingDiv = missingCount > 0
      ? Math.max(0, ((chit.totalDividends ?? 0) - actualDivSum) / missingCount)
      : 0;

    const flows: Array<{ monthNumber: number; paidOn: string; installmentPaid: number; dividendReceived: number }> = [];
    const startDate = new Date(chit.startDate);
    for (let m = 1; m <= installmentsPaid; m++) {
      const actual = actualMap.get(m);
      if (actual) {
        flows.push({
          monthNumber: m,
          paidOn: actual.paidOn,
          installmentPaid: actual.installmentPaid,
          dividendReceived: actual.dividendReceived ?? 0,
        });
      } else {
        const d = new Date(startDate);
        d.setMonth(d.getMonth() + (m - 1));
        flows.push({
          monthNumber: m,
          paidOn: d.toISOString().substring(0, 10),
          installmentPaid: Math.round(avgMissingInstall),
          dividendReceived: Math.round(avgMissingDiv),
        });
      }
    }
    return flows;
  }, [installments, installmentsPaid, chit.totalPaid, chit.totalDividends, chit.startDate]);

  const baseArgs = useMemo<Omit<MidFlightBidArgs, 'yourBid'>>(
    () => ({
      chitValue: chit.chitValue,
      months: chit.durationMonths,
      monthlyInstallment: chit.monthlyInstallment,
      foremanCommissionPct: foremanPct,
      documentChargesPaisa: docCharges,
      promptPaymentDiscountPct: promptPct,
      pastInstallments: reconstructedPastFlows,
      currentMonth,
      futureDividendPct: effectiveFutureDivPct,
      fdRatePct,
      startDate: chit.startDate,
    }),
    [chit, reconstructedPastFlows, currentMonth, foremanPct, docCharges, promptPct, effectiveFutureDivPct, fdRatePct],
  );

  const result = useMemo(
    () => computeMidFlightBid({ ...baseArgs, yourBid }),
    [baseArgs, yourBid],
  );

  const bestFd = useMemo(() => bestMidFlightBid(baseArgs, 'fd'), [baseArgs]);
  const breakEven = useMemo(
    () => breakEvenMidFlightBid(baseArgs, fdRatePct, 'fd'),
    [baseArgs, fdRatePct],
  );

  const xirrA = result.xirrFdReinvested;
  const beatsFd = xirrA != null && xirrA >= fdRatePct;

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            <div>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Bid Advisor — Month {currentMonth} of {chit.durationMonths}
              </h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">
                Paid {formatINRCompact(chit.totalPaid ?? 0)} · Earned{' '}
                {formatINRCompact(totalDividends)} dividends
                {!usingFallbackDiv && ` · Effective dividend ${futureDivPct.toFixed(1)}% (${futureDivSource})`}
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
          <div className="space-y-4">
            {/* Reference: natural-end max */}
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
              <p className="font-semibold text-blue-900">
                If you don't bid: natural-end cheque = {formatINR(naturalEndCheque)}
              </p>
              <p className="mt-0.5 text-xs text-blue-800">
                When you're the only one left to bid (min bid = foreman {foremanPct}% = {formatINR(foremanCommission)}),
                you receive V − foreman − doc charges.
              </p>
            </div>

            {/* Bid slider + manual input */}
            <div>
              <label className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                <span>Your bid (discount given up)</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    step="100"
                    min={minBidPaisa / 100}
                    max={maxBidPaisa / 100}
                    value={Math.round(yourBid / 100)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const clamped = Math.min(maxBidPaisa, Math.max(minBidPaisa, Math.round(v * 100)));
                      setYourBid(clamped);
                    }}
                    className="w-32 rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-2 py-1 text-right font-mono text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  />
                  <span className="text-[10px] text-[var(--dxp-text-muted)]">₹</span>
                </span>
              </label>
              <input
                type="range"
                min={minBidPaisa}
                max={maxBidPaisa}
                step={Math.max(1000, Math.round((maxBidPaisa - minBidPaisa) / 100))}
                value={yourBid}
                onChange={(e) => setYourBid(Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-2 flex justify-between text-[11px] text-[var(--dxp-text-muted)]">
                <span>min: {formatINRCompact(minBidPaisa)} (foreman {foremanPct}%)</span>
                <span>max: {formatINRCompact(maxBidPaisa)} (30% cap)</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                <Stat label="Cheque you'd receive" value={formatINR(chequePaisa)} />
                <Stat label="Foreman keeps from bid" value={formatINR(result.foremanCommissionAtWin)} />
                <Stat label="Distributable to members" value={formatINR(result.distributablePool)} />
                <Stat label="Dividend per member" value={formatINR(result.ownDividendAtWin)} />
                <Stat label="Your net installment this month" value={formatINR(result.netInstallmentForOthers)} />
                <Stat label="Doc charges" value={formatINR(docCharges)} />
              </div>
            </div>

            {/* Future dividend rate slider */}
            <div>
              <label className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                <span>
                  Avg future dividend rate (% of installment)
                  {overrideDivPct == null && (
                    <span className="ml-2 normal-case text-[10px] text-[var(--dxp-text-muted)]">
                      auto = {futureDivPct.toFixed(1)}%
                    </span>
                  )}
                </span>
                <span className="font-mono normal-case text-[var(--dxp-text)]">
                  {effectiveFutureDivPct.toFixed(1)}%
                  {overrideDivPct != null && (
                    <button
                      onClick={() => setOverrideDivPct(null)}
                      className="ml-2 text-[10px] text-blue-600 hover:underline"
                    >
                      reset
                    </button>
                  )}
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={30}
                step={0.5}
                value={effectiveFutureDivPct}
                onChange={(e) => setOverrideDivPct(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[10px] text-[var(--dxp-text-muted)]">
                Starting rate for next month. Decays linearly to 0 by month {chit.durationMonths}.
                Average over remaining {chit.durationMonths - currentMonth + 1} months ={' '}
                <span className="font-mono">{(effectiveFutureDivPct / 2).toFixed(1)}%</span>.
              </p>

              {/* Dividend stats */}
              <div className="mt-2 grid grid-cols-3 gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                <Stat
                  label="Past dividends received"
                  value={formatINR(totalDividends)}
                />
                <Stat
                  label="Future projected"
                  value={formatINR(
                    Math.round(
                      (chit.monthlyInstallment * (effectiveFutureDivPct / 100) / 2) *
                        (chit.durationMonths - currentMonth + 1),
                    ),
                  )}
                />
                <Stat
                  label="Total at chit end"
                  value={formatINR(result.totalDividendsAtEnd)}
                />
              </div>
            </div>

            {/* Money rate slider */}
            <div>
              <label className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                <span>Money rate (FD return OR loan cost avoided)</span>
                <span className="font-mono normal-case text-[var(--dxp-text)]">{fdRatePct}%</span>
              </label>
              <input
                type="range"
                min={5}
                max={12}
                step={0.5}
                value={fdRatePct}
                onChange={(e) => setFdRatePct(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[10px] text-[var(--dxp-text-muted)]">
                Whether you'll invest the cheque (FD) or spend it (avoiding a loan), the time value
                is captured at this rate.
              </p>
            </div>

            {/* Single scenario panel */}
            <div className="rounded-lg border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Effective annualised return
              </p>
              <p className="mt-1 text-[11px] text-[var(--dxp-text-muted)]">
                Cheque {formatINRCompact(result.winnerCheque)} arrives month {currentMonth} → effective{' '}
                {formatINRCompact(result.winnerCheque + result.fdGrowthFromBid)} at {fdRatePct}%; plus{' '}
                {formatINRCompact(result.totalDividendsAtEnd)} total dividends received over chit life.
              </p>
              <p
                className={`mt-2 font-mono text-3xl font-bold ${
                  xirrA == null ? 'text-gray-400' : xirrA >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {xirrA == null ? '—' : `${xirrA.toFixed(2)}%`}
              </p>
              <div className="mt-3 space-y-1 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Money in
                </p>
                <Stat label="(+) Cheque (actual cash received)" value={formatINR(result.winnerCheque)} />
                <Stat label="(+) Money-rate gain on cheque" value={formatINR(result.fdGrowthFromBid)} />

                <p className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Money out (actual cash sent over {chit.durationMonths} months)
                </p>
                <Stat
                  label={`(−) Total installments (M × N = ${formatINRCompact(result.totalContributedAtEnd)})`}
                  value={formatINR(result.totalContributedAtEnd)}
                />
                <Stat
                  label={`(+) Less dividends earned`}
                  value={formatINR(result.totalDividendsAtEnd)}
                />
                <Stat
                  label="= Net cash out"
                  value={formatINR(result.totalContributedAtEnd - result.totalDividendsAtEnd)}
                />

                <div className="mt-2 border-t border-gray-300 pt-2">
                  <Stat
                    label="= Net gain at chit end (IN − OUT)"
                    value={formatINR(result.netProfit)}
                  />
                </div>
              </div>
            </div>

            {/* Decision banner */}
            {xirrA != null ? (
              beatsFd ? (
                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="text-sm">
                    <p className="font-semibold text-emerald-900">
                      Worth bidding — beats FD by {(xirrA - fdRatePct).toFixed(1)}%
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800">
                      Best bid for max return: <span className="font-mono font-bold">{formatINR(bestFd.bestBidPaisa)}</span>{' '}
                      ({bestFd.bestBidPct.toFixed(1)}%) → {bestFd.bestXirr.toFixed(1)}% XIRR
                      {breakEven != null && (
                        <>
                          {' · '}Break-even bid:{' '}
                          <span className="font-mono font-bold">{formatINR(breakEven)}</span> (any
                          higher bid still beats {fdRatePct}% FD)
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-900">
                      Skip this month — {(fdRatePct - xirrA).toFixed(1)}% below FD
                    </p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      {breakEven != null ? (
                        <>
                          Need bid ≥{' '}
                          <span className="font-mono font-bold">{formatINR(breakEven)}</span>{' '}
                          (cheque ≤ {formatINR(chit.chitValue - breakEven - docCharges)})
                          to clear {fdRatePct}% FD.
                        </>
                      ) : (
                        <>No bid in [{formatINRCompact(minBidPaisa)}, 30% × V] clears {fdRatePct}% FD.</>
                      )}
                      {' · '}Best possible: {bestFd.bestBidPct.toFixed(1)}% → {bestFd.bestXirr.toFixed(1)}%
                    </p>
                  </div>
                </div>
              )
            ) : (
              <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                Not enough data to compute return.
              </p>
            )}

            {/* Footer caption */}
            <p className="text-[10px] text-[var(--dxp-text-muted)]">
              {usingFallbackDiv
                ? '⚠ Limited history — using 7% default for future-month dividend forecast.'
                : `Forecast: future months start at ${futureDivPct.toFixed(1)}% dividend (${futureDivSource} avg) and decay linearly to 0 by month ${chit.durationMonths}. After winning, you keep paying installments AND keep receiving dividend share (decreasing each month).`}{' '}
              Foreman: {foremanPct}%, Doc charges: {formatINR(docCharges)}, Prompt discount: {promptPct}%.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-gray-600">{label}:</span>
      <span className="font-mono font-semibold text-gray-900">{value}</span>
    </div>
  );
}

function _UnusedScenarioCard({
  title,
  subtitle,
  xirr,
  fdRate,
  supporting,
}: {
  title: string;
  subtitle: string;
  xirr: number | null;
  fdRate: number;
  supporting: React.ReactNode;
}) {
  const beats = xirr != null && xirr >= fdRate;
  return (
    <div className="rounded-lg border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">{title}</p>
      <p className="mt-1 text-[11px] text-[var(--dxp-text-muted)]">{subtitle}</p>
      <p
        className={`mt-2 font-mono text-2xl font-bold ${
          xirr == null ? 'text-gray-400' : xirr >= 0 ? 'text-emerald-700' : 'text-rose-700'
        }`}
      >
        {xirr == null ? '—' : `${xirr.toFixed(2)}%`}
      </p>
      <p className="text-[11px] text-[var(--dxp-text-muted)]">effective annualised return</p>
      <p className="mt-2 text-[11px] text-[var(--dxp-text-secondary)]">{supporting}</p>
      {xirr != null && (
        <p className={`mt-1 text-[11px] font-semibold ${beats ? 'text-emerald-700' : 'text-amber-700'}`}>
          {beats ? `✓ Beats FD by ${(xirr - fdRate).toFixed(1)}%` : `⚠ ${(fdRate - xirr).toFixed(1)}% below FD`}
        </p>
      )}
    </div>
  );
}
