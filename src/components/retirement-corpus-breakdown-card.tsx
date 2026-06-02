'use client';

/**
 * Retirement corpus breakdown card — Sprint 5.11b.
 *
 * Replaces the plain "Corpus Selected → Grows To" StatsDisplay tile
 * with a two-level expandable card:
 *
 *   Level 0 (collapsed): just the total + "show breakdown" link
 *   Level 1 (expanded): asset-class summary table, each row clickable
 *   Level 2 (drilled):  per-component projection with balance-leg +
 *                       contribution-leg attribution (the two-leg
 *                       model from projectFutureValue)
 *
 * Reads from /api/finance/retirement-corpus-breakdown which produces
 * the same projection math the retirement-assets endpoint uses (so the
 * "Corpus selected → grows to" number on this card reconciles with the
 * 4-tile summary).
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent, Badge } from '@dxp/ui';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface Component {
  itemName: string;
  todayPaisa: number;
  atRetirementPaisa: number;
  growthRatePct: number;
  balanceComponentPaisa: number;
  contributionComponentPaisa: number;
  monthlyContributionPaisa: number;
}

interface AssetClassRow {
  assetClass: string;
  todayPaisa: number;
  atRetirementPaisa: number;
  growthMultiple: number;
  components: Component[];
}

interface BreakdownResp {
  totalCorpusAtRetirementPaisa: number;
  retirementYear: number;
  yearsToRetire: number;
  byAssetClass: AssetClassRow[];
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatINRShort = (paisa: number): string => {
  const rupees = paisa / 100;
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)}Cr`;
  if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(2)}L`;
  if (Math.abs(rupees) >= 1e3) return `₹${(rupees / 1e3).toFixed(1)}K`;
  return `₹${Math.round(rupees).toLocaleString('en-IN')}`;
};

const CLASS_LABELS: Record<string, string> = {
  STOCKS: 'Stocks',
  MUTUAL_FUNDS: 'Mutual Funds (uncategorised)',
  MF_EQUITY: 'Mutual Funds (Equity)',
  MF_DEBT: 'Mutual Funds (Debt)',
  MF_HYBRID: 'Mutual Funds (Hybrid)',
  NPS: 'NPS',
  EPF: 'EPF',
  SMALL_SAVINGS: 'PPF / VPF / SSY (Small Savings)',
  REAL_ESTATE: 'Real Estate (sell-mode)',
  FOREX: 'Forex Deposits',
  GOLD: 'Gold',
  INSURANCE: 'Insurance maturities',
  FD: 'Fixed Deposits',
};

const CLASS_HINTS: Record<string, string> = {
  NPS: 'contribution-heavy — 60% withdrawn, 40% annuitised at retirement',
  EPF: 'contribution-heavy — typically taken as lumpsum at retirement',
  SMALL_SAVINGS: 'rate-locked — PPF 7.1%, SSY 8.2%, etc.',
  REAL_ESTATE: 'appreciation @ class rate; rental income handled separately',
  FOREX: 'flat class rate; FX drift captured in the rate assumption',
  INSURANCE: 'policy-fixed maturity benefit',
};

export function RetirementCorpusBreakdownCard() {
  const [data, setData] = useState<BreakdownResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [openClass, setOpenClass] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/finance/retirement-corpus-breakdown')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 py-3 text-sm text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Computing corpus breakdown…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardContent>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              Corpus selected → grows to
            </p>
            <p className="mt-1 text-2xl font-bold font-mono text-[var(--dxp-brand-dark)]">
              {formatINR(data.totalCorpusAtRetirementPaisa)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--dxp-text-muted)]">
              Projected to year {data.retirementYear} ({data.yearsToRetire} years out)
            </p>
          </div>
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--dxp-brand)]">
            {expanded ? 'hide breakdown' : 'show breakdown'}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        {expanded && (
          <div className="mt-4 overflow-x-auto">
            {/* 5-column table (asset class + 3 numbers + note) overflows
                375px viewports. Hint only on mobile. */}
            <p className="mb-1 text-[10px] text-[var(--dxp-text-muted)] sm:hidden">
              scroll horizontally →
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dxp-border)] text-xs uppercase tracking-wider text-[var(--dxp-text-muted)]">
                  <th className="px-2 py-2 text-left font-medium">Asset class</th>
                  <th className="px-2 py-2 text-right font-medium">Today</th>
                  <th className="px-2 py-2 text-right font-medium">At retirement</th>
                  <th className="px-2 py-2 text-right font-medium">×</th>
                  <th className="px-2 py-2 text-left font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {data.byAssetClass.map((row) => {
                  const isOpen = openClass === row.assetClass;
                  return (
                    <React.Fragment key={row.assetClass}>
                      <tr
                        className="cursor-pointer border-b border-[var(--dxp-border)]/30 hover:bg-[var(--dxp-surface-alt)]/40"
                        onClick={() =>
                          setOpenClass(isOpen ? null : row.assetClass)
                        }
                      >
                        <td className="px-2 py-2 font-medium text-[var(--dxp-text)]">
                          <span className="inline-flex items-center gap-1">
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            {CLASS_LABELS[row.assetClass] ?? row.assetClass}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {formatINRShort(row.todayPaisa)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono font-semibold text-[var(--dxp-text)]">
                          {formatINRShort(row.atRetirementPaisa)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-emerald-700">
                          {row.todayPaisa > 0 ? `${row.growthMultiple.toFixed(1)}×` : '—'}
                        </td>
                        <td className="px-2 py-2 text-xs text-[var(--dxp-text-muted)]">
                          {CLASS_HINTS[row.assetClass] ?? ''}
                        </td>
                      </tr>
                      {/* Drill-down: per-component breakdown */}
                      {isOpen && (
                        <tr className="bg-[var(--dxp-surface-alt)]/30">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="space-y-3">
                              {row.components.map((c, idx) => (
                                <div
                                  key={`${row.assetClass}-${idx}`}
                                  className="rounded border border-[var(--dxp-border)] bg-white/40 p-3"
                                >
                                  <p className="text-sm font-semibold text-[var(--dxp-text)]">
                                    {c.itemName}
                                  </p>
                                  <div className="mt-1 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                    <div>
                                      <span className="text-[var(--dxp-text-muted)]">Today: </span>
                                      <span className="font-mono">{formatINRShort(c.todayPaisa)}</span>
                                    </div>
                                    <div>
                                      <span className="text-[var(--dxp-text-muted)]">Growth rate: </span>
                                      <span className="font-mono">{c.growthRatePct}%</span>
                                    </div>
                                    {c.monthlyContributionPaisa > 0 && (
                                      <div>
                                        <span className="text-[var(--dxp-text-muted)]">Monthly contrib: </span>
                                        <span className="font-mono">
                                          {formatINRShort(c.monthlyContributionPaisa)}
                                        </span>
                                      </div>
                                    )}
                                    <div>
                                      <span className="text-[var(--dxp-text-muted)]">At retirement: </span>
                                      <span className="font-mono font-semibold">
                                        {formatINRShort(c.atRetirementPaisa)}
                                      </span>
                                    </div>
                                  </div>
                                  {/* Two-leg attribution */}
                                  {c.contributionComponentPaisa > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                                      <Badge variant="info">
                                        Balance leg: {formatINRShort(c.balanceComponentPaisa)}
                                      </Badge>
                                      <Badge variant="success">
                                        Contribution leg: {formatINRShort(c.contributionComponentPaisa)}
                                      </Badge>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--dxp-border)] font-semibold">
                  <td className="px-2 py-2 text-[var(--dxp-text)]">Total</td>
                  <td className="px-2 py-2 text-right font-mono">
                    {formatINRShort(
                      data.byAssetClass.reduce((s, b) => s + b.todayPaisa, 0),
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">
                    {formatINR(data.totalCorpusAtRetirementPaisa)}
                  </td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                </tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">
              Each row uses its class&apos;s growth-rate assumption from
              Settings. Items with a monthly contribution (NPS, EPF, PPF,
              SSY) split into a Balance leg (current balance compounding)
              and a Contribution leg (recurring contribution annuity).
              Click a class row to see per-asset detail.
            </p>
            <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
              Note: this breakdown shows your FULL asset base projected
              to retirement. The &ldquo;Corpus selected → grows to&rdquo;
              tile above uses only items you&apos;ve ticked in for
              retirement on the asset-picker; the two numbers can differ
              when you&apos;ve earmarked specific MFs/properties for
              other goals.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
