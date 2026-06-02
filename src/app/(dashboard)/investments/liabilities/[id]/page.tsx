'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  StatsDisplay,
  Input,
  Select,
  DataTable,
  type Column,
} from '@dxp/ui';
import { ArrowLeft, Loader2, CreditCard, Trash2, Pencil, Save, X, ChevronDown, Plus, Upload, Check } from 'lucide-react';
import { amortizationSchedule, type AmortizationRow } from '@/lib/finance/emi';
import { PrepaySimulator } from './_components/PrepaySimulator';

interface UploadedAmortRow {
  id: number;
  liabilityId: number;
  monthNumber: number;
  dueDate: string | null;
  openingBalance: number;
  emi: number;
  principal: number;
  interest: number;
  closingBalance: number;
  status: 'UPCOMING' | 'PAID' | 'OVERDUE';
  paidOn: string | null;
}

interface CreditCardExpenseRow {
  id: number;
  liabilityId: number;
  period: string;
  amount: number; // paisa
  paidOn: string;
  statementDate: string | null;
  dueDate: string | null;
  notes: string | null;
}

type LiabilityType = 'HOME_LOAN' | 'AUTO_LOAN' | 'PERSONAL_LOAN' | 'CREDIT_CARD' | 'EDUCATION_LOAN' | 'OTHER';
type LiabilityStatus = 'ACTIVE' | 'CLOSED' | 'DEFAULTED';

interface Liability {
  id: number;
  name: string;
  type: LiabilityType;
  status: string | null;
  creditorName: string;
  originalAmount: number;
  currentBalance: number;
  interestRate: number;
  monthlyEmi: number;
  startDate: string;
  maturityDate: string | null;
  remainingTenor: number | null;
  nextPaymentDate: string | null;
  notes: string | null;
  // Sprint 5.9e — tax-qualification flags
  principalQualifies80c: boolean;
  interestQualifies24b: boolean;
}

