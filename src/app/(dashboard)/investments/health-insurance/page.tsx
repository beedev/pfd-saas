'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay, DataTable, type Column } from '@dxp/ui';
import { Plus, Loader2, HeartPulse, Trash2, ChevronDown } from 'lucide-react';

type HealthPolicyType =
  | 'INDIVIDUAL'
  | 'FAMILY_FLOATER'
  | 'TOPUP'
  | 'SUPER_TOPUP'
  | 'CRITICAL_ILLNESS'
  | 'OPD_RIDER';

type HealthPolicyStatus = 'ACTIVE' | 'LAPSED' | 'CLAIMED' | 'PORTED_OUT' | 'CANCELLED';

type PremiumFrequency = 'ANNUAL' | 'SEMI_ANNUAL' | 'QUARTERLY' | 'MONTHLY';

interface Policy {
  id: number;
  insurer: string;
  policyNumber: string;
  policyType: HealthPolicyType;
  status: HealthPolicyStatus | null;
  policyHolder: string;
  sumInsuredPaisa: number;
  premiumPaisa: number;
  premiumFrequency: PremiumFrequency | null;
  startDate: string;
  renewalDate: string | null;
  cashlessAvailable: boolean | null;
  networkHospitalCount: number | null;
}

interface Claim {
  id: number;
  policyId: number;
  status: string;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const annualisePremium = (paisa: number, freq: PremiumFrequency | null): number => {
  switch ((freq || 'ANNUAL').toUpperCase()) {
    case 'MONTHLY':
      return paisa * 12;
    case 'QUARTERLY':
      return paisa * 4;
    case 'SEMI_ANNUAL':
      return paisa * 2;
    case 'ANNUAL':
    default:
      return paisa;
  }
};

const POLICY_TYPE_LABEL: Record<HealthPolicyType, string> = {
  INDIVIDUAL: 'Individual',
  FAMILY_FLOATER: 'Family floater',
  TOPUP: 'Top-up',
  SUPER_TOPUP: 'Super top-up',
  CRITICAL_ILLNESS: 'Critical illness',
  OPD_RIDER: 'OPD rider',
};

const PENDING_CLAIM_STATUSES = new Set([
  'INTIMATED',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'PARTIAL',
]);

export default function HealthInsurancePage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/health-insurance').then((r) => r.json());
      const list: Policy[] = r.policies || [];
      setPolicies(list);

      // Fetch claims across all policies in parallel for the pending count.
      const claimResults = await Promise.all(
        list.map((p) =>
          fetch(`/api/investments/health-insurance/${p.id}/claims`)
            .then((res) => (res.ok ? res.json() : { claims: [] }))
            .catch(() => ({ claims: [] }))
        )
      );
      const merged: Claim[] = claimResults.flatMap((c) => c.claims || []);
      setClaims(merged);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load health insurance policies');
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
      const r = await fetch(`/api/investments/health-insurance/${deleteTarget.id}`, {
        method: 'DELETE',
      });
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

  const activePolicies = policies.filter((p) => (p.status ?? 'ACTIVE') === 'ACTIVE');
  const totalSumInsured = activePolicies.reduce((s, p) => s + p.sumInsuredPaisa, 0);
  const totalAnnualPremium = activePolicies.reduce(
    (s, p) => s + annualisePremium(p.premiumPaisa, p.premiumFrequency),
    0
  );
  const pendingClaims = claims.filter((c) => PENDING_CLAIM_STATUSES.has(c.status)).length;

  const columns: Column<Policy>[] = [
    {
      key: 'insurer',
      header: 'Insurer',
      render: (_v, p) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/health-insurance/${p.id}`}
            className="font-semibold text-[var(--dxp-brand)] hover:underline"
          >
            {p.insurer}
          </Link>
          <span className="font-mono text-xs text-[var(--dxp-text-muted)]">{p.policyNumber}</span>
        </div>
      ),
    },
    {
      key: 'policyType',
      header: 'Type',
      render: (_v, p) => <Badge variant="info">{POLICY_TYPE_LABEL[p.policyType]}</Badge>,
    },
    {
      key: 'sumInsuredPaisa',
      header: 'Sum insured',
      render: (_v, p) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(p.sumInsuredPaisa)}
        </span>
      ),
    },
    {
      key: 'premiumPaisa',
      header: 'Premium (annualised)',
      render: (_v, p) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {formatINR(annualisePremium(p.premiumPaisa, p.premiumFrequency))}
          <span className="ml-1 text-xs">/yr</span>
        </span>
      ),
    },
    {
      key: 'renewalDate',
      header: 'Renewal',
      render: (_v, p) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">{p.renewalDate || '—'}</span>
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Health Insurance
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Family health policies, e-cards, claims and portability history
          </p>
        </div>
        <Link href="/investments/health-insurance/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Register policy
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active policies', value: activePolicies.length, format: 'number' },
          { label: 'Total sum insured', value: totalSumInsured / 100, format: 'currency' },
          { label: 'Total annual premium', value: totalAnnualPremium / 100, format: 'currency' },
          { label: 'Pending claims', value: pendingClaims, format: 'number' },
        ]}
      />

      <Card>
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setPoliciesOpen((p) => !p)}
          >
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <HeartPulse className="h-5 w-5 text-[var(--dxp-brand)]" />
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
                <HeartPulse className="h-12 w-12 text-[var(--dxp-text-muted)]" />
                <p className="text-[var(--dxp-text-muted)]">No health policies yet.</p>
                <Link href="/investments/health-insurance/new">
                  <Button variant="primary">
                    <Plus className="mr-2 h-4 w-4" /> Register policy
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
                Removes <strong>{deleteTarget.policyNumber}</strong> at {deleteTarget.insurer}.
                Cards, claims and portability records are removed too.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                >
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
