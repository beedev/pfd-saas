'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay, DataTable, type Column } from '@dxp/ui';
import { Plus, Loader2, Umbrella, Trash2, AlertTriangle, FileUp, ChevronDown, Check } from 'lucide-react';

type PolicyType =
  | 'TERM_LIFE'
  | 'WHOLE_LIFE'
  | 'ENDOWMENT'
  | 'ULIP'
  | 'HEALTH'
  | 'CRITICAL_ILLNESS'
  | 'DISABILITY'
  | 'ACCIDENT';

interface Policy {
  id: number;
  policyNumber: string;
  policyType: PolicyType;
  status: string | null;
  policyHolder: string;
  insurer: string;
  sumAssured: number;
  premiumAmount: number;
  premiumFrequency: string | null;
  policyStartDate: string;
  maturityDate: string | null;
  lastPremiumPaidDate: string | null;
  nextPremiumDueDate: string | null;
  investmentValue: number | null;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const LIFE_TYPES: PolicyType[] = ['TERM_LIFE', 'WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];
const HEALTH_TYPES: PolicyType[] = ['HEALTH', 'CRITICAL_ILLNESS'];

const annualisePremium = (amount: number, freq: string | null): number => {
  switch ((freq || 'YEARLY').toUpperCase()) {
    case 'MONTHLY':
      return amount * 12;
    case 'QUARTERLY':
      return amount * 4;
    case 'HALF_YEARLY':
      return amount * 2;
    case 'SINGLE':
      return 0;
    case 'YEARLY':
    default:
      return amount;
  }
};

// Compute upcoming premium dates (next 90 days) from start date + frequency
const upcomingPremiums = (policy: Policy): Date[] => {
  const freq = (policy.premiumFrequency || 'YEARLY').toUpperCase();
  if (freq === 'SINGLE') return [];
  const stepMonths =
    freq === 'MONTHLY' ? 1 : freq === 'QUARTERLY' ? 3 : freq === 'HALF_YEARLY' ? 6 : 12;
  const now = new Date();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 90);

  // Start from nextPremiumDueDate if available, otherwise walk from policyStartDate
  let cur: Date;
  if (policy.nextPremiumDueDate) {
    cur = new Date(policy.nextPremiumDueDate);
  } else {
    const start = new Date(policy.policyStartDate);
    if (Number.isNaN(start.getTime())) return [];
    cur = new Date(start);
    while (cur < now) cur.setMonth(cur.getMonth() + stepMonths);
  }

  const out: Date[] = [];
  while (cur <= horizon && out.length < 8) {
    out.push(new Date(cur));
    cur.setMonth(cur.getMonth() + stepMonths);
  }
  return out;
};

export default function InsurancePage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [adequacyOpen, setAdequacyOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(true);
  const [markingId, setMarkingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/insurance').then((r) => r.json());
      setPolicies(r.policies || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load policies');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/insurance/${deleteTarget.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
    } finally {
      setIsDeleting(false);
    }
  };

  const lifeCover = policies
    .filter((p) => LIFE_TYPES.includes(p.policyType))
    .reduce((s, p) => s + p.sumAssured, 0);
  const healthCover = policies
    .filter((p) => HEALTH_TYPES.includes(p.policyType))
    .reduce((s, p) => s + p.sumAssured, 0);
  const totalAnnualPremium = policies.reduce(
    (s, p) => s + annualisePremium(p.premiumAmount, p.premiumFrequency),
    0
  );
  const totalSurrender = policies.reduce((s, p) => s + (p.investmentValue ?? 0), 0);

  // Adequacy heuristics — flag if life < 1Cr, health < 10L
  const lifeAdequate = lifeCover >= 10000000 * 100;
  const healthAdequate = healthCover >= 1000000 * 100;

  const markPaid = async (policyId: number) => {
    if (markingId !== null) return; // prevent double-click
    setMarkingId(policyId);
    try {
      const r = await fetch(`/api/investments/insurance/${policyId}/mark-paid`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      toast.success(data.message);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark paid');
    } finally {
      setMarkingId(null);
    }
  };

  // Premium calendar for next 90 days
  const calendarItems = policies
    .flatMap((p) =>
      upcomingPremiums(p).map((date) => ({
        date,
        policy: p,
      }))
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 10);

  const columns: Column<Policy>[] = [
    {
      key: 'policyNumber',
      header: 'Policy',
      render: (_v, p) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/insurance/${p.id}`}
            className="font-mono font-semibold text-[var(--dxp-brand)] hover:underline"
          >
            {p.policyNumber}
          </Link>
          <span className="text-xs text-[var(--dxp-text-muted)]">{p.insurer}</span>
        </div>
      ),
    },
    {
      key: 'policyType',
      header: 'Type',
      render: (_v, p) => <Badge variant="info">{p.policyType.replace('_', ' ')}</Badge>,
    },
    {
      key: 'policyHolder',
      header: 'Holder',
      render: (_v, p) => <span className="text-sm">{p.policyHolder}</span>,
    },
    {
      key: 'sumAssured',
      header: 'Sum Assured',
      render: (_v, p) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">{formatINR(p.sumAssured)}</span>
      ),
    },
    {
      key: 'premiumAmount',
      header: 'Premium',
      render: (_v, p) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {formatINR(p.premiumAmount)} <span className="text-xs">/{p.premiumFrequency?.toLowerCase()}</span>
        </span>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (_v, p) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(p);
          }}
        >
          <Trash2 className="h-4 w-4 text-rose-500" />
        </Button>
      ),
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Insurance</h1>
          <p className="text-[var(--dxp-text-secondary)]">Life, health and other insurance policies</p>
        </div>
        <div className="flex gap-2">
          <Link href="/investments/import?type=lic">
            <Button variant="secondary">
              <FileUp className="mr-2 h-4 w-4" />
              Import from PDF
            </Button>
          </Link>
          <Link href="/investments/insurance/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add policy
            </Button>
          </Link>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Total Life Cover', value: lifeCover / 100, format: 'currency' },
          { label: 'Total Health Cover', value: healthCover / 100, format: 'currency' },
          { label: 'Total Annual Premium', value: totalAnnualPremium / 100, format: 'currency' },
          { label: 'Total Surrender Value', value: totalSurrender / 100, format: 'currency' },
        ]}
      />

      {policies.length > 0 && (
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setAdequacyOpen((p) => !p)}
            >
              <div>
                <h3 className="text-base font-bold text-[var(--dxp-text)]">Coverage adequacy</h3>
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  Rules of thumb: Life cover ≥ 10× annual income, Health cover ≥ ₹10L for a metro family
                </p>
              </div>
              <ChevronDown
                className={`h-5 w-5 flex-shrink-0 text-[var(--dxp-text-muted)] transition-transform ${
                  adequacyOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </CardHeader>
          {adequacyOpen && <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              <div
                className={`rounded-lg border-l-4 p-4 ${
                  lifeAdequate ? 'border-l-emerald-500 bg-emerald-50' : 'border-l-amber-500 bg-amber-50'
                }`}
              >
                <p className="text-xs uppercase tracking-wider text-[var(--dxp-text-muted)]">Life cover</p>
                <p className="mt-1 text-xl font-bold font-mono text-[var(--dxp-text)]">{formatINR(lifeCover)}</p>
                <p
                  className={`mt-1 text-xs flex items-center gap-1 ${
                    lifeAdequate ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {!lifeAdequate && <AlertTriangle className="h-3 w-3" />}
                  {lifeAdequate ? 'Looks adequate (≥ ₹1Cr)' : 'Below ₹1Cr threshold — consider topping up'}
                </p>
              </div>
              <div
                className={`rounded-lg border-l-4 p-4 ${
                  healthAdequate ? 'border-l-emerald-500 bg-emerald-50' : 'border-l-amber-500 bg-amber-50'
                }`}
              >
                <p className="text-xs uppercase tracking-wider text-[var(--dxp-text-muted)]">Health cover</p>
                <p className="mt-1 text-xl font-bold font-mono text-[var(--dxp-text)]">{formatINR(healthCover)}</p>
                <p
                  className={`mt-1 text-xs flex items-center gap-1 ${
                    healthAdequate ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {!healthAdequate && <AlertTriangle className="h-3 w-3" />}
                  {healthAdequate ? 'Looks adequate (≥ ₹10L)' : 'Below ₹10L threshold — consider topping up'}
                </p>
              </div>
            </div>
          </CardContent>}
        </Card>
      )}

      {calendarItems.length > 0 && (
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setCalendarOpen((p) => !p)}
            >
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Premium calendar (next 90 days)
                <span className="ml-2 text-sm font-normal text-[var(--dxp-text-muted)]">
                  {calendarItems.length} upcoming
                </span>
              </h3>
              <ChevronDown
                className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${
                  calendarOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </CardHeader>
          {calendarOpen && (
            <CardContent>
              <div className="space-y-2">
                {calendarItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded border border-[var(--dxp-border-light)] px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-semibold text-[var(--dxp-text)]">{item.policy.policyNumber}</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">{item.policy.insurer}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-mono font-bold text-[var(--dxp-text)]">{formatINR(item.policy.premiumAmount)}</p>
                        <p className="text-xs text-[var(--dxp-text-muted)]">{item.date.toISOString().slice(0, 10)}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => markPaid(item.policy.id)}
                        disabled={markingId !== null}
                      >
                        {markingId === item.policy.id
                          ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          : <Check className="mr-1 h-3 w-3" />}
                        Paid
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setPoliciesOpen((p) => !p)}
          >
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Umbrella className="h-5 w-5 text-[var(--dxp-brand)]" />
              Policies ({policies.length})
            </h3>
            <ChevronDown
              className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${
                policiesOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </CardHeader>
        {policiesOpen && (
          <CardContent>
            {policies.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Umbrella className="h-12 w-12 text-[var(--dxp-text-muted)]" />
                <p className="text-[var(--dxp-text-muted)]">No policies yet.</p>
                <Link href="/investments/insurance/new">
                  <Button variant="primary">
                    <Plus className="mr-2 h-4 w-4" /> Add policy
                  </Button>
                </Link>
              </div>
            ) : (
              <DataTable<Policy> columns={columns} data={policies} emptyMessage="No policies" />
            )}
          </CardContent>
        )}
      </Card>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete policy?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Removes <strong>{deleteTarget.policyNumber}</strong>.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
                  {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
