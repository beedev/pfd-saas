'use client';

/**
 * Asset Class Return Assumptions — Settings card.
 *
 * Lets the user tune the default annual growth rate per asset class.
 * These rates feed the goal projection's value-weighted return blend
 * (lib/finance/goal-corpus.ts → weightedReturnForGoal).
 *
 * Per-instrument rates (FD interest_rate, Small Savings
 * interest_rate_percent, Chit fund xirr) override these when set;
 * this table is the FALLBACK for aggregate classes and instruments
 * without their own rate.
 *
 * One row per class. Commits on blur with optimistic UI + toast.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent, Input, Badge } from '@dxp/ui';
import { TrendingUp, Loader2 } from 'lucide-react';

type ClassRow = { assetClass: string; returnPct: number };

const LABELS: Record<string, string> = {
  STOCKS: 'Stocks',
  MUTUAL_FUNDS: 'Mutual Funds',
  GOLD: 'Gold',
  NPS: 'NPS',
  PF: 'EPF',
  SMALL_SAVINGS: 'Small Savings',
  FIXED_DEPOSITS: 'Fixed Deposits',
  CHIT_FUNDS: 'Chit Funds',
  REAL_ESTATE: 'Real Estate',
  INSURANCE_POLICIES: 'Insurance Policies',
};

// Hint text per class — concise, sourced from typical Indian rates
// (FY 2025-26) so the user knows what's "normal" before overriding.
const HINTS: Record<string, string> = {
  STOCKS: 'Nifty 50 long-term ~12%',
  MUTUAL_FUNDS: 'Blended equity ~11%, hybrid ~9%',
  GOLD: 'INR gold ~9–11% over decades',
  NPS: 'Tier-I 75/25 ~9.5%; lower for debt-heavy',
  PF: 'EPF rate ~8.25%',
  SMALL_SAVINGS: 'Per-account rate overrides this',
  FIXED_DEPOSITS: 'Per-FD rate overrides this',
  CHIT_FUNDS: 'Per-chit XIRR overrides this',
  REAL_ESTATE: 'Indian residential ~5–7% appreciation',
  INSURANCE_POLICIES: 'LIC endowment ~5% incl. bonus',
};

const ORDER = [
  'STOCKS',
  'MUTUAL_FUNDS',
  'GOLD',
  'NPS',
  'PF',
  'SMALL_SAVINGS',
  'FIXED_DEPOSITS',
  'CHIT_FUNDS',
  'REAL_ESTATE',
  'INSURANCE_POLICIES',
];

export function AssetClassReturnsForm() {
  const [rates, setRates] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingClass, setSavingClass] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/asset-class-returns')
      .then((r) => r.json())
      .then((d) => setRates(d.rates ?? []))
      .catch(() => toast.error('Failed to load asset growth assumptions'))
      .finally(() => setLoading(false));
  }, []);

  // Display order — ensure all known classes appear even if the table
  // hasn't been seeded yet (defensive).
  const orderedRows = ORDER.map(
    (cls) =>
      rates.find((r) => r.assetClass === cls) ?? {
        assetClass: cls,
        returnPct: 8,
      },
  );

  const commit = async (assetClass: string, returnPct: number) => {
    if (Number.isNaN(returnPct) || returnPct < 0 || returnPct > 50) {
      toast.error('Rate must be between 0 and 50');
      return;
    }
    setSavingClass(assetClass);
    try {
      const r = await fetch('/api/settings/asset-class-returns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetClass, returnPct }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      // Optimistic local update
      setRates((prev) => {
        const others = prev.filter((p) => p.assetClass !== assetClass);
        return [...others, { assetClass, returnPct }];
      });
      toast.success(`${LABELS[assetClass] ?? assetClass}: ${returnPct}%`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingClass(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--dxp-text)]">
          <TrendingUp className="h-5 w-5 text-[var(--dxp-brand)]" />
          Asset growth assumptions
        </h2>
        <p className="text-sm text-[var(--dxp-text-secondary)]">
          Default annual return per asset class. Used by goal projections
          when computing the weighted growth rate of your asset mix.
          Per-instrument rates (FD interest, NSC interest, chit XIRR)
          override these.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-2">
            {orderedRows.map((row) => (
              <RateRow
                key={row.assetClass}
                assetClass={row.assetClass}
                returnPct={row.returnPct}
                saving={savingClass === row.assetClass}
                onCommit={(pct) => commit(row.assetClass, pct)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RateRow({
  assetClass,
  returnPct,
  saving,
  onCommit,
}: {
  assetClass: string;
  returnPct: number;
  saving: boolean;
  onCommit: (pct: number) => void;
}) {
  const [value, setValue] = useState(String(returnPct));

  // Reset when server-side value changes (e.g., race after another tab
  // edited).
  useEffect(() => {
    setValue(String(returnPct));
  }, [returnPct]);

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded border border-[var(--dxp-border)] px-3 py-2 sm:grid-cols-[200px_1fr_auto]">
      <div className="min-w-0">
        <p className="font-semibold text-[var(--dxp-text)]">
          {LABELS[assetClass] ?? assetClass}
        </p>
      </div>
      <p className="hidden text-xs text-[var(--dxp-text-muted)] sm:block">
        {HINTS[assetClass] ?? ''}
      </p>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={50}
          step={0.25}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const next = parseFloat(value);
            if (Number.isFinite(next) && Math.abs(next - returnPct) > 0.001) {
              onCommit(next);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="w-24"
        />
        <span className="text-xs text-[var(--dxp-text-secondary)]">%</span>
        {saving && (
          <Badge variant="info">
            <Loader2 className="h-3 w-3 animate-spin" />
          </Badge>
        )}
      </div>
    </div>
  );
}
