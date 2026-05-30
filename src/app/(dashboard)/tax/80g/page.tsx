'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, StatsDisplay, DataTable, Badge, Select, type Column } from '@dxp/ui';
import { Plus, Loader2, Gift } from 'lucide-react';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const s = Number(current.split('-')[0]) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

function generateFyOptions(): Array<{ value: string; label: string }> {
  const currentStart = Number(getCurrentFinancialYear().split('-')[0]);
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = 3; i >= 0; i--) {
    const s = currentStart - i;
    opts.push({ value: `${s}-${String((s + 1) % 100).padStart(2, '0')}`, label: `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}` });
  }
  return opts;
}

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
  financialYear: string;
}

interface Document {
  id: number;
  deductionId: number | null;
  category: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paisa / 100
  );

export default function Section80GPage() {
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fy, setFy] = useState(previousFy());

  const load = useCallback(async () => {
    try {
      const [d, doc] = await Promise.all([
        fetch(`/api/tax/deductions?fy=${fy}&section=80G`).then((r) => r.json()),
        fetch(`/api/tax/documents?fy=${fy}`).then((r) => r.json()),
      ]);
      setDeductions(d.deductions || []);
      setDocuments(doc.documents || []);
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const totalDonated = deductions.reduce((s, d) => s + (d.amountPaisa || 0), 0);
  const eligibleDeduction = deductions.reduce((s, d) => {
    const pct = (d.qualifyingPercent || 100) / 100;
    return s + (d.amountPaisa || 0) * pct;
  }, 0);
  const withCert = deductions.filter((d) => documents.some((doc) => doc.deductionId === d.id)).length;

  const columns: Column<Deduction>[] = [
    {
      key: 'paymentDate',
      header: 'Date',
      render: (_v, d) => <span className="font-mono text-xs">{d.paymentDate || '—'}</span>,
    },
    {
      key: 'recipientName',
      header: 'Recipient',
      render: (_v, d) => (
        <div>
          <p className="font-semibold text-[var(--dxp-text)]">{d.recipientName || d.description}</p>
          {d.recipient80gNumber && (
            <p className="text-xs text-[var(--dxp-text-muted)]">80G: {d.recipient80gNumber}</p>
          )}
        </div>
      ),
    },
    {
      key: 'amountPaisa',
      header: 'Amount',
      render: (_v, d) => (
        <span className="font-mono font-bold">{formatINR(d.amountPaisa || 0)}</span>
      ),
    },
    {
      key: 'qualifyingPercent',
      header: 'Qualifying %',
      render: (_v, d) => <Badge variant="info">{d.qualifyingPercent || 100}%</Badge>,
    },
    {
      key: 'id',
      header: 'Certificate',
      render: (_v, d) => {
        const has = documents.some((doc) => doc.deductionId === d.id);
        return has ? <Badge variant="success">On file</Badge> : <Badge variant="warning">Missing</Badge>;
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Section 80G — Donations</h1>
          <p className="text-[var(--dxp-text-secondary)]">Charitable contributions for FY {fy}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select options={generateFyOptions()} value={fy} onChange={setFy} />
          </div>
          <Link href="/tax/80g/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" /> Add donation
            </Button>
          </Link>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={3}
        stats={[
          { label: 'Total Donated', value: totalDonated / 100, format: 'currency' },
          { label: 'Eligible Deduction', value: eligibleDeduction / 100, format: 'currency' },
          { label: 'Certificates on file', value: withCert, format: 'number' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Gift className="h-5 w-5 text-[var(--dxp-brand)]" /> Donations ({deductions.length})
          </h3>
        </CardHeader>
        <CardContent>
          {deductions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Gift className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">No donations recorded for {fy}.</p>
              <Link href="/tax/80g/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" /> Add donation
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<Deduction> columns={columns} data={deductions} emptyMessage="No donations" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
