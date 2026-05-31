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
  Select,
  type Column,
} from '@dxp/ui';
import { ArrowLeft, Loader2, Users, Zap, Trophy, Check, Pencil, Save, X, Trash2 } from 'lucide-react';
import { BidAdvisor } from './_components/BidAdvisor';
import { PostWinTracker } from './_components/PostWinTracker';
import {
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface ChitRecord {
  id: number;
  foremanName: string;
  schemeName: string;
  registrationNumber: string | null;
  isRegistered: boolean | null;
  chitValue: number;
  monthlyInstallment: number;
  durationMonths: number;
  groupSize: number;
  ticketNumber: string | null;
  startDate: string;
  expectedEndDate: string;
  foremanCommissionPct: number | null;
  documentChargesPaisa: number | null;
  promptPaymentDiscountPct: number | null;
  installmentsPaid: number | null;
  totalPaid: number | null;
  totalDividends: number | null;
  netContribution: number | null;
  status: 'ACTIVE' | 'WON' | 'COMPLETED' | 'WITHDRAWN';
  winMonth: number | null;
  winDate: string | null;
  winBidDiscountPct: number | null;
  winAmountReceived: number | null;
  xirr: number | null;
  nextDueDate: string | null;
  notes: string | null;
}

interface InstallmentRow {
  id: number;
  monthNumber: number;
  dueDate: string;
  installmentPaid: number;
  dividendReceived: number | null;
  netOutgo: number;
  paidOn: string;
  paymentMethod: string | null;
  winnerName: string | null;
  winnerBidDiscountPct: number | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const statusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  ACTIVE: 'default',
  WON: 'success',
  COMPLETED: 'default',
  WITHDRAWN: 'warning',
};

const STATUS_OPTIONS = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Won', value: 'WON' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Withdrawn', value: 'WITHDRAWN' },
];

interface FormState {
  foremanName: string;
  schemeName: string;
  registrationNumber: string;
  ticketNumber: string;
  chitValueRupees: string;
  monthlyInstallmentRupees: string;
  durationMonths: string;
  groupSize: string;
  startDate: string;
  expectedEndDate: string;
  foremanCommissionPct: string;
  documentChargesRupees: string;
  nextDueDate: string;
  status: string;
  notes: string;
  // Win-detail fields (only shown when status === 'WON'). All optional.
  editWinMonth: string;
  editWinDate: string;
  editWinBidRupees: string;
  editWinChequeRupees: string;
  editWinChequeManuallyEdited: boolean;
}

