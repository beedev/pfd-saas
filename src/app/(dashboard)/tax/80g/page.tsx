'use client';

/**
 * Section 80G — four-bucket layout (Sprint 5.2 commit 3, item F).
 *
 * Four stacked cards, one per CBDT category:
 *   1. PM CARES / PMNRF / 100% no limit
 *   2. Local NGOs with 80G cert — 50% no limit
 *   3. Govt bodies — 100% with 10% GTI cap
 *   4. Other NGOs — 50% with 10% GTI cap
 *
 * Top stats: total donated, total deductible (post-cap × rate), 10%-cap
 * applied figure. Each bucket shows its rows + a per-bucket subtotal +
 * (for limited buckets) the post-cap effective deduction.
 *
 * Reads /api/tax/deductions?fy=&section=80G for rows and
 * /api/tax/regime-compare?fy= to pull the pre-computed
 * `deductions.eightyG.byCategory` figures (which already honour the
 * 10% cap math).
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, Badge, Select } from '@dxp/ui';
import { Plus, Loader2, Gift, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

type EightyGCat =
  | '100_NO_LIMIT'
  | '50_NO_LIMIT'
  | '100_WITH_LIMIT'
  | '50_WITH_LIMIT';

interface Deduction {
  id: number;
  section: string;
  description: string;
  amountPaisa: number | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  recipientName: string | null;
  recipientPan: string | null;
  recipient80gNumber: string | null;
  qualifyingPercent: number | null;
  hasUpperLimit: boolean | null;
  eightyGCategory: EightyGCat | null;
  financialYear: string;
}

interface RegimeCompareResp {
  deductions?: {
    eightyG?: {
      byCategory?: Record<EightyGCat, number>;
      totalDeductionPaisa?: number;
    };
  };
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

function previousFy(): string {
  const c = getCurrentFinancialYear();
  const s = Number(c.split('-')[0]) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

function generateFyOptions(): Array<{ value: string; label: string }> {
  const currentStart = Number(getCurrentFinancialYear().split('-')[0]);
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = 3; i >= 0; i--) {
    const s = currentStart - i;
    opts.push({
      value: `${s}-${String((s + 1) % 100).padStart(2, '0')}`,
      label: `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`,
    });
  }
  return opts;
}

const BUCKETS: Array<{
  key: EightyGCat;
  title: string;
  rate: string;
  note: string;
  hasLimit: boolean;
}> = [
  {
    key: '100_NO_LIMIT',
    title: 'PM CARES / PMNRF — 100%, no limit',
    rate: '100%',
    note: 'Full face value deducts directly.',
    hasLimit: false,
  },
  {
    key: '50_NO_LIMIT',
    title: 'Local NGOs — 50%, no limit',
    rate: '50%',
    note: '50% of face value deducts directly.',
    hasLimit: false,
  },
  {
    key: '100_WITH_LIMIT',
    title: 'Govt bodies — 100%, with 10% GTI cap',
    rate: '100%',
    note: 'Capped at 10% of adjusted GTI (shared with 50%-with-limit).',
    hasLimit: true,
  },
  {
    key: '50_WITH_LIMIT',
    title: 'Other NGOs — 50%, with 10% GTI cap',
    rate: '50%',
    note: 'Capped at 10% of adjusted GTI (shared with 100%-with-limit).',
    hasLimit: true,
  },
];

function categorise(d: Deduction): EightyGCat {
  if (d.eightyGCategory) return d.eightyGCategory;
  // Legacy fallback — derive from qualifyingPercent + hasUpperLimit
  const pct = d.qualifyingPercent === 100 ? '100' : '50';
  const limit = d.hasUpperLimit ? 'WITH_LIMIT' : 'NO_LIMIT';
  return `${pct}_${limit}` as EightyGCat;
}

export default function Section80GPage() {
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [byCategory, setByCategory] = useState<
    Record<EightyGCat, number> | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fy, setFy] = useState(previousFy());

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [d, rc] = await Promise.all([
        fetch(`/api/tax/deductions?fy=${fy}&section=80G`).then((r) => r.json()),
        fetch(`/api/tax/regime-compare?fy=${fy}`)
          .then((r) => (r.ok ? (r.json() as Promise<RegimeCompareResp>) : null))
          .catch(() => null),
      ]);
      setDeductions(d.deductions || []);
      setByCategory(rc?.deductions?.eightyG?.byCategory ?? null);
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async (id: number) => {
    if (!confirm('Delete this donation?')) return;
    try {
      const r = await fetch(`/api/tax/deductions/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  // Group rows by category
  const rowsByBucket: Record<EightyGCat, Deduction[]> = {
    '100_NO_LIMIT': [],
    '50_NO_LIMIT': [],
    '100_WITH_LIMIT': [],
    '50_WITH_LIMIT': [],
  };
  for (const d of deductions) {
    rowsByBucket[categorise(d)].push(d);
  }

  // Aggregate stats
  const totalDonated = deductions.reduce((s, d) => s + (d.amountPaisa ?? 0), 0);
  const totalDeductible = byCategory
    ? Object.values(byCategory).reduce((s, v) => s + v, 0)
    : 0;
  // 10% cap "applied" figure: face value of WITH_LIMIT donations MINUS
  // the post-cap deductible from those two categories at face value.
  // Simpler: compute face vs deductible for the WITH_LIMIT buckets only.
  const withLimitFace =
    rowsByBucket['100_WITH_LIMIT'].reduce((s, d) => s + (d.amountPaisa ?? 0), 0) +
    rowsByBucket['50_WITH_LIMIT'].reduce((s, d) => s + (d.amountPaisa ?? 0), 0);
  // Pre-cap notional (if no cap): 100%×100_WITH + 50%×50_WITH
  const withLimitNotional =
    rowsByBucket['100_WITH_LIMIT'].reduce((s, d) => s + (d.amountPaisa ?? 0), 0) +
    Math.round(
      rowsByBucket['50_WITH_LIMIT'].reduce((s, d) => s + (d.amountPaisa ?? 0), 0) *
        0.5,
    );
  const withLimitActual = byCategory
    ? (byCategory['100_WITH_LIMIT'] ?? 0) + (byCategory['50_WITH_LIMIT'] ?? 0)
    : 0;
  const capReductionPaisa = Math.max(0, withLimitNotional - withLimitActual);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Section 80G — Donations
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Charitable contributions for FY {fy}, grouped by CBDT category.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select options={generateFyOptions()} value={fy} onChange={setFy} />
          </div>
          <Link href="/tax/new?section=80G">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" /> Add 80G donation
            </Button>
          </Link>
        </div>
      </div>

      {/* Aggregate stats — three custom tiles (StatsDisplay only supports
          number values; we want unit subtitles). */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile
          label="Total donated"
          value={formatINR(totalDonated)}
          subtitle={`${deductions.length} donation${deductions.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Total deductible (post-cap)"
          value={formatINR(totalDeductible)}
          subtitle="goes into Chapter VI-A"
        />
        <StatTile
          label="10% cap applied (face vs allowed)"
          value={formatINR(capReductionPaisa)}
          subtitle={
            capReductionPaisa > 0
              ? `out of ₹${(withLimitFace / 100).toLocaleString('en-IN')} with-limit face value`
              : 'within cap'
          }
          tone={capReductionPaisa > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {/* Four buckets, stacked */}
      {BUCKETS.map((b) => {
        const rows = rowsByBucket[b.key];
        const subtotalFace = rows.reduce((s, d) => s + (d.amountPaisa ?? 0), 0);
        const effective = byCategory?.[b.key] ?? null;
        return (
          <Card key={b.key}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-[var(--dxp-brand)]" />
                  <h3 className="text-base font-bold text-[var(--dxp-text)]">{b.title}</h3>
                  <Badge variant="info">{b.rate}</Badge>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[var(--dxp-text-muted)]">Face: {formatINR(subtotalFace)}</p>
                  {b.hasLimit && effective != null && (
                    <p className="text-xs font-bold text-[var(--dxp-text)]">
                      After cap: {formatINR(effective)}
                    </p>
                  )}
                  {!b.hasLimit && effective != null && (
                    <p className="text-xs font-bold text-[var(--dxp-text)]">
                      Deduction: {formatINR(effective)}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-[var(--dxp-text-muted)]">{b.note}</p>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  No donations in this bucket yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {rows.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded border border-[var(--dxp-border-light)] px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs text-[var(--dxp-text-muted)]">
                        {r.paymentDate ?? '—'}
                      </span>
                      <div className="flex-1 truncate">
                        <p className="font-bold text-[var(--dxp-text)]">
                          {r.recipientName ?? r.description}
                        </p>
                        {r.recipient80gNumber && (
                          <p className="text-xs text-[var(--dxp-text-muted)]">
                            80G: {r.recipient80gNumber}
                          </p>
                        )}
                      </div>
                      {r.recipientPan && (
                        <span className="font-mono text-xs text-[var(--dxp-text-muted)]">
                          PAN: {r.recipientPan}
                        </span>
                      )}
                      <span className="font-mono font-bold text-[var(--dxp-text)]">
                        {formatINR(r.amountPaisa ?? 0)}
                      </span>
                      <Link href={`/tax/${r.id}/edit`}>
                        <Button variant="ghost" size="sm" title="Edit">
                          <Pencil className="h-3 w-3 text-[var(--dxp-text-muted)]" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(r.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3 text-rose-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StatTile({
  label,
  value,
  subtitle,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  subtitle: string;
  tone?: 'neutral' | 'warn';
}) {
  const cls =
    tone === 'warn'
      ? 'border-amber-300 bg-amber-50/40'
      : 'border-[var(--dxp-border)]';
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums text-[var(--dxp-text)]">{value}</p>
      <p className="text-[10px] text-[var(--dxp-text-muted)]">{subtitle}</p>
    </div>
  );
}
