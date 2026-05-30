'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay } from '@dxp/ui';
import { Plus, Loader2, Home, Trash2 } from 'lucide-react';

interface Property {
  id: number;
  propertyName: string;
  type: 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'PLOT';
  status: 'OWNED' | 'MORTGAGED' | 'UNDER_CONSTRUCTION' | 'RENTED' | null;
  address: string;
  city: string;
  state: string;
  area: number;
  purchasePrice: number;
  purchaseDate: string;
  currentValuation: number;
  valuationDate: string | null;
  gainLoss: number;
  gainLossPercent: number;
  mortgageAmount: number | null;
  monthlyRent: number | null;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const monthsAgo = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
};

export default function RealEstatePage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/real-estate').then((r) => r.json());
      setProperties(r.properties || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load properties');
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
      const r = await fetch(`/api/investments/real-estate/${deleteTarget.id}`, { method: 'DELETE' });
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

  const totalNotional = properties.reduce((s, p) => s + p.currentValuation, 0);
  const totalLoan = properties.reduce((s, p) => s + (p.mortgageAmount ?? 0), 0);
  const totalRent = properties.reduce((s, p) => s + (p.monthlyRent ?? 0), 0);
  const netEquity = totalNotional - totalLoan;

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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Real Estate</h1>
          <p className="text-[var(--dxp-text-secondary)]">Properties, valuations and rental income</p>
        </div>
        <Link href="/investments/real-estate/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add property
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Total Notional Value', value: totalNotional / 100, format: 'currency' },
          { label: 'Total Loan Outstanding', value: totalLoan / 100, format: 'currency' },
          { label: 'Total Monthly Rent', value: totalRent / 100, format: 'currency' },
          { label: 'Net Equity', value: netEquity / 100, format: 'currency' },
        ]}
      />

      {properties.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Home className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">No properties yet.</p>
              <Link href="/investments/real-estate/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" /> Add property
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {properties.map((p) => {
            const ago = monthsAgo(p.valuationDate);
            const stale = ago !== null && ago > 6;
            return (
              <Card key={p.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <Link
                        href={`/investments/real-estate/${p.id}`}
                        className="text-lg font-bold text-[var(--dxp-text)] hover:text-[var(--dxp-brand)]"
                      >
                        {p.propertyName}
                      </Link>
                      <p className="text-xs text-[var(--dxp-text-muted)]">
                        {p.city}, {p.state} · {p.area} sqft
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="info">{p.type}</Badge>
                      {p.status && p.status !== 'OWNED' && <Badge variant="warning">{p.status}</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono text-[var(--dxp-text)]">
                    {formatINR(p.currentValuation)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                    Purchased {formatINR(p.purchasePrice)} · {p.gainLossPercent >= 0 ? '+' : ''}
                    {p.gainLossPercent.toFixed(1)}%
                  </p>
                  {ago !== null && (
                    <div className="mt-2">
                      <Badge variant={stale ? 'warning' : 'default'}>
                        Last valued {ago === 0 ? 'this month' : `${ago} month${ago === 1 ? '' : 's'} ago`}
                      </Badge>
                    </div>
                  )}
                  {p.mortgageAmount && (
                    <p className="mt-2 text-xs text-[var(--dxp-text-secondary)]">
                      Loan: <span className="font-mono">{formatINR(p.mortgageAmount)}</span>
                    </p>
                  )}
                  {p.monthlyRent && (
                    <p className="mt-1 text-xs text-emerald-700">
                      Rent: <span className="font-mono font-semibold">{formatINR(p.monthlyRent)}/mo</span>
                    </p>
                  )}
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(p)}
                    >
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {totalRent > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Rental income summary</h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono text-emerald-700">{formatINR(totalRent)}/month</p>
            <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
              Annualised: {formatINR(totalRent * 12)} · across{' '}
              {properties.filter((p) => p.monthlyRent).length} rented properties
            </p>
          </CardContent>
        </Card>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete property?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Removes <strong>{deleteTarget.propertyName}</strong>.
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