function chitToForm(c: ChitRecord): FormState {
  return {
    foremanName: c.foremanName,
    schemeName: c.schemeName,
    registrationNumber: c.registrationNumber ?? '',
    ticketNumber: c.ticketNumber ?? '',
    chitValueRupees: (c.chitValue / 100).toString(),
    monthlyInstallmentRupees: (c.monthlyInstallment / 100).toString(),
    durationMonths: c.durationMonths.toString(),
    groupSize: c.groupSize.toString(),
    startDate: c.startDate,
    expectedEndDate: c.expectedEndDate,
    foremanCommissionPct: (c.foremanCommissionPct ?? 5).toString(),
    documentChargesRupees: ((c.documentChargesPaisa ?? 0) / 100).toString(),
    nextDueDate: c.nextDueDate ?? '',
    status: c.status,
    notes: c.notes ?? '',
    editWinMonth: c.winMonth?.toString() ?? '',
    editWinDate: c.winDate ?? '',
    editWinBidRupees:
      c.winBidDiscountPct != null
        ? ((c.winBidDiscountPct / 100) * (c.chitValue / 100)).toFixed(2)
        : '',
    editWinChequeRupees:
      c.winAmountReceived != null ? (c.winAmountReceived / 100).toString() : '',
    editWinChequeManuallyEdited: false,
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ChitFundDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [chit, setChit] = useState<ChitRecord | null>(null);
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const [showRecordModal, setShowRecordModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const [showWinModal, setShowWinModal] = useState(false);
  const [isWinning, setIsWinning] = useState(false);

  const [isClosing, setIsClosing] = useState(false);

  // Record installment form state
  const [recDueDate, setRecDueDate] = useState('');
  const [recInstallment, setRecInstallment] = useState('0');
  const [recDividend, setRecDividend] = useState('0');
  const [recPaidOn, setRecPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [recMethod, setRecMethod] = useState('NEFT');
  const [recWinnerName, setRecWinnerName] = useState('');
  const [recWinnerBid, setRecWinnerBid] = useState('0');
  const [recNotes, setRecNotes] = useState('');

  // Win form state. Primary input is the bid amount in rupees; cheque is
  // derived (cheque = chitValue − bid − docCharges) but can be overridden if
  // your actual cheque differs from the textbook formula.
  const [winMonth, setWinMonth] = useState('1');
  const [winDate, setWinDate] = useState(new Date().toISOString().slice(0, 10));
  const [winBidRupees, setWinBidRupees] = useState('');
  const [winChequeRupees, setWinChequeRupees] = useState('');
  const [winChequeManuallyEdited, setWinChequeManuallyEdited] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/chit-funds/${id}`);
      if (!r.ok) throw new Error('not found');
      const data = await r.json();
      setChit(data.chitFund);
      setForm(chitToForm(data.chitFund));
      setInstallments(data.installments || []);
      if (data.chitFund) {
        const c = data.chitFund as ChitRecord;
        setRecInstallment((c.monthlyInstallment / 100).toString());
        const nextMonth = (c.installmentsPaid ?? 0) + 1;
        const due = new Date(c.startDate);
        due.setMonth(due.getMonth() + nextMonth);
        setRecDueDate(due.toISOString().slice(0, 10));
        setWinMonth(String(nextMonth));
        // Seed bid at foreman commission (legal minimum). Cheque auto-derives.
        const foremanPct = c.foremanCommissionPct ?? 5;
        const seedBidPaisa = Math.round((foremanPct / 100) * c.chitValue);
        setWinBidRupees((seedBidPaisa / 100).toString());
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to load chit fund');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const recordInstallment = async () => {
    setIsRecording(true);
    try {
      const r = await fetch(`/api/investments/chit-funds/${id}/installments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dueDate: recDueDate,
          installmentPaid: parseFloat(recInstallment),
          dividendReceived: parseFloat(recDividend) || 0,
          paidOn: recPaidOn,
          paymentMethod: recMethod,
          winnerName: recWinnerName || undefined,
          winnerBidDiscountPct: parseFloat(recWinnerBid) || 0,
          notes: recNotes || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'record failed');
      }
      toast.success('Installment recorded');
      setShowRecordModal(false);
      setRecDividend('0');
      setRecWinnerName('');
      setRecWinnerBid('0');
      setRecNotes('');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to record';
      toast.error(msg);
    } finally {
      setIsRecording(false);
    }
  };

  const markAsWon = async () => {
    if (!chit) return;
    const bidRupees = parseFloat(winBidRupees);
    if (!Number.isFinite(bidRupees) || bidRupees < 0) {
      toast.error('Enter a valid bid amount');
      return;
    }
    setIsWinning(true);
    try {
      const payload: Record<string, unknown> = {
        winMonth: Number(winMonth),
        winDate,
        winBidPaisa: Math.round(bidRupees * 100),
      };
      // If user manually edited the cheque, pass it as override.
      if (winChequeManuallyEdited) {
        const chequeRupees = parseFloat(winChequeRupees);
        if (Number.isFinite(chequeRupees) && chequeRupees > 0) {
          payload.winAmountPaisa = Math.round(chequeRupees * 100);
        }
      }
      const r = await fetch(`/api/investments/chit-funds/${id}/win`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'win failed');
      }
      toast.success('Marked as won');
      setShowWinModal(false);
      setWinChequeManuallyEdited(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to mark as won';
      toast.error(msg);
    } finally {
      setIsWinning(false);
    }
  };

  const onSave = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        foremanName: form.foremanName,
        schemeName: form.schemeName,
        registrationNumber: form.registrationNumber || null,
        ticketNumber: form.ticketNumber || null,
        chitValueRupees: Number(form.chitValueRupees) || 0,
        monthlyInstallmentRupees: Number(form.monthlyInstallmentRupees) || 0,
        durationMonths: Number(form.durationMonths) || 0,
        groupSize: Number(form.groupSize) || 0,
        startDate: form.startDate,
        expectedEndDate: form.expectedEndDate,
        foremanCommissionPct: Number(form.foremanCommissionPct) || 5,
        documentChargesRupees: Number(form.documentChargesRupees) || 0,
        nextDueDate: form.nextDueDate || null,
        status: form.status,
        notes: form.notes || null,
      };
      // Send win-detail edits only when status is WON and the bid was entered.
      if (form.status === 'WON') {
        const bidRupees = parseFloat(form.editWinBidRupees);
        if (Number.isFinite(bidRupees) && bidRupees >= 0) {
          body.winBidRupees = bidRupees;
        }
        if (form.editWinChequeManuallyEdited) {
          const chequeRupees = parseFloat(form.editWinChequeRupees);
          if (Number.isFinite(chequeRupees) && chequeRupees > 0) {
            body.winAmountRupees = chequeRupees;
          }
        }
        const wm = parseInt(form.editWinMonth, 10);
        if (Number.isFinite(wm) && wm > 0) body.winMonth = wm;
        if (form.editWinDate) body.winDate = form.editWinDate;
      }
      const r = await fetch(`/api/investments/chit-funds/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Save failed');
      toast.success('Chit fund updated');
      setIsEditing(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (chit) setForm(chitToForm(chit));
    setIsEditing(false);
  };

  const onDelete = async () => {
    if (!confirm('Delete this chit fund and all its installments?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/chit-funds/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Deleted');
      router.push('/investments/chit-funds');
    } catch {
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const closeChit = async () => {
    if (!confirm('Close out this chit fund? Status will be set to COMPLETED.')) return;
    setIsClosing(true);
    try {
      const r = await fetch(`/api/investments/chit-funds/${id}/close`, { method: 'POST' });
      if (!r.ok) throw new Error('close failed');
      toast.success('Chit fund closed');
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to close');
    } finally {
      setIsClosing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  if (!chit) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" onClick={() => router.push('/investments/chit-funds')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Card>
          <CardContent>
            <p className="text-[var(--dxp-text-muted)]">Chit fund not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Running totals for cash flow chart and table
  let cumPaid = 0;
  let cumDividend = 0;
  const chartData = installments.map((i) => {
    cumPaid += i.installmentPaid;
    cumDividend += i.dividendReceived ?? 0;
    return {
      month: `M${i.monthNumber}`,
      cumulativePaid: cumPaid / 100,
      cumulativeReceived: cumDividend / 100,
    };
  });

  // Append winning cash flow to chart if won
  if (chit.status === 'WON' && chit.winAmountReceived && chit.winMonth) {
    chartData.push({
      month: `Win M${chit.winMonth}`,
      cumulativePaid: cumPaid / 100,
      cumulativeReceived: (cumDividend + chit.winAmountReceived) / 100,
    });
  }

  const progressPct =
    chit.durationMonths > 0
      ? Math.min(100, ((chit.installmentsPaid ?? 0) / chit.durationMonths) * 100)
      : 0;

  let runningTotal = 0;
  const instRows = installments.map((i) => {
    runningTotal += i.netOutgo;
    return { ...i, runningTotal };
  });
  type InstRow = (typeof instRows)[number];

  const instColumns: Column<InstRow>[] = [
    {
      key: 'monthNumber',
      header: 'Month',
      render: (_v, r) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">M{r.monthNumber}</span>
      ),
    },
    {
      key: 'paidOn',
      header: 'Paid on',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {new Date(r.paidOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      ),
    },
    {
      key: 'installmentPaid',
      header: 'Paid',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(r.installmentPaid)}</span>
      ),
    },
    {
      key: 'dividendReceived',
      header: 'Dividend',
      render: (_v, r) => (
        <span className="font-mono text-emerald-600">
          {formatINR(r.dividendReceived ?? 0)}
        </span>
      ),
    },
    {
      key: 'netOutgo',
      header: 'Net outgo',
      render: (_v, r) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(r.netOutgo)}
        </span>
      ),
    },
    {
      key: 'runningTotal',
      header: 'Running total',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {formatINR(r.runningTotal)}
        </span>
      ),
    },
    {
      key: 'winnerName',
      header: 'Winner',
      render: (_v, r) =>
        r.winnerName ? (
          <span className="text-xs text-[var(--dxp-text-secondary)]">
            {r.winnerName}
            {r.winnerBidDiscountPct ? ` (${r.winnerBidDiscountPct}%)` : ''}
          </span>
        ) : (
          <span className="text-xs text-[var(--dxp-text-muted)]">—</span>
        ),
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      render: (_v, r) => (
        <Badge variant="default">{r.paymentMethod ?? 'NEFT'}</Badge>
      ),
    },
  ];

  const allInstallmentsPaid = (chit.installmentsPaid ?? 0) >= chit.durationMonths;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/investments/chit-funds')}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-[var(--dxp-brand)]" />
            <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
              {chit.schemeName}
            </h1>
            <Badge variant={statusVariant[chit.status] ?? 'default'}>{chit.status}</Badge>
          </div>
          <p className="text-[var(--dxp-text-secondary)]">
            {chit.foremanName} • Chit value {formatINR(chit.chitValue)} • Foreman commission{' '}
            {chit.foremanCommissionPct ?? 5}%
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isEditing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Button>
              {chit.status === 'ACTIVE' && (
                <Button variant="secondary" size="sm" onClick={() => setShowWinModal(true)}>
                  <Trophy className="mr-2 h-4 w-4" /> Mark as won
                </Button>
              )}
              {allInstallmentsPaid && chit.status !== 'COMPLETED' && (
                <Button variant="secondary" size="sm" onClick={closeChit} disabled={isClosing}>
                  {isClosing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Close chit
                </Button>
              )}
              {chit.status !== 'COMPLETED' && chit.status !== 'WITHDRAWN' && (
                <Button variant="primary" size="sm" onClick={() => setShowRecordModal(true)}>
                  <Zap className="mr-2 h-4 w-4" /> Record installment
                </Button>
              )}
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
          {
            label: 'Installments paid',
            value: chit.installmentsPaid ?? 0,
            format: 'number',
            delta: { value: progressPct, label: `of ${chit.durationMonths}` },
          },
          { label: 'Total paid', value: (chit.totalPaid ?? 0) / 100, format: 'currency' },
          {
            label: 'Dividends received',
            value: (chit.totalDividends ?? 0) / 100,
            format: 'currency',
          },
          {
            label: 'Net contribution',
            value: (chit.netContribution ?? 0) / 100,
            format: 'currency',
          },
        ]}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--dxp-text-muted)]">Winnings received</p>
          <p className="mt-2 text-3xl font-bold text-[var(--dxp-text)]">{formatINR(chit.winAmountReceived ?? 0)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--dxp-text-muted)]">XIRR</p>
          <p className="mt-2 text-3xl font-bold text-[var(--dxp-text)]">
            {chit.xirr == null ? '—' : `${chit.xirr.toFixed(1)}%`}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--dxp-text-muted)]">Next due</p>
          <p className="mt-2 text-3xl font-bold text-[var(--dxp-text)]">{chit.nextDueDate ?? '—'}</p>
        </Card>
      </div>

      <BidAdvisor chit={chit} installments={installments} />
      <PostWinTracker chit={chit} installments={installments} />

      {/* Chit details — view or edit */}
      {isEditing && form ? (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Users className="h-5 w-5 text-[var(--dxp-brand)]" /> Edit chit details
            </h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Foreman name</label>
                <Input value={form.foremanName} onChange={(e) => setField('foremanName', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Scheme name</label>
                <Input value={form.schemeName} onChange={(e) => setField('schemeName', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Ticket / subscriber #</label>
                <Input value={form.ticketNumber} onChange={(e) => setField('ticketNumber', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Registration / Bye Law #</label>
                <Input value={form.registrationNumber} onChange={(e) => setField('registrationNumber', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Chit value (₹)</label>
                <Input type="number" value={form.chitValueRupees} onChange={(e) => setField('chitValueRupees', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Monthly installment (₹)</label>
                <Input type="number" value={form.monthlyInstallmentRupees} onChange={(e) => setField('monthlyInstallmentRupees', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Duration (months)</label>
                <Input type="number" value={form.durationMonths} onChange={(e) => setField('durationMonths', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Group size</label>
                <Input type="number" value={form.groupSize} onChange={(e) => setField('groupSize', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Start date</label>
                <Input type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Expected end date</label>
                <Input type="date" value={form.expectedEndDate} onChange={(e) => setField('expectedEndDate', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Foreman commission (%)</label>
                <Input type="number" value={form.foremanCommissionPct} onChange={(e) => setField('foremanCommissionPct', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Document charges (₹)</label>
                <Input
                  type="number"
                  step="100"
                  min="0"
                  value={form.documentChargesRupees}
                  onChange={(e) => setField('documentChargesRupees', e.target.value)}
                  placeholder="e.g. 15000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Next due date</label>
                <Input type="date" value={form.nextDueDate} onChange={(e) => setField('nextDueDate', e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Status</label>
                <Select value={form.status} onChange={(v) => setField('status', v)} options={STATUS_OPTIONS} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  rows={3}
                  className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                />
              </div>
            </div>

            {/* Win details — visible only when the chit has been won.
                Lets you correct bid/cheque/date entered at win time. */}
            {form.status === 'WON' && (
              <div className="mt-6 border-t border-[var(--dxp-border-light)] pt-4">
                <h4 className="text-sm font-bold text-[var(--dxp-text)] mb-3 flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-emerald-600" />
                  Win details
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Win month</label>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={form.editWinMonth}
                      onChange={(e) => setField('editWinMonth', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Win date</label>
                    <Input
                      type="date"
                      value={form.editWinDate}
                      onChange={(e) => setField('editWinDate', e.target.value)}
                    />
                  </div>
                  <WinAmountFields
                    chit={chit}
                    winBidRupees={form.editWinBidRupees}
                    setWinBidRupees={(v) => setField('editWinBidRupees', v)}
                    winChequeRupees={form.editWinChequeRupees}
                    setWinChequeRupees={(v) => setField('editWinChequeRupees', v)}
                    winChequeManuallyEdited={form.editWinChequeManuallyEdited}
                    setWinChequeManuallyEdited={(v) =>
                      setField('editWinChequeManuallyEdited', v)
                    }
                    formatINR={formatINR}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Progress bar */}
      <Card>
        <CardContent>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-[var(--dxp-text)]">Progress</span>
            <span className="font-mono text-[var(--dxp-text-secondary)]">
              {chit.installmentsPaid ?? 0} / {chit.durationMonths} ({progressPct.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
            <div
              className="h-full bg-[var(--dxp-brand)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Cash flow chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Cash flow</h3>
            <p className="text-xs text-[var(--dxp-text-muted)]">
              Cumulative paid vs cumulative received (dividends + winnings)
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ReLineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="cumulativePaid"
                    stroke="#dc2626"
                    name="Paid"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="cumulativeReceived"
                    stroke="#059669"
                    name="Received"
                    strokeWidth={2}
                  />
                </ReLineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">
            Installment history ({instRows.length})
          </h3>
        </CardHeader>
        <CardContent>
          {instRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--dxp-text-muted)]">
              No installments recorded yet.
            </p>
          ) : (
            <DataTable<InstRow> columns={instColumns} data={instRows} emptyMessage="No installments" />
          )}
        </CardContent>
      </Card>

      {/* Record installment modal */}
      {showRecordModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isRecording && setShowRecordModal(false)}
        >
          <Card className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Record installment — M{(chit.installmentsPaid ?? 0) + 1}
              </h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Enter the actual installment and dividend from your chit fund statement.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Due date
                    </label>
                    <Input
                      type="date"
                      value={recDueDate}
                      onChange={(e) => setRecDueDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Paid on
                    </label>
                    <Input
                      type="date"
                      value={recPaidOn}
                      onChange={(e) => setRecPaidOn(e.target.value)}
                    />
                  </div>
                </div>
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  Monthly installment: <span className="font-mono font-bold">{formatINR(chit.monthlyInstallment)}</span>
                  <span className="text-amber-600 ml-2">(enter amount paid — dividend auto-calculates)</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Amount paid (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={recInstallment}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRecInstallment(val);
                        const installment = chit.monthlyInstallment / 100;
                        const paid = Number(val) || 0;
                        const div = Math.max(0, installment - paid);
                        setRecDividend(div > 0 ? div.toString() : '0');
                      }}
                      placeholder={`e.g. ${(chit.monthlyInstallment / 100) - 2000}`}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Dividend (auto-calculated)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={recDividend}
                      onChange={(e) => setRecDividend(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                      = {formatINR(chit.monthlyInstallment)} − ₹{Number(recInstallment || 0).toLocaleString('en-IN')} paid
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Payment method
                    </label>
                    <Select
                      options={[
                        { value: 'NEFT', label: 'NEFT' },
                        { value: 'UPI', label: 'UPI' },
                        { value: 'CASH', label: 'Cash' },
                        { value: 'CHEQUE', label: 'Cheque' },
                        { value: 'CARD', label: 'Card' },
                      ]}
                      value={recMethod}
                      onChange={(v) => setRecMethod(v)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Winner bid %
                    </label>
                    <Input
                      type="number"
                      step="0.1"
                      value={recWinnerBid}
                      onChange={(e) => setRecWinnerBid(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Winner name (optional)
                  </label>
                  <Input
                    value={recWinnerName}
                    onChange={(e) => setRecWinnerName(e.target.value)}
                    placeholder="Who won this month"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Notes
                  </label>
                  <Input
                    value={recNotes}
                    onChange={(e) => setRecNotes(e.target.value)}
                    placeholder="Any notes"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowRecordModal(false)}
                    disabled={isRecording}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={recordInstallment} disabled={isRecording}>
                    {isRecording && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mark as won modal */}
      {showWinModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isWinning && setShowWinModal(false)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Mark chit as won</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Records the auction win and computes net amount after foreman commission.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Win month
                  </label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={winMonth}
                    onChange={(e) => setWinMonth(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Win date
                  </label>
                  <Input
                    type="date"
                    value={winDate}
                    onChange={(e) => setWinDate(e.target.value)}
                  />
                </div>
                <WinAmountFields
                  chit={chit}
                  winBidRupees={winBidRupees}
                  setWinBidRupees={setWinBidRupees}
                  winChequeRupees={winChequeRupees}
                  setWinChequeRupees={setWinChequeRupees}
                  winChequeManuallyEdited={winChequeManuallyEdited}
                  setWinChequeManuallyEdited={setWinChequeManuallyEdited}
                  formatINR={formatINR}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowWinModal(false)}
                    disabled={isWinning}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={markAsWon} disabled={isWinning}>
                    {isWinning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

interface WinAmountFieldsProps {
  chit: ChitRecord;
  winBidRupees: string;
  setWinBidRupees: (v: string) => void;
  winChequeRupees: string;
  setWinChequeRupees: (v: string) => void;
  winChequeManuallyEdited: boolean;
  setWinChequeManuallyEdited: (v: boolean) => void;
  formatINR: (paisa: number) => string;
}

function WinAmountFields({
  chit,
  winBidRupees,
  setWinBidRupees,
  winChequeRupees,
  setWinChequeRupees,
  winChequeManuallyEdited,
  setWinChequeManuallyEdited,
  formatINR,
}: WinAmountFieldsProps) {
  const bidRupees = parseFloat(winBidRupees) || 0;
  const bidPaisa = Math.round(bidRupees * 100);
  const docPaisa = chit.documentChargesPaisa ?? 0;
  const foremanPct = chit.foremanCommissionPct ?? 5;
  const foremanPaisa = Math.round((foremanPct / 100) * chit.chitValue);
  const derivedChequePaisa = Math.max(0, chit.chitValue - bidPaisa - docPaisa);
  const bidPct = chit.chitValue > 0 ? (bidPaisa / chit.chitValue) * 100 : 0;
  const distributable = bidPaisa - foremanPaisa;
  const perMember = chit.groupSize > 0 ? Math.round(distributable / chit.groupSize) : 0;

  // Keep cheque in sync with bid while user hasn't manually overridden it.
  useEffect(() => {
    if (winChequeManuallyEdited) return;
    if (bidPaisa <= 0) return;
    const expected = (derivedChequePaisa / 100).toFixed(2);
    if (winChequeRupees !== expected) setWinChequeRupees(expected);
  }, [bidPaisa, derivedChequePaisa, winChequeManuallyEdited, winChequeRupees, setWinChequeRupees]);

  return (
    <>
      <div>
        <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
          Bid amount (₹)
        </label>
        <Input
          type="number"
          step="100"
          min="0"
          value={winBidRupees}
          onChange={(e) => {
            setWinBidRupees(e.target.value);
            setWinChequeManuallyEdited(false);
          }}
          placeholder={`min: ₹${(foremanPaisa / 100).toLocaleString('en-IN')} (foreman ${foremanPct}%)`}
        />
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          = {bidPct.toFixed(2)}% of chit value · Foreman keeps {formatINR(foremanPaisa)} ·
          Distributable {formatINR(Math.max(0, distributable))}
          {chit.groupSize > 0 && distributable > 0 && <> ({formatINR(perMember)}/member)</>}
        </p>
      </div>
      <div>
        <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
          Cheque received (₹){' '}
          {!winChequeManuallyEdited && (
            <span className="text-xs font-normal text-[var(--dxp-text-muted)]">
              auto: V − bid − doc
            </span>
          )}
        </label>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={winChequeRupees}
          onChange={(e) => {
            setWinChequeRupees(e.target.value);
            setWinChequeManuallyEdited(true);
          }}
        />
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          {formatINR(chit.chitValue)} − {formatINR(bidPaisa)} bid − {formatINR(docPaisa)} doc ={' '}
          {formatINR(derivedChequePaisa)}
          {winChequeManuallyEdited && (
            <button
              onClick={() => {
                setWinChequeRupees((derivedChequePaisa / 100).toFixed(2));
                setWinChequeManuallyEdited(false);
              }}
              className="ml-2 text-blue-600 hover:underline"
            >
              reset to formula
            </button>
          )}
        </p>
      </div>
    </>
  );
}
