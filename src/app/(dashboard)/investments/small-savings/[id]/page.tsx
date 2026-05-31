'use client';

/**
 * Small Savings — account detail.
 *
 * Stacked sections:
 *   1. Account details (inline Edit/Save/Cancel)
 *   2. Lock-in + maturity (computed in JS; SSY shows child age)
 *   3. Transactions ledger + inline add form
 *   4. Projection table (fetched from /projection endpoint)
 */

import { useEffect, useState, useCallback } from 'react';
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
import {
  ArrowLeft,
  Loader2,
  Landmark,
  Trash2,
  Pencil,
  Save,
  X,
  Plus,
  Lock,
  TrendingUp,
  History,
} from 'lucide-react';

type SmallSavingsScheme = 'PPF' | 'VPF' | 'NSC' | 'KVP' | 'SSY' | 'SCSS';
type SmallSavingsStatus = 'ACTIVE' | 'MATURED' | 'CLOSED' | 'EXTENDED';
type InterestCompounding = 'YEARLY' | 'HALF_YEARLY' | 'QUARTERLY';
type SmallSavingsTxnType =
  | 'DEPOSIT'
  | 'INTEREST_CREDIT'
  | 'WITHDRAWAL'
  | 'PARTIAL_WITHDRAWAL'
  | 'MATURITY';

interface Account {
  id: number;
  schemeType: SmallSavingsScheme;
  accountNumber: string;
  holderName: string;
  holderDob: string | null;
  pan: string | null;
  institution: string | null;
  openingDate: string;
  maturityDate: string;
  extensionBlocksUsed: number | null;
  depositAmountPaisa: number;
  currentBalancePaisa: number;
  interestRatePercent: number;
  interestCompounding: InterestCompounding;
  lockInEndDate: string | null;
  totalDepositedPaisa: number;
  totalInterestPaisa: number;
  status: SmallSavingsStatus;
  notes: string | null;
}

interface Transaction {
  id: number;
  accountId: number;
  txnDate: string;
  txnType: SmallSavingsTxnType;
  amountPaisa: number;
  balanceAfterPaisa: number | null;
  referenceNumber: string | null;
  notes: string | null;
}

interface ProjectionPoint {
  date: string;
  balance: number;
  deposits: number;
  interest: number;
}

interface ProjectionResponse {
  points: ProjectionPoint[];
  maturityDate: string;
  totalProjected: number;
  payoutInterest: boolean;
}

const STATUS_OPTIONS: Array<{ label: string; value: SmallSavingsStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Matured', value: 'MATURED' },
  { label: 'Closed', value: 'CLOSED' },
  { label: 'Extended', value: 'EXTENDED' },
];

const COMPOUNDING_OPTIONS: Array<{ label: string; value: InterestCompounding }> = [
  { label: 'Yearly', value: 'YEARLY' },
  { label: 'Half-yearly', value: 'HALF_YEARLY' },
  { label: 'Quarterly', value: 'QUARTERLY' },
];

