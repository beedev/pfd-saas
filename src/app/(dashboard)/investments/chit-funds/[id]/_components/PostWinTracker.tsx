'use client';

import { useMemo, useState } from 'react';
import { Card, CardHeader, CardContent } from '@dxp/ui';
import { Trophy, ChevronDown, ChevronUp } from 'lucide-react';
import { buildChitCashFlowsFromSummary } from '@/lib/finance/chit-xirr';
import { calculateXirr } from '@/lib/finance/xirr';

interface ChitProp {
  chitValue: number;
  monthlyInstallment: number;
  durationMonths: number;
  startDate: string;
  expectedEndDate: string;
  status: 'ACTIVE' | 'WON' | 'COMPLETED' | 'WITHDRAWN';
  winMonth: number | null;
  winDate: string | null;
  winAmountReceived: number | null;
  installmentsPaid: number | null;
  totalPaid: number | null;
  totalDividends: number | null;
}

interface InstallmentProp {
  monthNumber: number;
  paidOn: string;
  installmentPaid: number;
  dividendReceived: number | null;
}

interface PostWinTrackerProps {
  chit: ChitProp;
  installments: InstallmentProp[];
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export function PostWinTracker({ chit, installments }: PostWinTrackerProps) {
  // Only show for WON chits with future months remaining.
  if (chit.status !== 'WON') return null;
  const installmentsPaid = chit.installmentsPaid ?? 0;
  const remainingMonths = chit.durationMonths - installmentsPaid;
  if (remainingMonths <= 0) return null;

  const totalDividends = chit.totalDividends ?? 0;
  const lifetimeDivPct =
    installmentsPaid > 0 && chit.monthlyInstallment > 0
      ? (totalDividends / (chit.monthlyInstallment * installmentsPaid)) * 100
      : 0;

  // Recent 6-month dividend % — usually a sharper indicator than lifetime,
  // because dividend rates trend down as the chit matures.
  const recentRows = installments
    .slice()
    .sort((a, b) => b.monthNumber - a.monthNumber)
    .slice(0, 6);
  const recentDivPct =
    recentRows.length >= 3 && chit.monthlyInstallment > 0
      ? (recentRows.reduce((s, r) => s + (r.dividendReceived ?? 0), 0) /
          (chit.monthlyInstallment * recentRows.length)) *
        100
      : lifetimeDivPct;

  const [expanded, setExpanded] = useState<boolean>(true);
  const [futureDivPct, setFutureDivPct] = useState<number>(() =>
    Math.max(0, Math.min(30, Number((recentDivPct || lifetimeDivPct || 0).toFixed(1)))),
  );
  const [fdRatePct, setFdRatePct] = useState<number>(8);

  // Average dividend over the remaining months given linear decay to 0.
  // For a starting rate r decaying linearly to 0 across N months, the average
  // is r / 2 (midpoint of a triangle).
  const avgFutureDivPct = futureDivPct / 2;
  const projectedFutureDividendPaisa = Math.round(
    (chit.monthlyInstallment * (avgFutureDivPct / 100)) * remainingMonths,
  );
  const projectedFutureNetOutgoPaisa =
    chit.monthlyInstallment * remainingMonths - projectedFutureDividendPaisa;

  // Raw XIRR — cheque arrives at win date, no reinvestment assumed.
  const projectedXirr = useMemo(() => {
    const flows = buildChitCashFlowsFromSummary({
      startDate: chit.startDate,
      expectedEndDate: chit.expectedEndDate,
      durationMonths: chit.durationMonths,
      installmentsPaid,
      monthlyInstallmentPaisa: chit.monthlyInstallment,
      totalPaidPaisa: chit.totalPaid ?? 0,
      chitValuePaisa: chit.chitValue,
      status: chit.status,
      winDate: chit.winDate,
      winAmountReceivedPaisa: chit.winAmountReceived,
      futureDividendStartPct: futureDivPct,
    });
    return calculateXirr(flows);
  }, [chit, installmentsPaid, futureDivPct]);

  // FD-reinvested XIRR — cheque grows from win date → chit end at fdRatePct.
  // Models "I can either invest at 8% or avoid a loan at 8%" framing.
  const fdReinvestXirr = useMemo(() => {
    const flows = buildChitCashFlowsFromSummary({
      startDate: chit.startDate,
      expectedEndDate: chit.expectedEndDate,
      durationMonths: chit.durationMonths,
      installmentsPaid,
      monthlyInstallmentPaisa: chit.monthlyInstallment,
      totalPaidPaisa: chit.totalPaid ?? 0,
      chitValuePaisa: chit.chitValue,
      status: chit.status,
      winDate: chit.winDate,
      winAmountReceivedPaisa: chit.winAmountReceived,
      futureDividendStartPct: futureDivPct,
      reinvestRatePct: fdRatePct,
    });
    return calculateXirr(flows);
  }, [chit, installmentsPaid, futureDivPct, fdRatePct]);

  // Cheque value at chit end after FD growth (or loan-interest avoided).
  const msPerMonth = 30.4375 * 24 * 3600 * 1000;
  const monthsWinToEnd =
    chit.winDate && chit.expectedEndDate
      ? Math.max(
          0,
          (new Date(chit.expectedEndDate).getTime() - new Date(chit.winDate).getTime()) / msPerMonth,
        )
      : 0;
  const grownChequePaisa = Math.round(
    (chit.winAmountReceived ?? 0) * Math.pow(1 + fdRatePct / 100 / 12, monthsWinToEnd),
  );
  const fdGrowthPaisa = grownChequePaisa - (chit.winAmountReceived ?? 0);

  // totalPaid is already NET of past dividends (one is the realised outflow,
  // the other is the realised inflow). To present a clean money-in vs money-out
  // ledger:
  //   moneyIn  = cheque + past dividends + projected future dividends
  //   moneyOut = past GROSS + future GROSS
  //   past GROSS = totalPaid + totalDividends    (per-installment ledger sum)
  //   future GROSS = monthlyInstallment × remainingMonths
  const pastGrossPaisa = (chit.totalPaid ?? 0) + totalDividends;
  const futureGrossPaisa = chit.monthlyInstallment * remainingMonths;
  const totalDividendsAtEnd = totalDividends + projectedFutureDividendPaisa;
  const netPosition =
    (chit.winAmountReceived ?? 0) +
    totalDividendsAtEnd -
    (pastGrossPaisa + futureGrossPaisa);
  // ^ algebraically equal to: cheque − (totalPaid + projectedFutureNetOutgo)
  // since dividends and gross cancel out. We expand both forms below for the
  // user — net-cash view first, gross view as reference.

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-emerald-600" />
            <div>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Post-win forecast — {remainingMonths} months remaining
              </h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">
                You still receive a dividend share each month until the chit ends.
                Lifetime dividend: {lifetimeDivPct.toFixed(1)}%
                {recentRows.length >= 3 && ` · Recent ${recentRows.length}mo: ${recentDivPct.toFixed(1)}%`}
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
            {/* Future dividend rate slider */}
            <div>
              <label className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                <span>Assumed future dividend rate (% of installment)</span>
                <span className="font-mono normal-case text-[var(--dxp-text)]">
                  {futureDivPct.toFixed(1)}%
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={30}
                step={0.5}
                value={futureDivPct}
                onChange={(e) => setFutureDivPct(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[10px] text-[var(--dxp-text-muted)]">
                Starting rate for next month, decaying linearly to 0 by month{' '}
                {chit.durationMonths}. Average over remaining {remainingMonths} months ={' '}
                <span className="font-mono">{avgFutureDivPct.toFixed(1)}%</span>.
              </p>

              {/* Dividend stats */}
              <div className="mt-3 grid grid-cols-3 gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                <Stat label="Past dividends received" value={formatINR(totalDividends)} />
                <Stat
                  label={`Projected future (${remainingMonths}mo)`}
                  value={formatINR(projectedFutureDividendPaisa)}
                />
                <Stat label="Total at chit end" value={formatINR(totalDividendsAtEnd)} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                <Stat
                  label="Future gross installments"
                  value={formatINR(chit.monthlyInstallment * remainingMonths)}
                />
                <Stat
                  label="Future net outgo (after div)"
                  value={formatINR(projectedFutureNetOutgoPaisa)}
                />
              </div>
            </div>

            {/* Money rate slider */}
            <div>
              <label className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                <span>Money rate (FD benchmark)</span>
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
            </div>

            {/* XIRR result panel — two views */}
            <div className="rounded-lg border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Raw XIRR
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--dxp-text-muted)]">
                    Cheque received at win date, not reinvested
                  </p>
                  <p
                    className={`mt-1 font-mono text-2xl font-bold ${
                      projectedXirr == null
                        ? 'text-gray-400'
                        : projectedXirr >= 0
                          ? 'text-emerald-700'
                          : 'text-rose-700'
                    }`}
                  >
                    {projectedXirr == null ? '—' : `${projectedXirr.toFixed(2)}%`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Effective XIRR @ {fdRatePct}% reinvest
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--dxp-text-muted)]">
                    Cheque invested at {fdRatePct}% till chit end (or loan avoided)
                  </p>
                  <p
                    className={`mt-1 font-mono text-2xl font-bold ${
                      fdReinvestXirr == null
                        ? 'text-gray-400'
                        : fdReinvestXirr >= 0
                          ? 'text-emerald-700'
                          : 'text-rose-700'
                    }`}
                  >
                    {fdReinvestXirr == null ? '—' : `${fdReinvestXirr.toFixed(2)}%`}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-[var(--dxp-text-muted)]">
                Cheque {formatINR(chit.winAmountReceived ?? 0)} at month{' '}
                {chit.winMonth ?? '—'} → grows to{' '}
                <span className="font-mono font-semibold text-[var(--dxp-text)]">
                  {formatINR(grownChequePaisa)}
                </span>{' '}
                at chit end ({monthsWinToEnd.toFixed(1)} months @ {fdRatePct}%, gain{' '}
                {formatINR(fdGrowthPaisa)}).{' '}
                {fdReinvestXirr != null && (
                  <>
                    {fdReinvestXirr >= fdRatePct
                      ? `Beats FD by ${(fdReinvestXirr - fdRatePct).toFixed(1)}%`
                      : `${(fdRatePct - fdReinvestXirr).toFixed(1)}% below FD`}
                    .
                  </>
                )}
              </p>

