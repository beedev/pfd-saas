'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
} from '@dxp/ui';
import Link from 'next/link';
import {
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
  Check,
  Loader2,
  Sparkles,
  X,
  Type,
  SquareCheckBig,
  Flame,
  History as HistoryIcon,
} from 'lucide-react';

interface Item {
  id: number;
  sectionId: number;
  label: string;
  sortOrder: number;
  kind: 'check' | 'text' | 'multi';
  // Only for kind='multi': the tickable sub-option labels.
  options?: string[];
}

// A multi-item's per-day value: which sub-options were ticked + an optional
// free-text note (e.g. weights/gym detail). Stored as JSON in the day's
// textValue column, so it rides on the existing checks/texts plumbing.
interface MultiValue {
  selected: string[];
  note: string;
}

function parseMultiValue(raw: string | undefined): MultiValue {
  if (!raw) return { selected: [], note: '' };
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) {
      // Legacy/simple form: a bare array of selected options.
      return { selected: v.filter((x) => typeof x === 'string'), note: '' };
    }
    return {
      selected: Array.isArray(v?.selected)
        ? v.selected.filter((x: unknown) => typeof x === 'string')
        : [],
      note: typeof v?.note === 'string' ? v.note : '',
    };
  } catch {
    return { selected: [], note: '' };
  }
}
interface Section {
  id: number;
  planId: number;
  name: string;
  sortOrder: number;
  items: Item[];
}
interface Plan {
  id: number;
  name: string;
  startDate: string;
  dayCount: number;
  startWeightKg: number | null;
  goalWeightKg: number | null;
  dailyCalorieTarget: number | null;
  dailyProteinTargetG: number | null;
  notes: string | null;
}
interface DayData {
  planId?: number;
  date: string;
  dayNumber: number;
  currentWeightKg: number | null;
  journal: string | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function TransformationPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [date, setDate] = useState<string>(todayIso());