const TXN_TYPE_OPTIONS: Array<{ label: string; value: SmallSavingsTxnType }> = [
  { label: 'Deposit', value: 'DEPOSIT' },
  { label: 'Interest credit', value: 'INTEREST_CREDIT' },
  { label: 'Withdrawal', value: 'WITHDRAWAL' },
  { label: 'Partial withdrawal', value: 'PARTIAL_WITHDRAWAL' },
  { label: 'Maturity', value: 'MATURITY' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

/* ─── date helpers ────────────────────────────────────────────────────── */

function diffYearsMonthsDays(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '—';
  if (to <= from) return 'Reached';
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(to.getFullYear(), to.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts: string[] = [];
  if (years) parts.push(`${years}y`);
  if (months) parts.push(`${months}m`);
  if (!years && !months) parts.push(`${days}d`);
  return parts.join(' ') || '—';
}

function childAge(dobIso: string | null): string {
  if (!dobIso) return '—';
  const today = new Date().toISOString().slice(0, 10);
  return diffYearsMonthsDays(dobIso, today);
}

interface FormState {
  accountNumber: string;
  holderName: string;
  holderDob: string;
  pan: string;
  institution: string;
  openingDate: string;
  maturityDate: string;
  extensionBlocksUsed: string;
  depositAmountRupees: string;
  currentBalanceRupees: string;
  interestRatePercent: string;
  interestCompounding: InterestCompounding;
  lockInEndDate: string;
  totalDepositedRupees: string;
  totalInterestRupees: string;
  status: SmallSavingsStatus;
  notes: string;
}

function accountToForm(a: Account): FormState {
  return {
    accountNumber: a.accountNumber,
    holderName: a.holderName,
    holderDob: a.holderDob ?? '',
    pan: a.pan ?? '',
    institution: a.institution ?? '',
    openingDate: a.openingDate,
    maturityDate: a.maturityDate,
    extensionBlocksUsed: (a.extensionBlocksUsed ?? 0).toString(),
    depositAmountRupees: (a.depositAmountPaisa / 100).toString(),
    currentBalanceRupees: (a.currentBalancePaisa / 100).toString(),
    interestRatePercent: a.interestRatePercent.toString(),
    interestCompounding: a.interestCompounding,
    lockInEndDate: a.lockInEndDate ?? '',
    totalDepositedRupees: (a.totalDepositedPaisa / 100).toString(),
    totalInterestRupees: (a.totalInterestPaisa / 100).toString(),
    status: a.status,
    notes: a.notes ?? '',
  };
}

export default function SmallSavingsDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const accountId = params.id;

  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [projection, setProjection] = useState<ProjectionResponse | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const [bundleRes, projRes] = await Promise.all([
        fetch(`/api/investments/small-savings/${accountId}`).then((r) => r.json()),
        fetch(`/api/investments/small-savings/${accountId}/projection`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (bundleRes.error) throw new Error(bundleRes.error);
      setAccount(bundleRes.account);
      setTransactions(bundleRes.transactions || []);
      setForm(accountToForm(bundleRes.account));
      setProjection(projRes);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load account');
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this account along with all transactions?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/small-savings/${accountId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/small-savings');
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
        accountNumber: form.accountNumber,
        holderName: form.holderName,
        holderDob: form.holderDob || null,
        pan: form.pan || null,
        institution: form.institution || null,
        openingDate: form.openingDate,
        maturityDate: form.maturityDate,
        extensionBlocksUsed: form.extensionBlocksUsed ? Number(form.extensionBlocksUsed) : 0,
        depositAmountRupees: Number(form.depositAmountRupees) || 0,
        currentBalanceRupees: Number(form.currentBalanceRupees) || 0,
        interestRatePercent: Number(form.interestRatePercent) || 0,
        interestCompounding: form.interestCompounding,
        lockInEndDate: form.lockInEndDate || null,
        totalDepositedRupees: Number(form.totalDepositedRupees) || 0,
        totalInterestRupees: Number(form.totalInterestRupees) || 0,
        status: form.status,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/small-savings/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setAccount(data.account);
      setForm(accountToForm(data.account));
      setIsEditing(false);
      toast.success('Account updated');
      // Refresh projection — rate/balance may have changed.
      const projRes = await fetch(`/api/investments/small-savings/${accountId}/projection`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      setProjection(projRes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (account) setForm(accountToForm(account));
    setIsEditing(false);
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
  if (!account || !form) return <p>Not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/small-savings"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to small savings
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {account.schemeType} · {account.accountNumber}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">{account.holderName}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{account.schemeType}</Badge>
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
          { label: 'Current balance', value: account.currentBalancePaisa / 100, format: 'currency' },
          { label: 'Total deposited', value: account.totalDepositedPaisa / 100, format: 'currency' },
          { label: 'Interest earned', value: account.totalInterestPaisa / 100, format: 'currency' },
          { label: 'Interest rate', value: account.interestRatePercent, format: 'number' },
        ]}
      />

      {/* ── Section 1: Account details ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Landmark className="h-5 w-5 text-[var(--dxp-brand)]" />
            Account details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <AccountDetailView account={account} />
          ) : (
            <AccountEditForm form={form} setField={setField} schemeType={account.schemeType} />
          )}
        </CardContent>
      </Card>

      {/* ── Section 2: Lock-in + maturity ──────────────────────────── */}
      <LockInSection account={account} />

      {/* ── Section 3: Transactions ────────────────────────────────── */}
      <TransactionsSection
        accountId={account.id}
        transactions={transactions}
        onChanged={load}
      />

      {/* ── Section 4: Projection ──────────────────────────────────── */}
      <ProjectionSection
        account={account}
        projection={projection}
      />
    </div>
  );
}

/* ─── view mode ───────────────────────────────────────────────────────── */

function AccountDetailView({ account }: { account: Account }) {
  const fields: Array<[string, string]> = [
    ['Scheme', account.schemeType],
    ['Status', account.status],
    ['Holder', account.holderName],
    ['Account #', account.accountNumber],
    ['Institution', account.institution ?? '—'],
    ['PAN', account.pan ?? '—'],
    ['Opening date', account.openingDate],
    ['Maturity date', account.maturityDate],
    ['Rate', `${account.interestRatePercent.toFixed(2)}%`],
    ['Compounding', account.interestCompounding.replace('_', ' ')],
    ['Regular deposit', formatINR(account.depositAmountPaisa)],
    ['Extension blocks', (account.extensionBlocksUsed ?? 0).toString()],
  ];
  if (account.schemeType === 'SSY' && account.holderDob) {
    fields.splice(3, 0, ["Child's DOB", account.holderDob]);
  }
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between border-b border-[var(--dxp-border)] pb-2"
          >
            <dt className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              {label}
            </dt>
            <dd className="text-sm text-[var(--dxp-text)]">{value}</dd>
          </div>
        ))}
      </dl>
      {account.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)] whitespace-pre-wrap">
          {account.notes}
        </p>
      )}
    </>
  );
}

