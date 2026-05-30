'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  StatsDisplay,
  DataTable,
  Input,
  type Column,
} from '@dxp/ui';
import { ArrowLeft, Loader2, Pause, Play, Repeat, Zap, Pencil, Save, X, Trash2 } from 'lucide-react';
import { Select } from '@dxp/ui';

interface SipRecord {
  id: number;
  mutualFundId: number;
  monthlyAmount: number;
  frequency: string;
  startDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  startingUnits: number;
  startingNav: number;
  totalInvestedSoFar: number;
  expectedXirr: number | null;
  nextExecutionDate: string | null;
  lastExecutionDate: string | null;
  notes: string | null;
}

interface MfRecord {
  id: number;
  schemeName: string;
  fundType: string;
  units: number;
  nav: number;
  currentValue: number;
  totalInvestment: number;
}

interface TxnRecord {
  id: number;
  type: string;
  quantity: number;
  pricePerUnit: number;
  amount: number;
  transactionDate: string;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const statusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'default',
};

const FREQUENCY_OPTIONS = [
  { label: 'Monthly', value: 'MONTHLY' },
  { label: 'Quarterly', value: 'QUARTERLY' },
];

const STATUS_OPTIONS = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Paused', value: 'PAUSED' },
  { label: 'Completed', value: 'COMPLETED' },
];

interface FormState {
  monthlyAmountRupees: string;
  frequency: string;
  status: string;
  startDate: string;
  endDate: string;
  nextExecutionDate: string;
  startingUnits: string;
  startingNavRupees: string;
  totalInvestedSoFarRupees: string;
  notes: string;
}

