'use client';

/**
 * Asset Class Return Assumptions — Settings card.
 *
 * Lets the user tune the default annual growth rate per asset class.
 * These rates feed the goal projection's value-weighted return blend
 * (lib/finance/goal-corpus.ts → weightedReturnForGoal).
 *
 * For FDs / Small Savings / Chits the user can additionally opt in to
 * have each instrument's actual rate (FD interest, NSC scheme rate,
 * chit XIRR) override the class rate. Off by default — conservative
 * planning is the safer behaviour.
 *
 * One row per class. Commits on blur with optimistic UI + toast.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent, Input, Badge } from '@dxp/ui';
import { TrendingUp, Loader2 } from 'lucide-react';

type ClassRow = {
  assetClass: string;
  returnPct: number;
  useInstrumentRate: boolean;
};

const LABELS: Record<string, string> = {
  STOCKS: 'Stocks',
  MUTUAL_FUNDS: 'Mutual Funds (uncategorised)',
  MF_EQUITY: 'MF — Equity',
  MF_DEBT: 'MF — Debt',
  MF_HYBRID: 'MF — Hybrid',
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
// so the user knows what's "normal" before tuning their planning rate.
const HINTS: Record<string, string> = {
  STOCKS: 'Nifty 50 long-term ~12% — set conservatively',
  MUTUAL_FUNDS: 'Umbrella rate — used only when fund category is UNKNOWN',
  MF_EQUITY: 'Equity MFs (large/mid/small/flexi/ELSS) ~10–12%',
  MF_DEBT: 'Debt MFs (corp bond, liquid, gilt) ~6–8%',
  MF_HYBRID: 'Hybrid / multi-asset / arbitrage ~8–10%',
  GOLD: 'INR gold ~9–11% — bumpy historically',
  NPS: 'Tier-I 75/25 ~9.5%; lower for debt-heavy',
  PF: 'EPF rate ~8.25%',
  SMALL_SAVINGS: 'Govt rates 7–8.2% — see individual scheme',
  FIXED_DEPOSITS: 'Bank rates 6–8%',
  CHIT_FUNDS: 'Historical XIRR not guaranteed — plan low',
  REAL_ESTATE: 'Indian residential ~5–7% appreciation',
  INSURANCE_POLICIES: 'LIC endowment ~5% incl. bonus',
};

// Only itemized classes have a meaningful per-instrument rate concept
// (an FD has its own interest rate, a chit has computed XIRR, an SSA
// has its scheme rate). For the other classes the toggle is hidden.
const HAS_INSTRUMENT_RATE: Record<string, boolean> = {
  FIXED_DEPOSITS: true,
  SMALL_SAVINGS: true,
  CHIT_FUNDS: true,
};

const ORDER = [
  'STOCKS',
  'MUTUAL_FUNDS',
  'MF_EQUITY',
  'MF_DEBT',
  'MF_HYBRID',
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
        useInstrumentRate: false,
      },
  );

  const commit = async (
    assetClass: string,
    patch: { returnPct?: number; useInstrumentRate?: boolean },
  ) => {
    if (
      patch.returnPct !== undefined &&
      (Number.isNaN(patch.returnPct) || patch.returnPct < 0 || patch.returnPct > 50)
    ) {
      toast.error('Rate must be between 0 and 50');
      return;
    }
    setSavingClass(assetClass);
    try {
      const r = await fetch('/api/settings/asset-class-returns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetClass, ...patch }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      // Optimistic local update — merge the patch into existing row
      setRates((prev) => {
        const existing = prev.find((p) => p.assetClass === assetClass) ?? {
          assetClass,
          returnPct: 8,
          useInstrumentRate: false,
        };
        const merged: ClassRow = { ...existing, ...patch };
        const others = prev.filter((p) => p.assetClass !== assetClass);
        return [...others, merged];
      });
      if (patch.returnPct !== undefined) {
        toast.success(`${LABELS[assetClass] ?? assetClass}: ${patch.returnPct}%`);
      } else if (patch.useInstrumentRate !== undefined) {
        toast.success(
          `${LABELS[assetClass] ?? assetClass}: ${patch.useInstrumentRate ? 'use actual rates' : 'use class rate'}`,
        );
      }
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
          Annual return per asset class used by goal projections. Set
          these conservatively — past performance is not a guarantee,
          and pleasant surprise is better than missed target.
        </p>
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          For Fixed Deposits, Small Savings and Chit Funds: the class
          rate applies to <em>all</em> instruments by default. Flip the
          per-class toggle if you want to use each instrument&apos;s
          actual rate (FD interest, NSC scheme rate, chit XIRR) instead.
        </p>
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          MF subclass rates (MF — Equity / Debt / Hybrid) apply ONLY when
          the fund&apos;s category is set on its detail page. Funds with
          category &lsquo;Unknown&rsquo; fall back to the umbrella
          &lsquo;Mutual Funds&rsquo; rate above.
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
                useInstrumentRate={row.useInstrumentRate}
                saving={savingClass === row.assetClass}
                onCommit={(patch) => commit(row.assetClass, patch)}
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
  useInstrumentRate,
  saving,
  onCommit,
}: {
  assetClass: string;
  returnPct: number;
  useInstrumentRate: boolean;
  saving: boolean;
  onCommit: (patch: { returnPct?: number; useInstrumentRate?: boolean }) => void;
}) {
  const [value, setValue] = useState(String(returnPct));

  // Reset when server-side value changes (e.g., race after another tab
  // edited).
  useEffect(() => {
    setValue(String(returnPct));
  }, [returnPct]);

  const showToggle = HAS_INSTRUMENT_RATE[assetClass] ?? false;

  return (
    <div className="rounded border border-[var(--dxp-border)] px-3 py-2">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[200px_1fr_auto]">
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
                onCommit({ returnPct: next });
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
      {showToggle && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--dxp-text-secondary)]">
          <input
            type="checkbox"
            checked={useInstrumentRate}
            onChange={(e) => onCommit({ useInstrumentRate: e.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--dxp-brand)]"
          />
          <span>
            Use each instrument&apos;s actual rate instead of {returnPct}% (
            {assetClass === 'FIXED_DEPOSITS' && 'FD interest rate'}
            {assetClass === 'SMALL_SAVINGS' && 'scheme rate per account'}
            {assetClass === 'CHIT_FUNDS' && 'per-chit XIRR'}
            ). Off = conservative class rate applies to all.
          </span>
        </label>
      )}
    </div>
  );
}