/* ─── edit mode ───────────────────────────────────────────────────────── */

function AccountEditForm({
  form,
  setField,
  schemeType,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  schemeType: SmallSavingsScheme;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Account number">
        <Input value={form.accountNumber} onChange={(e) => setField('accountNumber', e.target.value)} />
      </Field>
      <Field label="Holder name">
        <Input value={form.holderName} onChange={(e) => setField('holderName', e.target.value)} />
      </Field>
      {schemeType === 'SSY' && (
        <Field label="Child's DOB">
          <Input
            type="date"
            value={form.holderDob}
            onChange={(e) => setField('holderDob', e.target.value)}
          />
        </Field>
      )}
      <Field label="PAN">
        <Input value={form.pan} onChange={(e) => setField('pan', e.target.value)} />
      </Field>
      <Field label="Institution">
        <Input
          value={form.institution}
          onChange={(e) => setField('institution', e.target.value)}
          placeholder="Bank / Post Office branch"
        />
      </Field>
      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as SmallSavingsStatus)}
          options={STATUS_OPTIONS}
        />
      </Field>
      <Field label="Opening date">
        <Input
          type="date"
          value={form.openingDate}
          onChange={(e) => setField('openingDate', e.target.value)}
        />
      </Field>
      <Field label="Maturity date">
        <Input
          type="date"
          value={form.maturityDate}
          onChange={(e) => setField('maturityDate', e.target.value)}
        />
      </Field>
      <Field label="Lock-in end">
        <Input
          type="date"
          value={form.lockInEndDate}
          onChange={(e) => setField('lockInEndDate', e.target.value)}
        />
      </Field>
      <Field label="Extension blocks used">
        <Input
          type="number"
          value={form.extensionBlocksUsed}
          onChange={(e) => setField('extensionBlocksUsed', e.target.value)}
        />
      </Field>
      <Field label="Interest rate (%)">
        <Input
          type="number"
          step="0.01"
          value={form.interestRatePercent}
          onChange={(e) => setField('interestRatePercent', e.target.value)}
        />
      </Field>
      <Field label="Compounding">
        <Select
          value={form.interestCompounding}
          onChange={(v) => setField('interestCompounding', v as InterestCompounding)}
          options={COMPOUNDING_OPTIONS}
        />
      </Field>
      <Field label="Regular deposit (₹/mo)">
        <Input
          type="number"
          value={form.depositAmountRupees}
          onChange={(e) => setField('depositAmountRupees', e.target.value)}
        />
      </Field>
      <Field label="Current balance (₹)">
        <Input
          type="number"
          value={form.currentBalanceRupees}
          onChange={(e) => setField('currentBalanceRupees', e.target.value)}
        />
      </Field>
      <Field label="Total deposited (₹)">
        <Input
          type="number"
          value={form.totalDepositedRupees}
          onChange={(e) => setField('totalDepositedRupees', e.target.value)}
        />
      </Field>
      <Field label="Total interest (₹)">
        <Input
          type="number"
          value={form.totalInterestRupees}
          onChange={(e) => setField('totalInterestRupees', e.target.value)}
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

/* ─── Lock-in section ─────────────────────────────────────────────────── */

