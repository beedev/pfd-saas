'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  StatsDisplay,
  DataTable,
  type Column,
} from '@dxp/ui';
import {
  Plus,
  Loader2,
  Repeat2,
  Tv,
  Code,
  Cloud,
  Dumbbell,
  Newspaper,
  Gamepad2,
  Sparkles,
  GraduationCap,
  Briefcase,
  Package,
} from 'lucide-react';

type SubscriptionCategory =
  | 'STREAMING'
  | 'SOFTWARE'
  | 'CLOUD'
  | 'FITNESS'
  | 'NEWS'
  | 'GAMING'
  | 'AI'
  | 'EDUCATION'
  | 'PRODUCTIVITY'
  | 'OTHER';

type BillingFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'LIFETIME';
type Status = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

interface Subscription {
  id: number;
  name: string;
  provider: string;
  category: SubscriptionCategory;
  planName: string | null;
  amountPaisa: number;
  billingFrequency: BillingFrequency;
  startDate: string;
  nextRenewalDate: string | null;
  paymentMethod: string | null;
  autoRenew: boolean;
  url: string | null;
  status: Status;
  cancellationDate: string | null;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const CATEGORY_LABEL: Record<SubscriptionCategory, string> = {
  STREAMING: 'Streaming',
  SOFTWARE: 'Software',
  CLOUD: 'Cloud',
  FITNESS: 'Fitness',
  NEWS: 'News',
  GAMING: 'Gaming',
  AI: 'AI',
  EDUCATION: 'Education',
  PRODUCTIVITY: 'Productivity',
  OTHER: 'Other',
};

const CATEGORY_ICON: Record<SubscriptionCategory, React.ComponentType<{ className?: string }>> = {
  STREAMING: Tv,
  SOFTWARE: Code,
  CLOUD: Cloud,
  FITNESS: Dumbbell,
  NEWS: Newspaper,
  GAMING: Gamepad2,
  AI: Sparkles,
  EDUCATION: GraduationCap,
  PRODUCTIVITY: Briefcase,
  OTHER: Package,
};

const FREQ_LABEL: Record<BillingFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMI_ANNUAL: 'Semi-annual',
  ANNUAL: 'Annual',
  LIFETIME: 'Lifetime',
};

/** Paisa per month for an active sub. LIFETIME → 0 (no ongoing drag). */
function monthlyDragPaisa(s: Subscription): number {
  if (s.status !== 'ACTIVE') return 0;
  switch (s.billingFrequency) {
    case 'MONTHLY':
      return s.amountPaisa;
    case 'QUARTERLY':
      return s.amountPaisa / 3;
    case 'SEMI_ANNUAL':
      return s.amountPaisa / 6;
    case 'ANNUAL':
      return s.amountPaisa / 12;
    case 'LIFETIME':
      return 0;
  }
}

/** Annualised paisa for a single billing frequency (independent of status). */
function annualisedPaisa(amountPaisa: number, freq: BillingFrequency): number {
  switch (freq) {
    case 'MONTHLY':
      return amountPaisa * 12;
    case 'QUARTERLY':
      return amountPaisa * 4;
    case 'SEMI_ANNUAL':
      return amountPaisa * 2;
    case 'ANNUAL':
      return amountPaisa;
    case 'LIFETIME':
      return 0;
  }
}

/** Indian FY start: 1 April of currentYear if month ≥ April else previous year. */
function fyStartISO(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
}

