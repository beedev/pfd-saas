'use client';

/**
 * Goal detail — four stacked sections:
 *   1. Goal details (inline Edit/Save/Cancel; SWP fields appear only
 *      when disbursement_type !== LUMPSUM)
 *   2. Asset mapping (per-class + per-item toggles, sum of mapped)
 *   3. Earmarked inflows (cashflow events with goal_id = this goal)
 *   4. Funding projection (year-by-year chart + summary text)
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

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
  Target,
  Trash2,
  Pencil,
  Save,
  X,
  Wallet,
  Calendar,
  TrendingUp,
  Link2,
} from 'lucide-react';

type GoalType =
  | 'HOUSE' | 'CAR' | 'EDUCATION' | 'TRAVEL'
  | 'EMERGENCY' | 'WEDDING' | 'BUSINESS' | 'OTHER';
type DisbursementType = 'LUMPSUM' | 'FIXED_PERIOD_SWP' | 'INFLATION_SWP';

interface Goal {
  id: number;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  currentAmount: number;
  color: string | null;
  isActive: boolean;
  goalType: GoalType;
  disbursementType: DisbursementType;
  disbursementAmountPerYrPaisa: number | null;
  disbursementYears: number | null;
  disbursementStartDate: string | null;
  growthPctPerYr: number;
  expectedReturnPct: number;
  inflationPct: number;
}

interface OtherAllocation {
  goalId: number;
  goalName: string;
  allocationPct: number;
}
interface AggregateAsset {
  kind: 'aggregate';
  assetClass: string;
  label: string;
  valuePaisa: number;
  liquidity: 'liquid' | 'semi-liquid' | 'locked';
  included: boolean;
  allocationPct: number;
  otherAllocations: OtherAllocation[];
  basis?: string;
}
interface ItemizedAsset {
  kind: 'itemized';
  assetClass: string;
  label: string;
  liquidity: 'liquid' | 'semi-liquid' | 'locked';
  basis?: string;
  items: Array<{
    id: number;
    label: string;
    sublabel?: string;
    maturityDate: string | null;
    valuePaisa: number;
    included: boolean;
    allocationPct: number;
    otherAllocations: OtherAllocation[];
  }>;
  includedSumPaisa: number;
}
type AssetRow = AggregateAsset | ItemizedAsset;

interface CashflowEvent {
  id: number;
  name: string;
  sourceKind: string;
  startDate: string;
  endDate: string | null;
  amountPaisa: number;
  frequency: 'ONE_TIME' | 'MONTHLY' | 'YEARLY';
  growthPctPerYear: number;
  goalId: number | null;
}

interface ProjectionYear {
  year: number;
  openingCorpus: number;
  growth: number;
  inflows: number;
  demand: number;
  closingCorpus: number;
  shortfall: number;
}
interface Projection {
  goalId: number;
  goalName: string;
  horizonYears: number;
  fundedAtTargetDate: boolean;
  totalDemandPaisa: number;
  totalInflowsPaisa: number;
  yearByYear: ProjectionYear[];
  monthlyContributionRequiredPaisa: number | null;
}

const GOAL_TYPE_OPTIONS: Array<{ label: string; value: GoalType }> = [
  { label: 'House', value: 'HOUSE' },
  { label: 'Car', value: 'CAR' },
  { label: 'Education', value: 'EDUCATION' },
  { label: 'Travel', value: 'TRAVEL' },
  { label: 'Emergency', value: 'EMERGENCY' },
  { label: 'Wedding', value: 'WEDDING' },
  { label: 'Business', value: 'BUSINESS' },
  { label: 'Other', value: 'OTHER' },
];

const DISBURSEMENT_OPTIONS: Array<{ label: string; value: DisbursementType }> = [
  { label: 'Lumpsum', value: 'LUMPSUM' },
  { label: 'Fixed-period SWP', value: 'FIXED_PERIOD_SWP' },
  { label: 'Inflation-linked SWP', value: 'INFLATION_SWP' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatINRCompact = (paisa: number) => {
  const rupees = paisa / 100;
  if (Math.abs(rupees) >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)}Cr`;
  if (Math.abs(rupees) >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)}L`;
  if (Math.abs(rupees) >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${Math.round(rupees)}`;
};

interface FormState {
  name: string;
  targetAmountRupees: string;
  targetDate: string;
  goalType: GoalType;
  disbursementType: DisbursementType;
  disbursementAmountPerYrRupees: string;
  disbursementYears: string;
  disbursementStartDate: string;
  growthPctPerYr: string;
  expectedReturnPct: string;
  inflationPct: string;
  color: string;
}

function goalToForm(g: Goal): FormState {
  return {
    name: g.name,
    targetAmountRupees: (g.targetAmount / 100).toString(),
    targetDate: g.targetDate ?? '',
    goalType: g.goalType,
    disbursementType: g.disbursementType,
    disbursementAmountPerYrRupees:
      g.disbursementAmountPerYrPaisa != null
        ? (g.disbursementAmountPerYrPaisa / 100).toString()
        : '',
    disbursementYears: g.disbursementYears != null ? g.disbursementYears.toString() : '',
    disbursementStartDate: g.disbursementStartDate ?? '',
    growthPctPerYr: g.growthPctPerYr.toString(),
    expectedReturnPct: g.expectedReturnPct.toString(),
    inflationPct: g.inflationPct.toString(),
    color: g.color ?? '#4CAF50',
  };
}

export default function GoalDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const goalId = params.id;

  const [goal, setGoal] = useState<Goal | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [mappedTotal, setMappedTotal] = useState(0);
  const [events, setEvents] = useState<CashflowEvent[]>([]);
  const [projection, setProjection] = useState<Projection | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  // Modal: pick from unassigned cashflow events to earmark
  const [earmarkModalOpen, setEarmarkModalOpen] = useState(false);
  const [allEvents, setAllEvents] = useState<CashflowEvent[]>([]);
  const [isEarmarking, setIsEarmarking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detailRes, assetsRes, projRes, allEvtRes] = await Promise.all([
        fetch(`/api/finance/goals/${goalId}`).then((r) => r.json()),
        fetch(`/api/finance/goals/${goalId}/assets`).then((r) => r.json()),
        fetch(`/api/finance/goals/${goalId}/projection`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch('/api/cashflow-events').then((r) => r.json()),
      ]);
      if (detailRes.error) throw new Error(detailRes.error);
      setGoal(detailRes.goal);
      setEvents(detailRes.earmarkedEvents || []);
      setForm(goalToForm(detailRes.goal));
      setAssets(assetsRes.classes || []);
      setMappedTotal(assetsRes.includedTotalPaisa || 0);
      setProjection(projRes?.projection ?? null);
      setAllEvents(allEvtRes.events || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load goal');
    } finally {
      setIsLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      const targetPaisa = Math.round((parseFloat(form.targetAmountRupees) || 0) * 100);
      const isSWP = form.disbursementType !== 'LUMPSUM';
      const body: Record<string, unknown> = {
        name: form.name,
        targetAmount: targetPaisa,
        targetDate: form.targetDate || null,
        color: form.color,
        goalType: form.goalType,
        disbursementType: form.disbursementType,
        disbursementAmountPerYrPaisa: isSWP
          ? Math.round((parseFloat(form.disbursementAmountPerYrRupees) || 0) * 100)
          : null,
        disbursementYears: isSWP ? Number(form.disbursementYears) || null : null,
        disbursementStartDate: isSWP ? form.disbursementStartDate || null : null,
        growthPctPerYr: parseFloat(form.growthPctPerYr) || 0,
        expectedReturnPct: parseFloat(form.expectedReturnPct) || 8,
        inflationPct: parseFloat(form.inflationPct) || 6,
      };
      const r = await fetch(`/api/finance/goals/${goalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setGoal(data.goal);
      setForm(goalToForm(data.goal));
      setIsEditing(false);
      toast.success('Goal updated');
      // Refresh projection — assumptions may have changed.
      const projRes = await fetch(`/api/finance/goals/${goalId}/projection`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      setProjection(projRes?.projection ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (goal) setForm(goalToForm(goal));
    setIsEditing(false);
  };

  const onDelete = async () => {
    if (!confirm('Delete this goal? Asset mappings remain so you can reactivate later.')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/finance/goals/${goalId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Goal removed');
      router.push('/goals');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const updateAsset = async (
    assetClass: string,
    sourceId: number | null,
    next: boolean,
    allocationPct?: number,
  ) => {
    try {
      const body: Record<string, unknown> = {
        assetClass,
        sourceId,
        included: next,
      };
      if (allocationPct !== undefined) body.allocationPct = allocationPct;
      const r = await fetch(`/api/finance/goals/${goalId}/assets`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(data?.error || 'Update failed');
        return false;
      }
      // Reload to recompute mapped total + projection
      const [assetsRes, projRes] = await Promise.all([
        fetch(`/api/finance/goals/${goalId}/assets`).then((r) => r.json()),
        fetch(`/api/finance/goals/${goalId}/projection`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      setAssets(assetsRes.classes || []);
      setMappedTotal(assetsRes.includedTotalPaisa || 0);
      setProjection(projRes?.projection ?? null);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
      return false;
    }
  };

  const earmarkEvent = async (eventId: number, attach: boolean) => {
    setIsEarmarking(true);
    try {
      const r = await fetch(`/api/cashflow-events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId: attach ? Number(goalId) : null }),
      });
      if (!r.ok) throw new Error('earmark failed');
      toast.success(attach ? 'Event earmarked' : 'Event unlinked');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsEarmarking(false);
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
  if (!goal || !form) return <p>Not found</p>;

  const isSWP = form.disbursementType !== 'LUMPSUM';
  const fundedPct =
    goal.targetAmount > 0
      ? Math.min(100, Math.round((mappedTotal / goal.targetAmount) * 100))
      : 0;

  // Build chart series from projection
  const chartData =
    projection?.yearByYear.map((y) => ({
      year: y.year,
      corpus: y.closingCorpus / 100,
      demand: y.demand / 100,
      shortfall: y.shortfall / 100,
    })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/goals"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to goals
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {goal.name}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {goal.goalType} · {goal.disbursementType.replace(/_/g, ' ').toLowerCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{goal.goalType}</Badge>
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
          { label: 'Target', value: goal.targetAmount / 100, format: 'currency' },
          { label: 'Mapped corpus', value: mappedTotal / 100, format: 'currency' },
          { label: 'Funded', value: fundedPct, format: 'number' },
          {
            label: 'Required/mo',
            value:
              projection?.monthlyContributionRequiredPaisa != null
                ? projection.monthlyContributionRequiredPaisa / 100
                : 0,
            format: 'currency',
          },
        ]}
      />

      {/* ── Section 1: Goal details ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Target className="h-5 w-5 text-[var(--dxp-brand)]" />
            Goal details
          </h3>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <Detail
              label="Name"
              value={goal.name}
              isEditing={isEditing}
              editor={
                <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
              }
            />
            <Detail
              label="Type"
              value={goal.goalType}
              isEditing={isEditing}
              editor={
                <Select
                  value={form.goalType}
                  onChange={(v) => setField('goalType', v as GoalType)}
                  options={GOAL_TYPE_OPTIONS}
                />
              }
            />
            <Detail
              label="Target date"
              value={goal.targetDate ?? '—'}
              isEditing={isEditing}
              editor={
                <Input
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setField('targetDate', e.target.value)}
                />
              }
            />
            <Detail
              label="Disbursement"
              value={goal.disbursementType.replace(/_/g, ' ').toLowerCase()}
              isEditing={isEditing}
              editor={
                <Select
                  value={form.disbursementType}
                  onChange={(v) => setField('disbursementType', v as DisbursementType)}
                  options={DISBURSEMENT_OPTIONS}
                />
              }
            />
            <Detail
              label={isSWP ? 'Per-year withdrawal' : 'Target amount'}
              value={
                isSWP && goal.disbursementAmountPerYrPaisa != null
                  ? formatINR(goal.disbursementAmountPerYrPaisa)
                  : formatINR(goal.targetAmount)
              }
              isEditing={isEditing}
              editor={
                isSWP ? (
                  <Input
                    type="number"
                    step="0.01"
                    value={form.disbursementAmountPerYrRupees}
                    onChange={(e) => setField('disbursementAmountPerYrRupees', e.target.value)}
                  />
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    value={form.targetAmountRupees}
                    onChange={(e) => setField('targetAmountRupees', e.target.value)}
                  />
                )
              }
            />
            {isSWP && (
              <>
                <Detail
                  label="Disbursement years"
                  value={goal.disbursementYears?.toString() ?? '—'}
                  isEditing={isEditing}
                  editor={
                    <Input
                      type="number"
                      step="1"
                      value={form.disbursementYears}
                      onChange={(e) => setField('disbursementYears', e.target.value)}
                    />
                  }
                />
                <Detail
                  label="SWP start"
                  value={goal.disbursementStartDate ?? '—'}
                  isEditing={isEditing}
                  editor={
                    <Input
                      type="date"
                      value={form.disbursementStartDate}
                      onChange={(e) => setField('disbursementStartDate', e.target.value)}
                    />
                  }
                />
              </>
            )}
            <Detail
              label="Growth %/yr"
              value={`${goal.growthPctPerYr}%`}
              isEditing={isEditing}
              editor={
                <Input
                  type="number"
                  step="0.01"
                  value={form.growthPctPerYr}
                  onChange={(e) => setField('growthPctPerYr', e.target.value)}
                />
              }
            />
            <Detail
              label="Expected return %"
              value={`${goal.expectedReturnPct}%`}
              isEditing={isEditing}
              editor={
                <Input
                  type="number"
                  step="0.01"
                  value={form.expectedReturnPct}
                  onChange={(e) => setField('expectedReturnPct', e.target.value)}
                />
              }
            />
            <Detail
              label="Inflation %"
              value={`${goal.inflationPct}%`}
              isEditing={isEditing}
              editor={
                <Input
                  type="number"
                  step="0.01"
                  value={form.inflationPct}
                  onChange={(e) => setField('inflationPct', e.target.value)}
                />
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Asset mapping ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Wallet className="h-5 w-5 text-[var(--dxp-brand)]" />
              Asset mapping
            </h3>
            <span className="text-sm text-[var(--dxp-text-secondary)]">
              {formatINRCompact(mappedTotal)} currently mapped
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {assets.map((row) => (
              <AssetRowCard
                key={row.assetClass}
                row={row}
                onUpdate={(sourceId, next, allocationPct) =>
                  updateAsset(row.assetClass, sourceId, next, allocationPct)
                }
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Section 3: Earmarked inflows ─────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Calendar className="h-5 w-5 text-[var(--dxp-brand)]" />
              Earmarked inflows
            </h3>
            <Button variant="secondary" size="sm" onClick={() => setEarmarkModalOpen(true)}>
              <Link2 className="mr-2 h-4 w-4" /> Earmark a cashflow event
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--dxp-text-muted)] py-4 text-center">
              No cashflow events are earmarked to this goal yet.
            </p>
          ) : (
            <DataTable<CashflowEvent>
              data={events}
              emptyMessage="No events"
              columns={[
                { key: 'name', header: 'Event', render: (_v, ev) => ev.name },
                {
                  key: 'sourceKind',
                  header: 'Source',
                  render: (_v, ev) => (
                    <span className="text-xs text-[var(--dxp-text-secondary)]">
                      {ev.sourceKind.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  ),
                },
                {
                  key: 'startDate',
                  header: 'Date',
                  render: (_v, ev) => (
                    <span className="text-xs text-[var(--dxp-text-secondary)]">{ev.startDate}</span>
                  ),
                },
                {
                  key: 'frequency',
                  header: 'Frequency',
                  render: (_v, ev) => <Badge variant="info">{ev.frequency}</Badge>,
                },
                {
                  key: 'amountPaisa',
                  header: 'Amount',
                  render: (_v, ev) => (
                    <span className="font-mono">{formatINR(ev.amountPaisa)}</span>
                  ),
                },
                {
                  key: 'id',
                  header: '',
                  render: (_v, ev) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => earmarkEvent(ev.id, false)}
                      disabled={isEarmarking}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Section 4: Funding projection ────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <TrendingUp className="h-5 w-5 text-[var(--dxp-brand)]" />
            Funding projection
          </h3>
        </CardHeader>
        <CardContent>
          {!projection || chartData.length === 0 ? (
            <p className="text-sm text-[var(--dxp-text-muted)] py-6 text-center">
              No projection available — add a target date and map at least one asset.
            </p>
          ) : (
            <>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--dxp-border)" />
                    <XAxis dataKey="year" stroke="var(--dxp-text-secondary)" />
                    <YAxis
                      stroke="var(--dxp-text-secondary)"
                      tickFormatter={(v: number) => {
                        if (Math.abs(v) >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(1)}Cr`;
                        if (Math.abs(v) >= 1_00_000) return `${(v / 1_00_000).toFixed(1)}L`;
                        return v.toString();
                      }}
                    />
                    <Tooltip
                      formatter={(v) =>
                        typeof v === 'number'
                          ? `₹${v.toLocaleString('en-IN')}`
                          : String(v)
                      }
                      contentStyle={{
                        backgroundColor: 'var(--dxp-surface)',
                        border: '1px solid var(--dxp-border)',
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="corpus"
                      name="Projected corpus"
                      stroke="var(--dxp-brand)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="demand"
                      name="Goal demand"
                      stroke="#f59e0b"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="shortfall"
                      name="Shortfall"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 space-y-1 text-sm">
                <p className="text-[var(--dxp-text)]">
                  Status:{' '}
                  {projection.fundedAtTargetDate ? (
                    <Badge variant="success">Fully funded</Badge>
                  ) : (
                    <Badge variant="warning">Shortfall present</Badge>
                  )}
                </p>
                <p className="text-[var(--dxp-text-secondary)]">
                  Horizon: <strong>{projection.horizonYears} years</strong> · Total demand:{' '}
                  <strong>{formatINRCompact(projection.totalDemandPaisa)}</strong> · Total inflows:{' '}
                  <strong>{formatINRCompact(projection.totalInflowsPaisa)}</strong>
                </p>
                {projection.monthlyContributionRequiredPaisa != null &&
                  projection.monthlyContributionRequiredPaisa > 0 && (
                    <p className="text-[var(--dxp-text)]">
                      Monthly contribution required from today:{' '}
                      <strong className="text-[var(--dxp-brand)]">
                        {formatINR(projection.monthlyContributionRequiredPaisa)}
                      </strong>{' '}
                      to fully fund.
                    </p>
                  )}
                {projection.fundedAtTargetDate && (
                  <p className="text-[var(--dxp-text)]">
                    No additional monthly contribution needed — current corpus + inflows cover it.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Earmark modal ────────────────────────────────────────── */}
      {earmarkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !isEarmarking && setEarmarkModalOpen(false)}
        >
          <Card
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Earmark cashflow events
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEarmarkModalOpen(false)}
                  disabled={isEarmarking}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Pick events whose inflows should count toward this goal.
              </p>
            </CardHeader>
            <CardContent>
              {allEvents.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-muted)] py-6 text-center">
                  No cashflow events exist yet. Add one in Planning → Cashflows first.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--dxp-border)]">
                  {allEvents.map((ev) => {
                    const isThis = ev.goalId === Number(goalId);
                    const isOther = ev.goalId !== null && !isThis;
                    return (
                      <li
                        key={ev.id}
                        className="flex items-center justify-between py-2 gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[var(--dxp-text)] truncate">
                            {ev.name}
                          </p>
                          <p className="text-xs text-[var(--dxp-text-secondary)]">
                            {ev.sourceKind.replace(/_/g, ' ').toLowerCase()} · {ev.startDate} ·{' '}
                            {formatINR(ev.amountPaisa)} {ev.frequency}
                          </p>
                          {isOther && (
                            <p className="text-xs text-amber-600">
                              Currently earmarked to a different goal
                            </p>
                          )}
                        </div>
                        <Button
                          variant={isThis ? 'danger' : 'primary'}
                          size="sm"
                          onClick={() => earmarkEvent(ev.id, !isThis)}
                          disabled={isEarmarking}
                        >
                          {isThis ? 'Unlink' : 'Earmark'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Helpers                                                              */
/* ──────────────────────────────────────────────────────────────────── */

function Detail({
  label,
  value,
  isEditing,
  editor,
}: {
  label: string;
  value: string;
  isEditing: boolean;
  editor: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--dxp-text-muted)] uppercase tracking-wide">
        {label}
      </p>
      {isEditing ? (
        <div className="mt-1">{editor}</div>
      ) : (
        <p className="text-sm font-mono text-[var(--dxp-text)] mt-1">{value}</p>
      )}
    </div>
  );
}

function AssetRowCard({
  row,
  onUpdate,
}: {
  row: AssetRow;
  onUpdate: (
    sourceId: number | null,
    next: boolean,
    allocationPct?: number,
  ) => Promise<boolean> | void;
}) {
  if (row.kind === 'aggregate') {
    return (
      <div className="rounded-md border border-[var(--dxp-border)] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--dxp-text)]">{row.label}</p>
            <p className="text-xs text-[var(--dxp-text-secondary)]">
              {formatINRCompact(row.valuePaisa)} · {row.liquidity}
              {row.basis ? ` · ${row.basis}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
            {row.included && (
              <AllocationInput
                allocationPct={row.allocationPct}
                otherAllocations={row.otherAllocations}
                valuePaisa={row.valuePaisa}
                onCommit={(pct) => onUpdate(null, true, pct)}
              />
            )}
            <input
              type="checkbox"
              checked={row.included}
              onChange={(e) => onUpdate(null, e.target.checked)}
              className="h-5 w-5 cursor-pointer accent-[var(--dxp-brand)]"
            />
          </div>
        </div>
      </div>
    );
  }

  // itemized — render items as a sub-list
  const columns: Column<typeof row.items[number]>[] = [
    {
      key: 'label',
      header: 'Item',
      render: (_v, it) => (
        <div>
          <p className="text-sm font-semibold text-[var(--dxp-text)]">{it.label}</p>
          {it.sublabel && (
            <p className="text-xs text-[var(--dxp-text-muted)]">{it.sublabel}</p>
          )}
        </div>
      ),
    },
    {
      key: 'maturityDate',
      header: 'Maturity',
      render: (_v, it) => (
        <span className="text-xs text-[var(--dxp-text-secondary)]">{it.maturityDate ?? '—'}</span>
      ),
    },
    {
      key: 'valuePaisa',
      header: 'Value',
      render: (_v, it) => (
        <span className="font-mono text-sm text-[var(--dxp-text)]">
          {formatINRCompact(it.valuePaisa)}
        </span>
      ),
    },
    {
      key: 'allocationPct',
      header: 'Allocation',
      render: (_v, it) =>
        it.included ? (
          <AllocationInput
            allocationPct={it.allocationPct}
            otherAllocations={it.otherAllocations}
            valuePaisa={it.valuePaisa}
            onCommit={(pct) => onUpdate(it.id, true, pct)}
          />
        ) : (
          <span className="text-xs text-[var(--dxp-text-muted)]">—</span>
        ),
    },
    {
      key: 'included',
      header: 'Include',
      render: (_v, it) => (
        <input
          type="checkbox"
          checked={it.included}
          onChange={(e) => onUpdate(it.id, e.target.checked)}
          className="h-5 w-5 cursor-pointer accent-[var(--dxp-brand)]"
        />
      ),
    },
  ];

  return (
    <div className="rounded-md border border-[var(--dxp-border)] p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-semibold text-[var(--dxp-text)]">{row.label}</p>
          <p className="text-xs text-[var(--dxp-text-secondary)]">
            {row.liquidity} · {formatINRCompact(row.includedSumPaisa)} mapped
            {row.basis ? ` · ${row.basis}` : ''}
          </p>
        </div>
      </div>
      {row.items.length === 0 ? (
        <p className="text-xs text-[var(--dxp-text-muted)] py-2">No items in this class</p>
      ) : (
        <DataTable data={row.items} columns={columns} emptyMessage="No items" />
      )}
    </div>
  );
}

/**
 * Inline percentage input with claimed-by subtitle. Commits on blur or
 * Enter. Shows inline validation if the combined allocation would
 * exceed 100%, but does NOT auto-clamp — leaves the choice to the user.
 */
function AllocationInput({
  allocationPct,
  otherAllocations,
  valuePaisa,
  onCommit,
}: {
  allocationPct: number;
  otherAllocations: OtherAllocation[];
  valuePaisa: number;
  onCommit: (pct: number) => Promise<boolean> | void;
}) {
  const [value, setValue] = useState<string>(String(allocationPct));
  const [error, setError] = useState<string | null>(null);

  // Reset local state when server-side value changes
  useEffect(() => {
    setValue(String(allocationPct));
    setError(null);
  }, [allocationPct]);

  const otherSum = otherAllocations.reduce((s, o) => s + o.allocationPct, 0);
  const earmarkedPaisa = Math.round((valuePaisa * allocationPct) / 100);
  const unallocated = Math.max(0, 100 - allocationPct - otherSum);

  const commit = () => {
    const pct = parseFloat(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setError('Must be 0–100');
      return;
    }
    if (otherSum + pct > 100 + 0.001) {
      const over = otherSum + pct - 100;
      setError(`Total across goals would be ${otherSum + pct}% — reduce by ${over}%.`);
      return;
    }
    if (pct === allocationPct) return; // no-op
    setError(null);
    void onCommit(pct);
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
          className="w-20"
        />
        <span className="text-xs text-[var(--dxp-text-secondary)]">%</span>
      </div>
      <p className="text-xs text-[var(--dxp-text-secondary)]">
        {formatINRCompact(earmarkedPaisa)} earmarked here
      </p>
      {otherAllocations.length > 0 && (
        <p className="text-xs text-[var(--dxp-text-muted)]">
          Also:{' '}
          {otherAllocations
            .map((o) => `${o.allocationPct}% to ${o.goalName}`)
            .join(', ')}
          {unallocated > 0 ? ` · ${unallocated}% unallocated` : ''}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