function LockInSection({ account }: { account: Account }) {
  const today = new Date().toISOString().slice(0, 10);
  const lockInEnd = account.lockInEndDate ?? account.maturityDate;
  const lockInRemaining = diffYearsMonthsDays(today, lockInEnd);
  const maturityRemaining = diffYearsMonthsDays(today, account.maturityDate);

  // SSY-specific extras: child age + time until 18.
  let childExtras: Array<[string, string]> = [];
  if (account.schemeType === 'SSY' && account.holderDob) {
    const eighteenth = new Date(account.holderDob);
    eighteenth.setFullYear(eighteenth.getFullYear() + 18);
    const eighteenthIso = eighteenth.toISOString().slice(0, 10);
    childExtras = [
      ['Child age', childAge(account.holderDob)],
      ['Turns 18 on', eighteenthIso],
      ['Time until 18', diffYearsMonthsDays(today, eighteenthIso)],
    ];
  }

  const rows: Array<[string, string]> = [
    ['Opening date', account.openingDate],
    ['Maturity date', account.maturityDate],
    ['Lock-in ends', lockInEnd],
    ['Lock-in remaining', lockInRemaining],
    ['Time until maturity', maturityRemaining],
  ];
  if (account.schemeType === 'PPF') {
    rows.push(['Extension blocks used', (account.extensionBlocksUsed ?? 0).toString()]);
  }
  rows.push(...childExtras);

  return (
    <Card>
      <CardHeader>
        <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
          <Lock className="h-5 w-5 text-[var(--dxp-brand)]" />
          Lock-in &amp; maturity
        </h3>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between border-b border-[var(--dxp-border)] pb-2"
            >
              <dt className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                {label}
              </dt>
              <dd className="text-sm text-[var(--dxp-text)]">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ─── Transactions section ────────────────────────────────────────────── */

interface TxnFormState {
  txnDate: string;
  txnType: SmallSavingsTxnType;
  amountRupees: string;
  referenceNumber: string;
  notes: string;
}

const emptyTxnForm: TxnFormState = {
  txnDate: new Date().toISOString().slice(0, 10),
  txnType: 'DEPOSIT',
  amountRupees: '',
  referenceNumber: '',
  notes: '',
};

function TransactionsSection({
  accountId,
  transactions,
  onChanged,
}: {
  accountId: number;
  transactions: Transaction[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<TxnFormState>(emptyTxnForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startAdd = () => {
    setForm(emptyTxnForm);
    setAdding(true);
  };
  const cancel = () => {
    setAdding(false);
    setForm(emptyTxnForm);
  };

  const submit = async () => {
    if (!form.txnDate || !form.amountRupees) {
      toast.error('Date and amount are required');
      return;
    }
    setIsSubmitting(true);
    try {
      const body = {
        txnDate: form.txnDate,
        txnType: form.txnType,
        amountRupees: Number(form.amountRupees) || 0,
        referenceNumber: form.referenceNumber.trim() || null,
        notes: form.notes.trim() || null,
      };
      const r = await fetch(`/api/investments/small-savings/${accountId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success('Transaction recorded');
      cancel();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this transaction? Account balance will be rebalanced.')) return;
    try {
      const r = await fetch(`/api/investments/small-savings/transactions/${id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Transaction removed');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const columns: Column<Transaction>[] = [
    {
      key: 'txnDate',
      header: 'Date',
      render: (_v, t) => <span className="text-sm">{t.txnDate}</span>,
    },
    {
      key: 'txnType',
      header: 'Type',
      render: (_v, t) => <Badge variant="info">{t.txnType.replace('_', ' ')}</Badge>,
    },
    {
      key: 'amountPaisa',
      header: 'Amount',
      render: (_v, t) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(t.amountPaisa)}</span>
      ),
    },
    {
      key: 'balanceAfterPaisa',
      header: 'Balance after',
      render: (_v, t) => (
        <span className="font-mono text-sm text-[var(--dxp-text-secondary)]">
          {t.balanceAfterPaisa != null ? formatINR(t.balanceAfterPaisa) : '—'}
        </span>
      ),
    },
    {
      key: 'referenceNumber',
      header: 'Reference',
      render: (_v, t) => (
        <span className="font-mono text-xs text-[var(--dxp-text-muted)]">
          {t.referenceNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (_v, t) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            remove(t.id);
          }}
        >
          <Trash2 className="h-4 w-4 text-rose-500" />
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <History className="h-5 w-5 text-[var(--dxp-brand)]" />
            Transactions ({transactions.length})
          </h3>
          {!adding && (
            <Button variant="secondary" size="sm" onClick={startAdd}>
              <Plus className="mr-1 h-3 w-3" /> Add transaction
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4 rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Date">
                <Input
                  type="date"
                  value={form.txnDate}
                  onChange={(e) => setForm((f) => ({ ...f, txnDate: e.target.value }))}
                />
              </Field>
              <Field label="Type">
                <Select
                  value={form.txnType}
                  onChange={(v) => setForm((f) => ({ ...f, txnType: v as SmallSavingsTxnType }))}
                  options={TXN_TYPE_OPTIONS}
                />
              </Field>
              <Field label="Amount (₹)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.amountRupees}
                  onChange={(e) => setForm((f) => ({ ...f, amountRupees: e.target.value }))}
                />
              </Field>
              <Field label="Reference number">
                <Input
                  value={form.referenceNumber}
                  onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                  placeholder="UTR / cheque #"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Record transaction
              </Button>
            </div>
          </div>
        )}

        {transactions.length === 0 && !adding ? (
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
            No transactions yet.
          </p>
        ) : (
          <DataTable<Transaction>
            columns={columns}
            data={transactions}
            emptyMessage="No transactions"
          />
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Projection section ──────────────────────────────────────────────── */

function ProjectionSection({
  account,
  projection,
}: {
  account: Account;
  projection: ProjectionResponse | null;
}) {
  if (!projection) {
    return (
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <TrendingUp className="h-5 w-5 text-[var(--dxp-brand)]" />
            Projection
          </h3>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
            Projection unavailable.
          </p>
        </CardContent>
      </Card>
    );
  }

  const columns: Column<ProjectionPoint>[] = [
    {
      key: 'date',
      header: 'Year-end',
      render: (_v, p) => <span className="text-sm">{p.date}</span>,
    },
    {
      key: 'balance',
      header: 'Balance',
      render: (_v, p) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">{formatINR(p.balance)}</span>
      ),
    },
    {
      key: 'deposits',
      header: 'Deposits this year',
      render: (_v, p) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {p.deposits ? formatINR(p.deposits) : '—'}
        </span>
      ),
    },
    {
      key: 'interest',
      header: 'Interest this year',
      render: (_v, p) => (
        <span className="font-mono text-emerald-600 dark:text-emerald-400">
          {p.interest ? formatINR(p.interest) : '—'}
        </span>
      ),
    },
  ];

  // SCSS summary tells the user this is a quarterly payout (no compounding),
  // so the "balance" stays flat while interest accumulates as cash to the bank.
  const isSCSS = account.schemeType === 'SCSS';
  const quarterlyPayout = isSCSS
    ? Math.round((account.currentBalancePaisa * (account.interestRatePercent / 100)) / 4)
    : 0;

  return (
    <Card>
      <CardHeader>
        <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
          <TrendingUp className="h-5 w-5 text-[var(--dxp-brand)]" />
          Projection
        </h3>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-[var(--dxp-text-secondary)]">
          {isSCSS ? (
            <>
              Quarterly payouts of{' '}
              <strong className="text-[var(--dxp-text)]">{formatINR(quarterlyPayout)}</strong> to
              your bank at {account.interestRatePercent.toFixed(2)}%. Principal{' '}
              <strong className="text-[var(--dxp-text)]">{formatINR(account.currentBalancePaisa)}</strong>{' '}
              returned at maturity on{' '}
              <strong className="text-[var(--dxp-text)]">{projection.maturityDate}</strong>.
            </>
          ) : (
            <>
              At maturity (
              <strong className="text-[var(--dxp-text)]">{projection.maturityDate}</strong>):{' '}
              <strong className="text-[var(--dxp-text)]">
                {formatINR(projection.totalProjected)}
              </strong>{' '}
              with assumed{' '}
              <strong>{account.interestRatePercent.toFixed(2)}%</strong>{' '}
              {account.interestCompounding.toLowerCase().replace('_', ' ')} compounding.
            </>
          )}
        </p>
        {projection.points.length > 0 ? (
          <DataTable<ProjectionPoint>
            columns={columns}
            data={projection.points}
            emptyMessage="No projection points"
          />
        ) : (
          <p className="text-sm text-[var(--dxp-text-muted)]">
            No projection points to show (maturity may already be reached).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