  // Allow ?date=YYYY-MM-DD in the URL to deep-link to a specific day (used
  // by the history page heatmap + daily-entries list). Read client-side
  // after mount to avoid Next.js prerender issues with useSearchParams.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('date');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDate(q);
  }, []);
  const [day, setDay] = useState<DayData | null>(null);
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const [texts, setTexts] = useState<Record<number, string>>({});
  // Per-item nutrition estimates for the loaded day.
  const [nutrition, setNutrition] = useState<
    Record<number, { calories: number; proteinG: number }>
  >({});
  // Items currently being estimated (shows a spinner next to the badge).
  const [estimating, setEstimating] = useState<Record<number, boolean>>({});
  const [weight, setWeight] = useState<string>('');
  const [journal, setJournal] = useState<string>('');
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Edit-mode buffer for plan-level fields. Populated when plan loads or
  // when entering edit mode; flushed to the API via savePlan().
  const [planForm, setPlanForm] = useState<{
    name: string;
    startDate: string;
    dayCount: string;
    startWeightKg: string;
    goalWeightKg: string;
    dailyCalorieTarget: string;
    dailyProteinTargetG: string;
  } | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  const loadPlan = useCallback(async () => {
    const r = await fetch('/api/health/transformation/plan');
    const j = await r.json();
    if (j.plan) {
      setPlan(j.plan);
      setPlanForm({
        name: j.plan.name ?? '',
        startDate: j.plan.startDate ?? '',
        dayCount: String(j.plan.dayCount ?? 100),
        startWeightKg: j.plan.startWeightKg != null ? String(j.plan.startWeightKg) : '',
        goalWeightKg: j.plan.goalWeightKg != null ? String(j.plan.goalWeightKg) : '',
        dailyCalorieTarget:
          j.plan.dailyCalorieTarget != null ? String(j.plan.dailyCalorieTarget) : '',
        dailyProteinTargetG:
          j.plan.dailyProteinTargetG != null ? String(j.plan.dailyProteinTargetG) : '',
      });
    }
    // The API stores multi-item options as a JSON string; parse to string[].
    const parsed: Section[] = (j.sections ?? []).map((s: Section) => ({
      ...s,
      items: (s.items ?? []).map((it: Item & { options?: unknown }) => ({
        ...it,
        options:
          typeof it.options === 'string'
            ? (() => {
                try {
                  const arr = JSON.parse(it.options as string);
                  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
                } catch {
                  return [];
                }
              })()
            : Array.isArray(it.options)
              ? it.options
              : undefined,
      })),
    }));
    setSections(parsed);
  }, []);

  const loadDay = useCallback(async (d: string) => {
    const r = await fetch(`/api/health/transformation/days/${d}`);
    if (!r.ok) {
      toast.error('Failed to load day');
      return;
    }
    const j = await r.json();
    setDay(j.day);
    setChecks(j.checks ?? {});
    setTexts(j.texts ?? {});
    setNutrition(j.nutrition ?? {});
    setWeight(
      j.day?.currentWeightKg != null ? String(j.day.currentWeightKg) : '',
    );
    setJournal(j.day?.journal ?? '');
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadPlan();
      await loadDay(date);
      setLoading(false);
    })();
  }, [loadPlan, loadDay, date]);

  // Progress counts only check-kind items. Text items don't have a binary
  // "done" — they're free-form entries — so excluding them keeps the % honest.
  const checkItems = useMemo(
    () => sections.flatMap((s) => s.items.filter((i) => i.kind !== 'text')),
    [sections],
  );
  const totalItems = checkItems.length;
  const doneItems = useMemo(
    () => checkItems.filter((i) => checks[i.id]).length,
    [checkItems, checks],
  );
  const progressPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  // Daily totals — sum across all text-kind items on the day.
  const totalCalories = useMemo(
    () => Object.values(nutrition).reduce((s, n) => s + (n?.calories ?? 0), 0),
    [nutrition],
  );
  const totalProteinG = useMemo(
    () => Object.values(nutrition).reduce((s, n) => s + (n?.proteinG ?? 0), 0),
    [nutrition],
  );

  const saveDay = async () => {
    setSaving(true);
    try {
      const body = {
        currentWeightKg: weight === '' ? null : Number(weight),
        journal: journal || null,
        checks,
        texts,
      };
      const r = await fetch(`/api/health/transformation/days/${date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'save failed');
      }
      const j = await r.json();
      setDay(j.day);
      setChecks(j.checks ?? {});
      setTexts(j.texts ?? {});
      toast.success('Saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const savePlan = async () => {
    if (!planForm) return;
    setSavingPlan(true);
    try {
      const body: Record<string, unknown> = {
        name: planForm.name.trim(),
        startDate: planForm.startDate,
      };
      const dc = parseInt(planForm.dayCount, 10);
      if (Number.isFinite(dc) && dc > 0) body.dayCount = dc;
      const sw = parseFloat(planForm.startWeightKg);
      if (Number.isFinite(sw)) body.startWeightKg = sw;
      const gw = parseFloat(planForm.goalWeightKg);
      if (Number.isFinite(gw)) body.goalWeightKg = gw;
      const cal = parseInt(planForm.dailyCalorieTarget, 10);
      if (Number.isFinite(cal)) body.dailyCalorieTarget = cal;
      const pro = parseInt(planForm.dailyProteinTargetG, 10);
      if (Number.isFinite(pro)) body.dailyProteinTargetG = pro;

      const r = await fetch('/api/health/transformation/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'save failed');
      }
      toast.success('Plan updated');
      await loadPlan();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingPlan(false);
    }
  };

  // Fire the LLM estimator for one text-kind item. Called from onBlur.
  // Persists silently on the server (within the day row); UI updates from response.
  const estimateItem = async (item: Item, text: string) => {
    if (item.kind !== 'text') return;
    const trimmed = text.trim();
    if (!trimmed) {
      // Empty textarea → drop any existing estimate from local state.
      setNutrition((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }
    setEstimating((prev) => ({ ...prev, [item.id]: true }));
    try {
      const r = await fetch('/api/health/transformation/estimate-nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, itemId: item.id, date }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'estimate failed');
      }
      const j = await r.json();
      setNutrition((prev) => ({
        ...prev,
        [item.id]: { calories: j.estimate.calories, proteinG: j.estimate.proteinG },
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Estimate failed');
    } finally {
      setEstimating((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const toggleItemKind = async (item: Item) => {
    const nextKind: 'check' | 'text' = item.kind === 'text' ? 'check' : 'text';
    const r = await fetch('/api/health/transformation/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, kind: nextKind }),
    });
    if (!r.ok) {
      toast.error('Failed to toggle kind');
      return;
    }
    await loadPlan();
  };

  const addSection = async () => {
    const name = prompt('New section name:');
    if (!name?.trim()) return;
    const r = await fetch('/api/health/transformation/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sortOrder: sections.length }),
    });
    if (!r.ok) {
      toast.error('Failed to add section');
      return;
    }
    await loadPlan();
  };

  const renameSection = async (sec: Section) => {
    const name = prompt('Rename section:', sec.name);
    if (!name?.trim() || name === sec.name) return;
    const r = await fetch('/api/health/transformation/sections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sec.id, name }),
    });
    if (!r.ok) {
      toast.error('Failed to rename');
      return;
    }
    await loadPlan();
  };

  const deleteSection = async (sec: Section) => {
    if (!confirm(`Delete section "${sec.name}" and all its items?`)) return;
    const r = await fetch('/api/health/transformation/sections', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sec.id }),
    });
    if (!r.ok) {
      toast.error('Failed to delete');
      return;
    }
    await loadPlan();
  };

  const addItem = async (sec: Section, kind: 'check' | 'text' = 'check') => {
    const label = prompt(
      `New ${kind === 'text' ? 'text entry' : 'item'} in "${sec.name}":`,
    );
    if (!label?.trim()) return;
    const r = await fetch('/api/health/transformation/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: sec.id,
        label,
        sortOrder: sec.items.length,
        kind,
      }),
    });
    if (!r.ok) {
      toast.error('Failed to add item');
      return;
    }
    await loadPlan();
  };

  // Toggle one sub-option of a multi-item. Recomputes the day value and the
  // item's "done" flag (done = at least one sub-option ticked).
  const toggleMultiOption = (item: Item, option: string) => {
    const { selected, note } = parseMultiValue(texts[item.id]);
    const next = selected.includes(option)
      ? selected.filter((o) => o !== option)
      : [...selected, option];
    setTexts((prev) => ({ ...prev, [item.id]: JSON.stringify({ selected: next, note }) }));
    setChecks((prev) => ({ ...prev, [item.id]: next.length > 0 }));
  };

  // Update the free-text note on a multi-item. The note alone does not mark
  // the item "done" — only ticking a sub-option does.
  const setMultiNote = (item: Item, newNote: string) => {
    const { selected } = parseMultiValue(texts[item.id]);
    setTexts((prev) => ({
      ...prev,
      [item.id]: JSON.stringify({ selected, note: newNote }),
    }));
  };

  // Edit the sub-option list of a multi-item (comma-separated prompt).
  const editOptions = async (item: Item) => {
    const current = (item.options ?? []).join(', ');
    const input = prompt('Edit options (comma-separated):', current);
    if (input == null) return;
    const options = input.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await fetch('/api/health/transformation/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, options }),
    });
    if (!r.ok) {
      toast.error('Failed to update options');
      return;
    }
    await loadPlan();
  };

  // Create a new multi-item (activity group) in a section.
  const addGroup = async (sec: Section) => {
    const label = prompt(`New activity group in "${sec.name}":`, 'Physical Activity');
    if (!label?.trim()) return;
    const optsRaw = prompt(
      'Options (comma-separated):',
      'Walking, Stretching, Weights, Gym',
    );
    if (optsRaw == null) return;
    const options = optsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await fetch('/api/health/transformation/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: sec.id,
        label: label.trim(),
        sortOrder: sec.items.length,
        kind: 'multi',
        options,
      }),
    });
    if (!r.ok) {
      toast.error('Failed to add group');
      return;
    }
    await loadPlan();
  };

  const renameItem = async (item: Item) => {
    const label = prompt('Rename item:', item.label);
    if (!label?.trim() || label === item.label) return;
    const r = await fetch('/api/health/transformation/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, label }),
    });
    if (!r.ok) {
      toast.error('Failed to rename');
      return;
    }
    await loadPlan();
  };

  const deleteItem = async (item: Item) => {
    if (!confirm(`Delete "${item.label}"?`)) return;
    const r = await fetch('/api/health/transformation/items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    });
    if (!r.ok) {
      toast.error('Failed to delete');
      return;
    }
    setChecks((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    await loadPlan();
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }
  if (!plan) {
    return (
      <Card>
        <CardContent>
          <p className="text-[var(--dxp-text-muted)]">
            No plan found. Run the seed SQL or create one via the API.
          </p>
        </CardContent>
      </Card>
    );
  }

  const dayN = day?.dayNumber ?? 0;
  const isFutureDay = dayN < 1;
  const isBeyondCycle = dayN > plan.dayCount;
  const weightDelta =
    weight !== '' && plan.startWeightKg != null
      ? Number(weight) - plan.startWeightKg
      : null;
  const remainingToGoal =
    weight !== '' && plan.goalWeightKg != null
      ? Number(weight) - plan.goalWeightKg
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {editMode && planForm ? (
          <div className="flex-1 min-w-[280px] space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-7 w-7 text-amber-500 shrink-0" />
              <Input
                value={planForm.name}
                onChange={(e) =>
                  setPlanForm((p) => (p ? { ...p, name: e.target.value } : p))
                }
                placeholder="Plan name"
                className="text-xl font-bold"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Start date
                </label>
                <Input
                  type="date"
                  value={planForm.startDate}
                  onChange={(e) =>
                    setPlanForm((p) => (p ? { ...p, startDate: e.target.value } : p))
                  }
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Day count
                </label>
                <Input
                  type="number"
                  value={planForm.dayCount}
                  onChange={(e) =>
                    setPlanForm((p) => (p ? { ...p, dayCount: e.target.value } : p))
                  }
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Start weight (kg)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  value={planForm.startWeightKg}
                  onChange={(e) =>
                    setPlanForm((p) => (p ? { ...p, startWeightKg: e.target.value } : p))
                  }
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Goal weight (kg)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  value={planForm.goalWeightKg}
                  onChange={(e) =>
                    setPlanForm((p) => (p ? { ...p, goalWeightKg: e.target.value } : p))
                  }
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Daily cal
                </label>
                <Input
                  type="number"
                  value={planForm.dailyCalorieTarget}
                  onChange={(e) =>
                    setPlanForm((p) =>
                      p ? { ...p, dailyCalorieTarget: e.target.value } : p,
                    )
                  }
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Protein (g)
                </label>
                <Input
                  type="number"
                  value={planForm.dailyProteinTargetG}
                  onChange={(e) =>
                    setPlanForm((p) =>
                      p ? { ...p, dailyProteinTargetG: e.target.value } : p,
                    )
                  }
                />
              </div>
            </div>
            <Button variant="primary" size="sm" onClick={savePlan} disabled={savingPlan}>
              {savingPlan ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Save plan
            </Button>
          </div>
        ) : (
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
              <Sparkles className="h-7 w-7 text-amber-500" />
              {plan.name}
            </h1>
            <p className="text-sm text-[var(--dxp-text-secondary)]">
              Start {new Date(plan.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{' '}
              · {plan.startWeightKg ?? '—'} kg → {plan.goalWeightKg ?? '—'} kg
              · {plan.dailyCalorieTarget ?? '—'} cal · {plan.dailyProteinTargetG ?? '—'} g protein
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <Link href="/health/transformation/history">
            <Button variant="ghost" size="sm">
              <HistoryIcon className="mr-2 h-4 w-4" /> History
            </Button>
          </Link>
          <Button
            variant={editMode ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? <Check className="mr-2 h-4 w-4" /> : <Pencil className="mr-2 h-4 w-4" />}
            {editMode ? 'Done editing' : 'Edit'}
          </Button>
        </div>
      </div>

      {/* Day picker + progress */}
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Date
              </label>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-44"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDate(todayIso())}
                >
                  Today
                </Button>
              </div>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Day
              </p>
              <p className="font-mono text-2xl font-bold text-[var(--dxp-text)]">
                {dayN > 0 ? `${dayN} / ${plan.dayCount}` : '—'}
              </p>
              {isFutureDay && (
                <p className="text-[10px] text-amber-600">before challenge start</p>
              )}
              {isBeyondCycle && (
                <p className="text-[10px] text-emerald-600">challenge complete</p>
              )}
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Progress · {doneItems} / {totalItems} ({progressPct}%)
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Weight (kg)
              </label>
              <Input
                type="number"
                step="0.1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder={plan.startWeightKg ? String(plan.startWeightKg) : '—'}
                className="w-28"
              />
              {weightDelta != null && (
                <p
                  className={`mt-1 text-[10px] font-mono ${
                    weightDelta <= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {weightDelta >= 0 ? '+' : ''}
                  {weightDelta.toFixed(1)} kg from start
                  {remainingToGoal != null && (
                    <>
                      {' '}· {remainingToGoal.toFixed(1)} kg to goal
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Today's intake — calorie + protein totals vs plan targets. */}
          {(plan.dailyCalorieTarget != null || plan.dailyProteinTargetG != null) && (
            <div className="mt-4 pt-4 border-t border-[var(--dxp-border-light)] grid grid-cols-1 sm:grid-cols-2 gap-4">
              {plan.dailyCalorieTarget != null && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)] flex items-center gap-1">
                    <Flame className="h-3.5 w-3.5 text-amber-500" />
                    Calories · {totalCalories} / {plan.dailyCalorieTarget}
                    {totalCalories > plan.dailyCalorieTarget && (
                      <span className="text-rose-600">
                        (+{totalCalories - plan.dailyCalorieTarget} over)
                      </span>
                    )}
                  </p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                    <div
                      className={`h-full transition-all ${
                        totalCalories > plan.dailyCalorieTarget
                          ? 'bg-rose-500'
                          : 'bg-amber-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          (totalCalories / plan.dailyCalorieTarget) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {plan.dailyProteinTargetG != null && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Protein · {totalProteinG.toFixed(1)} / {plan.dailyProteinTargetG} g
                    {totalProteinG >= plan.dailyProteinTargetG && (
                      <span className="text-emerald-600"> ✓</span>
                    )}
                  </p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          (totalProteinG / plan.dailyProteinTargetG) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sections.map((sec) => (
          <Card key={sec.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">{sec.name}</h3>
                {editMode && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => renameSection(sec)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteSection(sec)}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {sec.items.map((item) => (
                  <li key={item.id} className="group">
                    {item.kind === 'text' ? (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                            {item.label}
                          </span>
                          {editMode && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleItemKind(item)}
                                title="Convert to checkbox"
                              >
                                <SquareCheckBig className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => renameItem(item)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => deleteItem(item)}>
                                <X className="h-3 w-3 text-rose-500" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <textarea
                          value={texts[item.id] ?? ''}
                          onChange={(e) =>
                            setTexts((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          onBlur={(e) => estimateItem(item, e.target.value)}
                          rows={2}
                          placeholder="Write here…"
                          className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                        />
                        {(nutrition[item.id] || estimating[item.id]) && (
                          <div className="mt-1 flex items-center gap-2 text-[11px]">
                            {estimating[item.id] ? (
                              <span className="flex items-center gap-1 text-[var(--dxp-text-muted)]">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                estimating…
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 border border-amber-200">
                                <Flame className="h-3 w-3" />
                                ~{nutrition[item.id].calories} cal ·{' '}
                                {nutrition[item.id].proteinG.toFixed(1)} g protein
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : item.kind === 'multi' ? (
                      (() => {
                        const mv = parseMultiValue(texts[item.id]);
                        return (
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                                {item.label}
                                {mv.selected.length > 0 && (
                                  <span className="ml-1.5 text-emerald-600 normal-case">
                                    ✓ {mv.selected.length}
                                  </span>
                                )}
                              </span>
                              {editMode && (
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => editOptions(item)}
                                    title="Edit options"
                                  >
                                    <SquareCheckBig className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => renameItem(item)}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => deleteItem(item)}>
                                    <X className="h-3 w-3 text-rose-500" />
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {(item.options ?? []).map((opt) => {
                                const isOn = mv.selected.includes(opt);
                                return (
                                  <label
                                    key={opt}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isOn}
                                      onChange={() => toggleMultiOption(item, opt)}
                                      className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span
                                      className={`text-sm ${
                                        isOn
                                          ? 'text-[var(--dxp-text)]'
                                          : 'text-[var(--dxp-text-secondary)]'
                                      }`}
                                    >
                                      {opt}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                            <input
                              type="text"
                              value={mv.note}
                              onChange={(e) => setMultiNote(item, e.target.value)}
                              placeholder="Notes (optional)…"
                              className="mt-2 w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-2 py-1.5 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                            />
                          </div>
                        );
                      })()
                    ) : (
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!checks[item.id]}
                            onChange={(e) =>
                              setChecks((prev) => ({ ...prev, [item.id]: e.target.checked }))
                            }
                            className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span
                            className={`text-sm ${
                              checks[item.id]
                                ? 'text-[var(--dxp-text-muted)] line-through'
                                : 'text-[var(--dxp-text)]'
                            }`}
                          >
                            {item.label}
                          </span>
                        </label>
                        {editMode && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleItemKind(item)}
                              title="Convert to text field"
                            >
                              <Type className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => renameItem(item)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteItem(item)}>
                              <X className="h-3 w-3 text-rose-500" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {editMode && (
                  <li className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addItem(sec, 'check')}
                      className="text-[var(--dxp-text-muted)]"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add checkbox
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addItem(sec, 'text')}
                      className="text-[var(--dxp-text-muted)]"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add text field
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addGroup(sec)}
                      className="text-[var(--dxp-text-muted)]"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add activity group
                    </Button>
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {editMode && (
        <Button variant="secondary" size="sm" onClick={addSection}>
          <Plus className="mr-2 h-4 w-4" /> Add section
        </Button>
      )}

      {/* Journal */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Journal</h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            What happened today, what you noticed, what you want to change.
          </p>
        </CardHeader>
        <CardContent>
          <textarea
            value={journal}
            onChange={(e) => setJournal(e.target.value)}
            rows={8}
            placeholder="Write freely…"
            className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-3 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
          />
        </CardContent>
      </Card>

      {/* Sticky save */}
      <div className="sticky bottom-4 flex justify-end">
        <Button variant="primary" size="md" onClick={saveDay} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Save day
        </Button>
      </div>
    </div>
  );
}