function sipToForm(s: SipRecord): FormState {
  return {
    monthlyAmountRupees: (s.monthlyAmount / 100).toString(),
    frequency: s.frequency,
    status: s.status,
    startDate: s.startDate,
    endDate: s.nextExecutionDate ?? '',
    nextExecutionDate: s.nextExecutionDate ?? '',
    startingUnits: s.startingUnits.toString(),
    startingNavRupees: (s.startingNav / 100).toString(),
    totalInvestedSoFarRupees: (s.totalInvestedSoFar / 100).toString(),
    notes: s.notes ?? '',
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function SipDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [sip, setSip] = useState<SipRecord | null>(null);
  const [mf, setMf] = useState<MfRecord | null>(null);
  const [txns, setTxns] = useState<TxnRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const [execDate, setExecDate] = useState(new Date().toISOString().slice(0, 10));
  const [execAmount, setExecAmount] = useState('0');
  const [execNav, setExecNav] = useState('0');

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/sips/${id}`);
      if (!r.ok) throw new Error('not found');
      const data = await r.json();
      setSip(data.sip);
      setMf(data.mutualFund);
      setTxns(data.transactions || []);
      if (data.sip) setForm(sipToForm(data.sip));
      if (data.sip) {
        setExecAmount((data.sip.monthlyAmount / 100).toString());
      }
      if (data.mutualFund) {
        setExecNav((data.mutualFund.nav / 100).toString());
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to load SIP');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const togglePause = async () => {
    if (!sip) return;
    setIsToggling(true);
    try {
      const newStatus = sip.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      const r = await fetch(`/api/investments/sips/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!r.ok) throw new Error('toggle failed');
      toast.success(newStatus === 'ACTIVE' ? 'SIP resumed' : 'SIP paused');
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to update SIP');
    } finally {
      setIsToggling(false);
    }
  };

  const executeInstallment = async () => {
    setIsExecuting(true);
    try {
      const r = await fetch(`/api/investments/sips/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionDate: execDate,
          amount: parseFloat(execAmount),
          navOnExecution: parseFloat(execNav),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'execute failed');
      }
      toast.success('Installment recorded');
      setShowExecuteModal(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to execute';
      toast.error(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  const onSave = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      const body = {
        monthlyAmountRupees: Number(form.monthlyAmountRupees) || 0,
        frequency: form.frequency,
        status: form.status,
        startDate: form.startDate,
        nextExecutionDate: form.nextExecutionDate || null,
        startingUnits: Number(form.startingUnits) || 0,
        startingNavRupees: Number(form.startingNavRupees) || 0,
        totalInvestedSoFarRupees: Number(form.totalInvestedSoFarRupees) || 0,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/sips/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Save failed');
      toast.success('SIP updated');
      setIsEditing(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (sip) setForm(sipToForm(sip));
    setIsEditing(false);
  };

  const onDelete = async () => {
    if (!confirm('Delete this SIP?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/sips/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/sips');
    } catch (e) {
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  if (!sip) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" onClick={() => router.push('/investments/sips')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardContent>
            <p className="text-[var(--dxp-text-muted)]">SIP not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentValue = mf ? mf.currentValue : 0;
  const absGain = currentValue - sip.totalInvestedSoFar;
  const absGainPct =
    sip.totalInvestedSoFar > 0 ? (absGain / sip.totalInvestedSoFar) * 100 : 0;

  // Cumulative units history (for the table)
  let cumulative = 0;
  const txnRows = txns.map((t) => {
    cumulative += t.quantity;
    return { ...t, cumulative };
  });
  type TxnRow = (typeof txnRows)[number];

  const txnColumns: Column<TxnRow>[] = [
    {
      key: 'transactionDate',
      header: 'Date',
      render: (_v, t) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {new Date(t.transactionDate).toLocaleDateString('en-IN')}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (_v, t) => (
        <Badge variant={t.type === 'SIP_EXECUTION' ? 'success' : 'default'}>{t.type}</Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (_v, t) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">{formatINR(t.amount)}</span>
      ),
    },
    {
      key: 'pricePerUnit',
      header: 'NAV',
      render: (_v, t) => (
        <span className="font-mono text-[var(--dxp-text)]">₹{(t.pricePerUnit / 100).toFixed(2)}</span>
      ),
    },
    {
      key: 'quantity',
      header: 'Units',
      render: (_v, t) => (
        <span className="font-mono text-[var(--dxp-text)]">{t.quantity.toFixed(3)}</span>
      ),
    },
    {
      key: 'cumulative',
      header: 'Cumulative units',
      render: (_v, t) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {t.cumulative.toFixed(3)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/investments/sips')}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Repeat className="h-6 w-6 text-[var(--dxp-brand)]" />
            <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
              {mf?.schemeName ?? 'SIP'}
            </h1>
            <Badge variant={statusVariant[sip.status] ?? 'default'}>{sip.status}</Badge>
          </div>
          <p className="text-[var(--dxp-text-secondary)]">
            {formatINR(sip.monthlyAmount)} • {sip.frequency} • next:{' '}
            {sip.nextExecutionDate
              ? new Date(sip.nextExecutionDate).toLocaleDateString('en-IN')
              : '—'}
          </p>
        </div>
        <div className="flex gap-2">
          {!isEditing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Button>
              <Button variant="secondary" size="sm" onClick={togglePause} disabled={isToggling}>
                {sip.status === 'ACTIVE' ? (
                  <><Pause className="mr-2 h-4 w-4" /> Pause</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" /> Resume</>
                )}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setShowExecuteModal(true)}>
                <Zap className="mr-2 h-4 w-4" /> Execute
              </Button>
              <Button variant="danger" size="sm" onClick={onDelete} disabled={isDeleting}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isSaving}>
                <X className="mr-2 h-4 w-4" /> Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={onSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Total invested', value: sip.totalInvestedSoFar / 100, format: 'currency' },
          { label: 'Current value', value: currentValue / 100, format: 'currency' },
          {
            label: 'Absolute gain',
            value: absGain / 100,
            format: 'currency',
            delta: { value: absGainPct, label: 'total' },
          },
          {
            label: 'XIRR',
            value: sip.expectedXirr ?? 0,
            format: 'percent',
          },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Repeat className="h-5 w-5 text-[var(--dxp-brand)]" />
            SIP details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <SipDetailView sip={sip} />
          ) : form ? (
            <SipEditForm form={form} setField={setField} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">
            Installment history ({txnRows.length})
          </h3>
        </CardHeader>
        <CardContent>
          {txnRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--dxp-text-muted)]">
              No installments recorded yet.
            </p>
          ) : (
            <DataTable<TxnRow> columns={txnColumns} data={txnRows} emptyMessage="No transactions" />
          )}
        </CardContent>
      </Card>

      {showExecuteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isExecuting && setShowExecuteModal(false)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Execute installment</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Records a SIP execution and updates the linked mutual fund.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Execution date
                  </label>
                  <Input
                    type="date"
                    value={execDate}
                    onChange={(e) => setExecDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Amount (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={execAmount}
                    onChange={(e) => setExecAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    NAV at execution (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={execNav}
                    onChange={(e) => setExecNav(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowExecuteModal(false)}
                    disabled={isExecuting}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={executeInstallment} disabled={isExecuting}>
                    {isExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ─── SIP detail view (read mode) ─────────────────────────────────────── */

function SipDetailView({ sip }: { sip: SipRecord }) {
  const fields: Array<[string, string]> = [
    ['Monthly amount', formatINR(sip.monthlyAmount)],
    ['Frequency', sip.frequency],
    ['Status', sip.status],
    ['Start date', sip.startDate],
    ['Next execution', sip.nextExecutionDate ?? '—'],
    ['Last execution', sip.lastExecutionDate ?? '—'],
    ['Starting units', sip.startingUnits.toFixed(3)],
    ['Starting NAV', `₹${(sip.startingNav / 100).toFixed(2)}`],
    ['Total invested', formatINR(sip.totalInvestedSoFar)],
    ['XIRR', sip.expectedXirr !== null ? `${sip.expectedXirr.toFixed(2)}%` : '—'],
  ];
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-[var(--dxp-border)] pb-2">
            <dt className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              {label}
            </dt>
            <dd className="text-sm text-[var(--dxp-text)]">{value}</dd>
          </div>
        ))}
      </dl>
      {sip.notes && <p className="mt-4 text-sm text-[var(--dxp-text-secondary)]">{sip.notes}</p>}
    </>
  );
}

/* ─── SIP edit form ───────────────────────────────────────────────────── */

function SipEditForm({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Monthly amount (₹)">
        <Input
          type="number"
          value={form.monthlyAmountRupees}
          onChange={(e) => setField('monthlyAmountRupees', e.target.value)}
        />
      </Field>

      <Field label="Frequency">
        <Select
          value={form.frequency}
          onChange={(v) => setField('frequency', v)}
          options={FREQUENCY_OPTIONS}
        />
      </Field>

      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v)}
          options={STATUS_OPTIONS}
        />
      </Field>

      <Field label="Start date">
        <Input
          type="date"
          value={form.startDate}
          onChange={(e) => setField('startDate', e.target.value)}
        />
      </Field>

      <Field label="Next execution date">
        <Input
          type="date"
          value={form.nextExecutionDate}
          onChange={(e) => setField('nextExecutionDate', e.target.value)}
        />
      </Field>

      <Field label="Starting units">
        <Input
          type="number"
          value={form.startingUnits}
          onChange={(e) => setField('startingUnits', e.target.value)}
        />
      </Field>

      <Field label="Starting NAV (₹)">
        <Input
          type="number"
          value={form.startingNavRupees}
          onChange={(e) => setField('startingNavRupees', e.target.value)}
        />
      </Field>

      <Field label="Total invested so far (₹)">
        <Input
          type="number"
          value={form.totalInvestedSoFarRupees}
          onChange={(e) => setField('totalInvestedSoFarRupees', e.target.value)}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={3}
            className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </label>
      {children}
    </div>
  );
}