const STATUS_OPTIONS: Array<{ label: string; value: LiabilityStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Closed', value: 'CLOSED' },
  { label: 'Defaulted', value: 'DEFAULTED' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "042026" → "Apr'26" */
const formatPeriod = (p: string) => {
  const m = parseInt(p.substring(0, 2), 10);
  const y = p.substring(4, 6);
  return `${MONTH_NAMES[m - 1]}'${y}`;
};

interface FormState {
  name: string;
  creditorName: string;
  status: LiabilityStatus;
  currentBalanceRupees: string;
  interestRate: string;
  monthlyEmiRupees: string;
  maturityDate: string;
  remainingTenor: string;
  notes: string;
  // Sprint 5.9e — tax-qualification flags
  principalQualifies80c: boolean;
  interestQualifies24b: boolean;
}

function liabilityToForm(l: Liability): FormState {
  return {
    name: l.name,
    creditorName: l.creditorName,
    status: (l.status as LiabilityStatus) ?? 'ACTIVE',
    currentBalanceRupees: (l.currentBalance / 100).toString(),
    interestRate: l.interestRate.toString(),
    monthlyEmiRupees: (l.monthlyEmi / 100).toString(),
    maturityDate: l.maturityDate ?? '',
    remainingTenor: l.remainingTenor?.toString() ?? '',
    notes: l.notes ?? '',
    principalQualifies80c: !!l.principalQualifies80c,
    interestQualifies24b: !!l.interestQualifies24b,
  };
}

export default function LiabilityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [liability, setLiability] = useState<Liability | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  // Sprint 5.9e — FY-aggregated tax counts for this loan, refreshed
  // when flags change. Shown as an inline note: "FY 2025-26: ₹X principal
  // · ₹Y interest already counted in your tax deductions".
  const [taxNote, setTaxNote] = useState<{ fy: string; principalPaisa: number; interestPaisa: number } | null>(null);

  // Uploaded amortization schedule state
  const [uploadedAmort, setUploadedAmort] = useState<UploadedAmortRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadAmortization = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/liabilities/${params.id}/amortization`).then((r) => r.json());
      if (!r.error) setUploadedAmort(r.rows ?? []);
    } catch {
      // silent
    }
  }, [params.id]);

  const uploadAmortization = async (file: File) => {
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/investments/liabilities/${params.id}/amortization`, {
        method: 'POST',
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Upload failed');
      toast.success(`Uploaded ${data.count} rows`);
      if (data.warnings?.length) {
        data.warnings.forEach((w: string) => toast.info(w));
      }
      loadAmortization();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const syncFromSchedule = async () => {
    if (!liability) return;
    const fmt = (paisa: number) =>
      new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(paisa / 100);
    // Preview the changes against current values so the user sees what's about
    // to happen — no silent mutation of historical data.
    const first = uploadedAmort[0];
    const last = uploadedAmort[uploadedAmort.length - 1];
    if (!first || !last) {
      toast.error('No schedule rows to sync from');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const pastDueCount = uploadedAmort.filter(
      (r) => r.dueDate && r.dueDate < today && r.status !== 'PAID',
    ).length;
    const newRate =
      first.openingBalance > 0
        ? Math.round((first.interest / first.openingBalance) * 12 * 100 * 100) / 100
        : liability.interestRate;
    const lastPaidClosing =
      [...uploadedAmort]
        .reverse()
        .find((r) => r.status === 'PAID' || (r.dueDate && r.dueDate < today))?.closingBalance ?? first.openingBalance;
    const ok = confirm(
      [
        `Sync loan to bank schedule?`,
        ``,
        `• Original amount: ${fmt(liability.originalAmount)} → ${fmt(first.openingBalance)}`,
        `• EMI:             ${fmt(liability.monthlyEmi)} → ${fmt(first.emi)}`,
        `• Interest rate:   ${liability.interestRate}% → ${newRate}%`,
        `• Maturity date:   ${liability.maturityDate ?? '—'} → ${last.dueDate ?? '—'}`,
        `• Outstanding:     ${fmt(liability.currentBalance)} → ${fmt(lastPaidClosing)}`,
        `• Mark ${pastDueCount} past-due months as PAID`,
        ``,
        `Proceed?`,
      ].join('\n'),
    );
    if (!ok) return;
    setIsSyncing(true);
    try {
      const r = await fetch(
        `/api/investments/liabilities/${params.id}/sync-from-schedule`,
        { method: 'POST' },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Sync failed');
      toast.success(
        `Synced · ${data.rowsMarkedPaid} months marked paid`,
      );
      // Refresh everything that just changed.
      await Promise.all([load(), loadAmortization()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const markAmortPaid = async (row: UploadedAmortRow) => {
    try {
      const r = await fetch(`/api/investments/liabilities/${params.id}/amortization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId: row.id, status: 'PAID' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      toast.success(`Month ${row.monthNumber} marked paid — balance updated`);
      loadAmortization();
      load(); // refresh liability balance
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  // Credit card expense state
  const [expenses, setExpenses] = useState<CreditCardExpenseRow[]>([]);
  const [expensesOpen, setExpensesOpen] = useState(true);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseStatementDate, setExpenseStatementDate] = useState(new Date().toISOString().substring(0, 10));
  const [expenseDueDate, setExpenseDueDate] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [isRecordingExpense, setIsRecordingExpense] = useState(false);

  const loadExpenses = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/liabilities/${params.id}/expenses`).then((r) => r.json());
      if (!r.error) setExpenses(r.expenses ?? []);
    } catch {
      // silent — non-critical
    }
  }, [params.id]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/liabilities/${params.id}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setLiability(r.liability);
      setForm(liabilityToForm(r.liability));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load liability');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
    loadExpenses();
    loadAmortization();
  }, [load, loadExpenses, loadAmortization]);

  // Sprint 5.9e — fetch the FY-aggregated principal/interest for this
  // loan whenever the row reloads or flags change. Defaults to the
  // current FY.
  useEffect(() => {
    if (!liability) return;
    if (!liability.principalQualifies80c && !liability.interestQualifies24b) {
      setTaxNote(null);
      return;
    }
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const startYear = m >= 4 ? y : y - 1;
    const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
    fetch(`/api/finance/loan-tax-deductions?fy=${encodeURIComponent(fy)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const row = (d.perLiability ?? []).find(
          (l: { id: number }) => l.id === liability.id,
        );
        if (row) {
          setTaxNote({
            fy,
            principalPaisa: row.fyPrincipalPaisa ?? 0,
            interestPaisa: row.fyInterestPaisa ?? 0,
          });
        } else {
          setTaxNote(null);
        }
      })
      .catch(() => setTaxNote(null));
  }, [liability]);

  const onDelete = async () => {
    if (!confirm('Delete this liability?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/liabilities/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/liabilities');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const onSave = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      const body = {
        name: form.name,
        creditorName: form.creditorName,
        status: form.status,
        currentBalanceRupees: Number(form.currentBalanceRupees) || 0,
        interestRate: Number(form.interestRate) || 0,
        monthlyEmiRupees: Number(form.monthlyEmiRupees) || 0,
        maturityDate: form.maturityDate || null,
        remainingTenor: form.remainingTenor ? Number(form.remainingTenor) : null,
        notes: form.notes || null,
        // Sprint 5.9e — tax-qualification flags
        principalQualifies80c: form.principalQualifies80c,
        interestQualifies24b: form.interestQualifies24b,
      };
      const r = await fetch(`/api/investments/liabilities/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setLiability(data.liability);
      setForm(liabilityToForm(data.liability));
      setIsEditing(false);
      toast.success('Liability updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (liability) setForm(liabilityToForm(liability));
    setIsEditing(false);
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const recordExpense = async () => {
    const amt = Number(expenseAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!expenseStatementDate) { toast.error('Enter statement date'); return; }
    if (!expenseDueDate) { toast.error('Enter due date'); return; }
    setIsRecordingExpense(true);
    try {
      const r = await fetch(`/api/investments/liabilities/${params.id}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          statementDate: expenseStatementDate,
          dueDate: expenseDueDate,
          notes: expenseNotes || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      const dueMo = new Date(expenseDueDate).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
      toast.success(`Statement recorded — ${dueMo} budget updated`);
      setExpenseAmount('');
      setExpenseNotes('');
      loadExpenses();
      load(); // refresh liability (currentBalance + nextPaymentDate)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record');
    } finally {
      setIsRecordingExpense(false);
    }
  };

  const isCard = liability?.type === 'CREDIT_CARD';

  const schedule = useMemo<AmortizationRow[]>(() => {
    if (!liability || isCard) return [];
    const months = Math.min(12, liability.remainingTenor || 12);
    return amortizationSchedule(
      liability.currentBalance,
      liability.interestRate,
      months,
      liability.monthlyEmi
    );
  }, [liability, isCard]);

  /**
   * Resolve the inputs the prepay simulator should use. When a bank schedule
   * has been uploaded we trust it over the editable liability fields: pick
   * the next-due row (smallest dueDate ≥ today, else first UPCOMING), use its
   * opening balance + EMI, and back out the monthly rate from interest /
   * opening (more accurate than the manually entered interestRate, which
   * often drifts after rate resets).
   */
  const prepayInputs = useMemo(() => {
    if (!liability || isCard) return null;
    if (
      !liability.currentBalance ||
      !liability.interestRate ||
      !liability.monthlyEmi
    ) {
      return null;
    }
    const today = new Date().toISOString().slice(0, 10);
    let outstanding = liability.currentBalance;
    let emi = liability.monthlyEmi;
    let annualRate = liability.interestRate;
    let nextDate = liability.nextPaymentDate ?? null;

    if (uploadedAmort.length > 0) {
      // Pick the first row that is UPCOMING or whose dueDate is in the future.
      const upcoming =
        uploadedAmort.find(
          (r) => r.status !== 'PAID' && (r.dueDate ?? '9999-12-31') >= today,
        ) ?? uploadedAmort.find((r) => r.status !== 'PAID');
      if (upcoming) {
        outstanding = upcoming.openingBalance;
        emi = upcoming.emi;
        if (upcoming.openingBalance > 0 && upcoming.interest > 0) {
          // r_monthly = interest / opening  →  annual % = r × 12 × 100
          annualRate = (upcoming.interest / upcoming.openingBalance) * 12 * 100;
        }
        if (upcoming.dueDate) nextDate = upcoming.dueDate;
      }
    }
    return {
      outstandingPaisa: outstanding,
      annualRate: Math.round(annualRate * 100) / 100,
      baseEmiPaisa: emi,
      nextEmiDate: nextDate,
    };
  }, [liability, isCard, uploadedAmort]);

  const cardUtilisation = useMemo(() => {
    if (!liability || !isCard) return 0;
    return liability.originalAmount > 0
      ? (liability.currentBalance / liability.originalAmount) * 100
      : 0;
  }, [liability, isCard]);

  const amortColumns: Column<AmortizationRow>[] = [
    { key: 'month', header: 'Month', render: (v) => {
      const monthNum = Number(v);
      // The schedule is computed forward from TODAY's outstanding (see
      // useMemo above — opens at `currentBalance`, not original principal).
      // Anchor the month labels to the same point — the next EMI date —
      // so opening balances and date stamps tell the same story. Fall
      // back to `startDate` only when the loan hasn't logged a next
      // payment yet (brand-new entries).
      const anchor = liability?.nextPaymentDate ?? liability?.startDate;
      if (anchor) {
        const d = new Date(anchor);
        d.setMonth(d.getMonth() + monthNum - 1);
        return <span>{d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>;
      }
      return <span className="font-mono">{String(v)}</span>;
    }},
    {
      key: 'opening',
      header: 'Opening',
      render: (_v, r) => <span className="font-mono">{formatINR(r.opening)}</span>,
    },
    {
      key: 'interest',
      header: 'Interest',
      render: (_v, r) => <span className="font-mono text-rose-600">{formatINR(r.interest)}</span>,
    },
    {
      key: 'principal',
      header: 'Principal',
      render: (_v, r) => <span className="font-mono text-emerald-700">{formatINR(r.principal)}</span>,
    },
    {
      key: 'closing',
      header: 'Closing',
      render: (_v, r) => <span className="font-mono font-semibold">{formatINR(r.closing)}</span>,
    },
    { key: 'emi', header: 'EMI', render: (_v, r) => <span className="font-mono">{formatINR(r.emi)}</span> },
  ];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }
  if (!liability || !form) return <p>Not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/liabilities"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to liabilities
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {liability.name}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">{liability.creditorName}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{liability.type.replace('_', ' ')}</Badge>
          {!isEditing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
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
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
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
          {
            label: isCard ? 'Current balance' : 'Outstanding',
            value: liability.currentBalance / 100,
            format: 'currency',
          },
          {
            label: isCard ? 'Credit limit' : 'Original amount',
            value: liability.originalAmount / 100,
            format: 'currency',
          },
          { label: isCard ? 'Min due' : 'EMI', value: liability.monthlyEmi / 100, format: 'currency' },
          { label: 'Interest rate', value: liability.interestRate, format: 'number' },
        ]}
      />

      {isCard && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <CreditCard className="h-5 w-5 text-[var(--dxp-brand)]" />
              Utilisation
            </h3>
          </CardHeader>
          <CardContent>
            <p
              className={`text-3xl font-bold font-mono ${
                cardUtilisation > 30 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {cardUtilisation.toFixed(1)}%
            </p>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
              <div
                className={`h-full ${cardUtilisation > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, cardUtilisation)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">
              Keep utilisation under 30% to maintain a healthy credit score.
            </p>
          </CardContent>
        </Card>
      )}

      {isCard && (
        <Card>
          <CardHeader>
            <button
              className="flex w-full items-center justify-between"
              onClick={() => setExpensesOpen((o) => !o)}
            >
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <CreditCard className="h-5 w-5 text-[var(--dxp-brand)]" />
                Monthly Spend History
              </h3>
              <ChevronDown
                className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${expensesOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </CardHeader>
          {expensesOpen && (
            <CardContent className="space-y-4">
              {/* Record form */}
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt,var(--dxp-surface))] p-3">
                <Field label="Statement amount (₹)">
                  <Input
                    type="number"
                    placeholder="e.g. 35000"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                  />
                </Field>
                <Field label="Statement date">
                  <Input
                    type="date"
                    value={expenseStatementDate}
                    onChange={(e) => setExpenseStatementDate(e.target.value)}
                  />
                </Field>
                <Field label="Due date">
                  <Input
                    type="date"
                    value={expenseDueDate}
                    onChange={(e) => setExpenseDueDate(e.target.value)}
                  />
                </Field>
                <Field label="Notes">
                  <Input
                    placeholder="Optional"
                    value={expenseNotes}
                    onChange={(e) => setExpenseNotes(e.target.value)}
                  />
                </Field>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={recordExpense}
                  disabled={isRecordingExpense}
                >
                  {isRecordingExpense ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Record
                </Button>
              </div>

              {/* Expense table */}
              {expenses.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--dxp-border)] text-left text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                        <th className="pb-2 pr-4">Statement</th>
                        <th className="pb-2 pr-4 text-right">Amount</th>
                        <th className="pb-2 pr-4">Due</th>
                        <th className="pb-2 pr-4">Budget month</th>
                        <th className="pb-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((exp) => (
                        <tr
                          key={exp.id}
                          className="border-b border-[var(--dxp-border-light)]"
                        >
                          <td className="py-2 pr-4 text-[var(--dxp-text-secondary)]">
                            {exp.statementDate ?? exp.paidOn}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono text-[var(--dxp-text)]">
                            {formatINR(exp.amount)}
                          </td>
                          <td className="py-2 pr-4 text-[var(--dxp-text-secondary)]">
                            {exp.dueDate ?? '-'}
                          </td>
                          <td className="py-2 pr-4 font-mono font-medium text-[var(--dxp-text)]">
                            {formatPeriod(exp.period)}
                          </td>
                          <td className="py-2 text-[var(--dxp-text-muted)]">
                            {exp.notes ?? '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--dxp-text-muted)]">
                  No monthly spends recorded yet. Use the form above to record your card statement total.
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {!isCard && prepayInputs && (
        <PrepaySimulator
          outstandingPaisa={prepayInputs.outstandingPaisa}
          annualRate={prepayInputs.annualRate}
          baseEmiPaisa={prepayInputs.baseEmiPaisa}
          nextEmiDate={prepayInputs.nextEmiDate}
        />
      )}

      {!isCard && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Amortization {uploadedAmort.length > 0 ? `(${uploadedAmort.length} months)` : '(next 12 months)'}
                </h3>
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  {uploadedAmort.length > 0
                    ? 'Uploaded from bank schedule'
                    : 'Computed from current outstanding, interest rate and EMI'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {uploadedAmort.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={syncFromSchedule}
                    disabled={isSyncing}
                    title="Pull original amount, EMI, rate, maturity and current balance from the uploaded schedule; mark past-due months as paid."
                  >
                    {isSyncing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Sync to bank values
                  </Button>
                )}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".csv,.txt,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAmortization(f);
                      e.target.value = '';
                    }}
                    disabled={isUploading}
                  />
                  <Button variant="secondary" size="sm" asChild disabled={isUploading}>
                    <span>
                      {isUploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Upload schedule
                    </span>
                  </Button>
                </label>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {uploadedAmort.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--dxp-border)] text-left text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                      <th className="pb-2 pr-3">Month</th>
                      <th className="pb-2 pr-3 text-right">Opening</th>
                      <th className="pb-2 pr-3 text-right">EMI</th>
                      <th className="pb-2 pr-3 text-right">Principal</th>
                      <th className="pb-2 pr-3 text-right">Interest</th>
                      <th className="pb-2 pr-3 text-right">Closing</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadedAmort.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b border-[var(--dxp-border-light)] ${
                          row.status === 'PAID' ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="py-1.5 pr-3 text-[var(--dxp-text)]">
                          {(() => {
                            // Bank-uploaded schedule: row.dueDate is the truth.
                            // Fallback: anchor to nextPaymentDate (today-forward)
                            // not startDate (origination), matching the computed-
                            // schedule renderer above.
                            if (row.dueDate) {
                              return new Date(row.dueDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                            }
                            const anchor = liability.nextPaymentDate ?? liability.startDate;
                            if (anchor) {
                              const d = new Date(anchor);
                              d.setMonth(d.getMonth() + row.monthNumber - 1);
                              return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                            }
                            return `Month ${row.monthNumber}`;
                          })()}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">{formatINR(row.openingBalance)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{formatINR(row.emi)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono text-emerald-700">{formatINR(row.principal)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono text-rose-600">{formatINR(row.interest)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono font-semibold">{formatINR(row.closingBalance)}</td>
                        <td className="py-1.5 pr-3">
                          {row.status === 'PAID' ? (
                            <Badge variant="success">Paid</Badge>
                          ) : (
                            <Badge variant="warning">Due</Badge>
                          )}
                        </td>
                        <td className="py-1.5">
                          {row.status !== 'PAID' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markAmortPaid(row)}
                              title="Mark as paid"
                            >
                              <Check className="h-4 w-4 text-emerald-600" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : schedule.length > 0 ? (
              <DataTable<AmortizationRow> columns={amortColumns} data={schedule} emptyMessage="No schedule" />
            ) : (
              <p className="text-sm text-[var(--dxp-text-muted)]">
                Upload a CSV or PDF amortization schedule from your lender.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Loan information</h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView liability={liability} taxNote={taxNote} />
          ) : (
            <EditForm form={form} setField={setField} isCard={isCard} taxNote={taxNote} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* --- view mode ----------------------------------------------------------- */

function DetailView({
  liability,
  taxNote,
}: {
  liability: Liability;
  taxNote: { fy: string; principalPaisa: number; interestPaisa: number } | null;
}) {
  const fields: Array<[string, string]> = [
    ['Name', liability.name],
    ['Creditor', liability.creditorName],
    ['Status', liability.status ?? 'ACTIVE'],
    ['Interest rate', `${liability.interestRate}%`],
    ['Start date', liability.startDate],
    ...(liability.maturityDate ? [['Maturity', liability.maturityDate] as [string, string]] : []),
    ...(liability.remainingTenor ? [['Months remaining', liability.remainingTenor.toString()] as [string, string]] : []),
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
      {/* Sprint 5.9e — tax-qualification flags status */}
      <div className="mt-4 rounded border border-[var(--dxp-border)] p-3 text-xs">
        <p className="font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
          Tax treatment
        </p>
        <ul className="mt-1 space-y-0.5 text-[var(--dxp-text)]">
          <li className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                liability.principalQualifies80c ? 'bg-emerald-500' : 'bg-[var(--dxp-border)]'
              }`}
            />
            Principal{' '}
            {liability.principalQualifies80c ? 'qualifies' : 'does not qualify'} for
            Section 80C deduction
          </li>
          <li className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                liability.interestQualifies24b ? 'bg-emerald-500' : 'bg-[var(--dxp-border)]'
              }`}
            />
            Interest{' '}
            {liability.interestQualifies24b ? 'qualifies' : 'does not qualify'} for
            Section 24(b) deduction
          </li>
        </ul>
        {taxNote && (taxNote.principalPaisa > 0 || taxNote.interestPaisa > 0) && (
          <p className="mt-2 text-[var(--dxp-text-secondary)]">
            FY {taxNote.fy}:{' '}
            {liability.principalQualifies80c && taxNote.principalPaisa > 0 && (
              <>
                <span className="font-mono">{formatINR(taxNote.principalPaisa)}</span> principal
              </>
            )}
            {liability.principalQualifies80c &&
              taxNote.principalPaisa > 0 &&
              liability.interestQualifies24b &&
              taxNote.interestPaisa > 0 &&
              ' · '}
            {liability.interestQualifies24b && taxNote.interestPaisa > 0 && (
              <>
                <span className="font-mono">{formatINR(taxNote.interestPaisa)}</span> interest
              </>
            )}{' '}
            already counted in your tax deductions.
          </p>
        )}
      </div>
      {liability.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)]">{liability.notes}</p>
      )}
    </>
  );
}

/* --- edit mode ----------------------------------------------------------- */

function EditForm({
  form,
  setField,
  isCard,
  taxNote,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  isCard: boolean;
  taxNote: { fy: string; principalPaisa: number; interestPaisa: number } | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Name">
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
      </Field>

      <Field label="Creditor">
        <Input value={form.creditorName} onChange={(e) => setField('creditorName', e.target.value)} />
      </Field>

      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as LiabilityStatus)}
          options={STATUS_OPTIONS}
        />
      </Field>

      <Field label={isCard ? 'Current balance (₹)' : 'Outstanding (₹)'}>
        <Input
          type="number"
          value={form.currentBalanceRupees}
          onChange={(e) => setField('currentBalanceRupees', e.target.value)}
        />
      </Field>

      <Field label="Interest rate (%)">
        <Input
          type="number"
          step="0.01"
          value={form.interestRate}
          onChange={(e) => setField('interestRate', e.target.value)}
        />
      </Field>

      <Field label={isCard ? 'Min due (₹)' : 'EMI (₹)'}>
        <Input
          type="number"
          value={form.monthlyEmiRupees}
          onChange={(e) => setField('monthlyEmiRupees', e.target.value)}
        />
      </Field>

      <Field label="Maturity date">
        <Input
          type="date"
          value={form.maturityDate}
          onChange={(e) => setField('maturityDate', e.target.value)}
        />
      </Field>

      <Field label="Months remaining">
        <Input
          type="number"
          value={form.remainingTenor}
          onChange={(e) => setField('remainingTenor', e.target.value)}
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

      {/* Sprint 5.9e — tax-qualification flags. Default is true for
          HOME_LOAN (set by migration 0031), false for everything else.
          User can toggle e.g. for AUTO_LOAN that's actually a
          let-out home (rare but possible). */}
      <div className="sm:col-span-2">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
          Tax treatment
        </p>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.principalQualifies80c}
            onChange={(e) => setField('principalQualifies80c', e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--dxp-brand)]"
          />
          <span className="text-[var(--dxp-text)]">
            Principal qualifies for 80C deduction
            <span className="block text-xs text-[var(--dxp-text-muted)]">
              Default for HOME_LOAN. Subject to the ₹1.5L 80C cap.
            </span>
          </span>
        </label>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.interestQualifies24b}
            onChange={(e) => setField('interestQualifies24b', e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--dxp-brand)]"
          />
          <span className="text-[var(--dxp-text)]">
            Interest qualifies for Section 24(b) deduction
            <span className="block text-xs text-[var(--dxp-text-muted)]">
              Default for HOME_LOAN. ₹2L self-occupied cap / uncapped let-out.
            </span>
          </span>
        </label>
        {taxNote && (taxNote.principalPaisa > 0 || taxNote.interestPaisa > 0) && (
          <p className="mt-2 text-xs text-[var(--dxp-text-secondary)]">
            FY {taxNote.fy}:{' '}
            {form.principalQualifies80c && taxNote.principalPaisa > 0 && (
              <>
                <span className="font-mono">{formatINR(taxNote.principalPaisa)}</span> principal
              </>
            )}
            {form.principalQualifies80c &&
              taxNote.principalPaisa > 0 &&
              form.interestQualifies24b &&
              taxNote.interestPaisa > 0 &&
              ' · '}
            {form.interestQualifies24b && taxNote.interestPaisa > 0 && (
              <>
                <span className="font-mono">{formatINR(taxNote.interestPaisa)}</span> interest
              </>
            )}{' '}
            already counted in your tax deductions.
          </p>
        )}
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