export default function SubscriptionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Subscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/subscriptions').then((r) => r.json());
      setItems(r.subscriptions || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load subscriptions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeCount = useMemo(() => items.filter((s) => s.status === 'ACTIVE').length, [items]);
  const monthlyDrag = useMemo(
    () => items.reduce((sum, s) => sum + monthlyDragPaisa(s), 0),
    [items],
  );
  const annualRunRate = monthlyDrag * 12;

  const cancelledThisFYSavings = useMemo(() => {
    const fyStart = fyStartISO();
    return items
      .filter((s) => s.status === 'CANCELLED' && s.cancellationDate && s.cancellationDate >= fyStart)
      .reduce((sum, s) => sum + annualisedPaisa(s.amountPaisa, s.billingFrequency), 0);
  }, [items]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<SubscriptionCategory, { count: number; monthly: number }>();
    for (const s of items) {
      if (s.status !== 'ACTIVE') continue;
      const entry = map.get(s.category) ?? { count: 0, monthly: 0 };
      entry.count += 1;
      entry.monthly += monthlyDragPaisa(s);
      map.set(s.category, entry);
    }
    return Array.from(map.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.monthly - a.monthly);
  }, [items]);

  const columns: Column<Subscription>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (_v, s) => {
        const Icon = CATEGORY_ICON[s.category];
        return (
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[var(--dxp-text-muted)]" />
            <div className="flex flex-col">
              <Link
                href={`/subscriptions/${s.id}`}
                className="font-semibold text-[var(--dxp-brand)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {s.name}
              </Link>
              <span className="text-xs text-[var(--dxp-text-muted)]">{s.provider}</span>
            </div>
          </div>
        );
      },
    },
    {
      key: 'category',
      header: 'Category',
      render: (_v, s) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">
          {CATEGORY_LABEL[s.category]}
        </span>
      ),
    },
    {
      key: 'planName',
      header: 'Plan',
      render: (_v, s) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">{s.planName ?? '—'}</span>
      ),
    },
    {
      key: 'amountPaisa',
      header: 'Amount',
      render: (_v, s) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(s.amountPaisa)}
        </span>
      ),
    },
    {
      key: 'billingFrequency',
      header: 'Frequency',
      render: (_v, s) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">
          {FREQ_LABEL[s.billingFrequency]}
        </span>
      ),
    },
    {
      key: 'nextRenewalDate',
      header: 'Next renewal',
      render: (_v, s) => (
        <span className="text-xs text-[var(--dxp-text-secondary)]">
          {s.nextRenewalDate ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, s) => {
        if (s.status === 'ACTIVE') return <Badge variant="success">Active</Badge>;
        if (s.status === 'PAUSED') return <Badge variant="warning">Paused</Badge>;
        return <Badge variant="default">Cancelled</Badge>;
      },
    },
  ];

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
            Subscriptions
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Track recurring digital services and make monthly drag visible.
          </p>
        </div>
        <Link href="/subscriptions/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add subscription
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active subscriptions', value: activeCount, format: 'number' },
          { label: 'Monthly drag', value: monthlyDrag / 100, format: 'currency' },
          { label: 'Annual run rate', value: annualRunRate / 100, format: 'currency' },
          { label: 'Cancelled this FY (saved)', value: cancelledThisFYSavings / 100, format: 'currency' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Repeat2 className="h-5 w-5 text-[var(--dxp-brand)]" />
            All subscriptions ({items.length})
          </h3>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Repeat2 className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">
                No subscriptions yet. Add your first one to start tracking drag.
              </p>
              <Link href="/subscriptions/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Add subscription
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<Subscription>
              columns={columns}
              data={items}
              emptyMessage="No subscriptions"
              onRowClick={(s) => router.push(`/subscriptions/${s.id}`)}
            />
          )}
        </CardContent>
      </Card>

      {categoryBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Category breakdown</h3>
            <p className="text-xs text-[var(--dxp-text-muted)]">
              Active subscriptions only. Monthly drag normalised across billing frequencies.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--dxp-border)]">
              {categoryBreakdown.map(({ category, count, monthly }) => {
                const Icon = CATEGORY_ICON[category];
                const pct = monthlyDrag > 0 ? (monthly / monthlyDrag) * 100 : 0;
                return (
                  <li key={category} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-[var(--dxp-brand)]" />
                      <div>
                        <p className="text-sm font-semibold text-[var(--dxp-text)]">
                          {CATEGORY_LABEL[category]}
                        </p>
                        <p className="text-xs text-[var(--dxp-text-muted)]">
                          {count} {count === 1 ? 'sub' : 'subs'} · {pct.toFixed(0)}% of drag
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-sm font-semibold text-[var(--dxp-text)]">
                      {formatINR(monthly)} / mo
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