              <div className="mt-3 space-y-1 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Cash position at chit end
                </p>
                <Stat label="(+) Cheque received" value={formatINR(chit.winAmountReceived ?? 0)} />
                <Stat
                  label="(−) Past cash paid (net of dividend)"
                  value={formatINR(chit.totalPaid ?? 0)}
                />
                <Stat
                  label="(−) Future cash out (after projected dividend)"
                  value={formatINR(projectedFutureNetOutgoPaisa)}
                />
                <div className="mt-2 border-t border-gray-300 pt-2">
                  <Stat
                    label="= Net position at chit end"
                    value={formatINR(netPosition)}
                  />
                </div>
                <p className="mt-2 text-[10px] text-gray-500">
                  For reference (gross view): past gross {formatINR(pastGrossPaisa)} − past div{' '}
                  {formatINR(totalDividends)} = past cash {formatINR(chit.totalPaid ?? 0)}; future
                  gross {formatINR(futureGrossPaisa)} − projected future div{' '}
                  {formatINR(projectedFutureDividendPaisa)} = future cash{' '}
                  {formatINR(projectedFutureNetOutgoPaisa)}.
                </p>
              </div>
            </div>

            <p className="text-[10px] text-[var(--dxp-text-muted)]">
              Dividend projection uses your historical average and decays linearly to zero
              by the chit&apos;s last month (typical chit-fund pattern — fewer eligible bidders
              later mean smaller dividend pools). Adjust the slider to model best/worst cases.
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
