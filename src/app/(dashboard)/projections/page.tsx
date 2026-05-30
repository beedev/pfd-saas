'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatCompact, getCurrentPeriod, parseAmount } from '@/lib/finance/amount';
import { toast } from 'sonner';
import {
  TrendingUp,
  PiggyBank,
  Edit2,
  Loader2,
  Target,
  Calendar,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Coins,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ProjectionCategory {
  id: number;
  name: string;
  isInflow: boolean;
  goalId: number | null;
  monthlyAmount: number;
  carryforwardAmount: number;
  cumulativeAmount: number;
  asOfBalance: number;
}

interface Goal {
  id: number;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  currentAmount: number;
  color: string | null;
  progress: number;
  monthsRemaining: number | null;
  monthlyRequired: number | null;
  linkedCategories: string[];
}

interface Summary {
  totalSavingsCarryforward: number;
  totalSavingsCumulative: number;
  totalSavingsBalance: number;
  totalGoalTargets: number;
  coveragePercent: number;
  monthlySavings: number;
}

interface AssetItem {
  id: number;
  label: string;
  sublabel?: string;
  maturityDate: string | null;
  valuePaisa: number;
  included: boolean;
}

interface AggregateAssetClass {
  kind: 'aggregate';
  assetClass: string;
  label: string;
  valuePaisa: number;
  liquidity: 'liquid' | 'semi-liquid' | 'locked';
  defaultIncluded: boolean;
  included: boolean;
  basis?: string;
}

interface ItemizedAssetClass {
  kind: 'itemized';
  assetClass: string;
  label: string;
  liquidity: 'liquid' | 'semi-liquid' | 'locked';
  basis?: string;
  items: AssetItem[];
  includedSumPaisa: number;
  defaultIncludedAll: boolean;
}

type SavingsAssetClass = AggregateAssetClass | ItemizedAssetClass;

export default function ProjectionsPage() {
  const [categories, setCategories] = useState<ProjectionCategory[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [asOfPeriod, setAsOfPeriod] = useState(getCurrentPeriod());
  const [loading, setLoading] = useState(true);
  // Asset-backed savings (live values from the portfolio)
  const [assetClasses, setAssetClasses] = useState<SavingsAssetClass[]>([]);
  const [assetIncludedTotal, setAssetIncludedTotal] = useState(0);
  const [togglingAsset, setTogglingAsset] = useState<string | null>(null);

  // Forward-looking plan: one-time lump sum + recurring monthly.
  // Drives per-goal "projected coverage" — not part of current Total Savings.
  const [futureLumpRupees, setFutureLumpRupees] = useState('');
  const [futureMonthlyRupees, setFutureMonthlyRupees] = useState('');
  const [futureLumpPaisa, setFutureLumpPaisa] = useState(0);
  const [futureMonthlyPaisa, setFutureMonthlyPaisa] = useState(0);
  const [savingFuture, setSavingFuture] = useState(false);

  // Savings edit state
  const [editingCategory, setEditingCategory] = useState<ProjectionCategory | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [updateType, setUpdateType] = useState<'all' | 'from_date'>('from_date');
  const [fromPeriod, setFromPeriod] = useState(getCurrentPeriod());
  const [savingCategory, setSavingCategory] = useState(false);

  // Create savings state
  const [isCreatingSavings, setIsCreatingSavings] = useState(false);
  const [newSavingsName, setNewSavingsName] = useState('');
  const [newSavingsAmount, setNewSavingsAmount] = useState('');
  const [newSavingsStartPeriod, setNewSavingsStartPeriod] = useState(getCurrentPeriod());
  const [creatingSavings, setCreatingSavings] = useState(false);

  // Goal edit state
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [editGoalName, setEditGoalName] = useState('');
  const [editGoalTarget, setEditGoalTarget] = useState('');
  const [editGoalDate, setEditGoalDate] = useState('');
  const [editGoalColor, setEditGoalColor] = useState('#4CAF50');
  const [savingGoal, setSavingGoal] = useState(false);
  const [deletingGoalId, setDeletingGoalId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [projectionsRes, goalsRes, assetsRes, futureRes] = await Promise.all([
        fetch(`/api/finance/projections?asOf=${asOfPeriod}`),
        fetch('/api/finance/goals'),
        fetch('/api/finance/savings-assets'),
        fetch('/api/finance/future-savings'),
      ]);
      const projectionsData = await projectionsRes.json();
      const goalsData = await goalsRes.json();
      const assetsData = await assetsRes.json();
      const futureData = await futureRes.json();

      setCategories(projectionsData.categories || []);
      setSummary(projectionsData.summary || null);
      setGoals(goalsData.goals || []);
      setAssetClasses(assetsData.classes || []);
      setAssetIncludedTotal(assetsData.includedTotalPaisa || 0);
      const lump = futureData.lumpSumPaisa ?? 0;
      const monthly = futureData.monthlyPaisa ?? 0;
      setFutureLumpPaisa(lump);
      setFutureMonthlyPaisa(monthly);
      setFutureLumpRupees(lump > 0 ? String(Math.round(lump / 100)) : '');
      setFutureMonthlyRupees(monthly > 0 ? String(Math.round(monthly / 100)) : '');
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [asOfPeriod]);

  // Save the future plan field on blur. Either field can be saved
  // independently — undefined fields are left untouched server-side.
  const saveFuturePlan = async (
    field: 'lumpSumPaisa' | 'monthlyPaisa',
    rupees: string,
  ) => {
    const valuePaisa = Math.max(0, Math.round(Number(rupees || '0') * 100));
    if (
      (field === 'lumpSumPaisa' && valuePaisa === futureLumpPaisa) ||
      (field === 'monthlyPaisa' && valuePaisa === futureMonthlyPaisa)
    ) {
      return; // no change
    }
    setSavingFuture(true);
    try {
      const r = await fetch('/api/finance/future-savings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: valuePaisa }),
      });
      if (!r.ok) throw new Error('save failed');
      const data = await r.json();
      setFutureLumpPaisa(data.lumpSumPaisa);
      setFutureMonthlyPaisa(data.monthlyPaisa);
    } catch (e) {
      console.error('saveFuturePlan:', e);
    } finally {
      setSavingFuture(false);
    }
  };

  // Toggle either an aggregate class or a single item within an itemized
  // class. sourceId !== undefined means "toggle this item only".
  const toggleAssetClass = async (
    assetClass: string,
    included: boolean,
    sourceId?: number,
  ) => {
    const key = sourceId !== undefined ? `${assetClass}:${sourceId}` : assetClass;
    setTogglingAsset(key);
    // Optimistic local mutation so the UI feels instant.
    setAssetClasses((prev) =>
      prev.map((c) => {
        if (c.assetClass !== assetClass) return c;
        if (c.kind === 'aggregate' && sourceId === undefined) {
          return { ...c, included };
        }
        if (c.kind === 'itemized' && sourceId !== undefined) {
          const items = c.items.map((it) =>
            it.id === sourceId ? { ...it, included } : it,
          );
          const includedSumPaisa = items
            .filter((it) => it.included)
            .reduce((s, it) => s + it.valuePaisa, 0);
          return { ...c, items, includedSumPaisa };
        }
        return c;
      }),
    );
    try {
      const r = await fetch('/api/finance/savings-assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetClass, included, sourceId }),
      });
      if (!r.ok) throw new Error('toggle failed');
      // Reconcile total + remote state authoritatively.
      const recompute = await fetch('/api/finance/savings-assets');
      const data = await recompute.json();
      setAssetClasses(data.classes || []);
      setAssetIncludedTotal(data.includedTotalPaisa || 0);
    } catch (e) {
      console.error('toggleAssetClass:', e);
      await fetchData();
    } finally {
      setTogglingAsset(null);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Savings handlers
  const handleEditCategory = (category: ProjectionCategory) => {
    setEditingCategory(category);
    setEditAmount(formatCompact(category.monthlyAmount).replace('-', ''));
    setUpdateType('from_date');
    setFromPeriod(getCurrentPeriod());
  };

  const handleSaveCategory = async () => {
    if (!editingCategory) return;
    setSavingCategory(true);
    try {
      const amount = parseAmountInput(editAmount);
      await fetch('/api/finance/projections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: editingCategory.id,
          newAmount: amount,
          updateType,
          fromPeriod: updateType === 'from_date' ? fromPeriod : undefined,
        }),
      });
      setEditingCategory(null);
      fetchData();
    } catch (error) {
      console.error('Error saving projection:', error);
    } finally {
      setSavingCategory(false);
    }
  };

  // Create savings handlers
  const handleCreateSavings = () => {
    setNewSavingsName('');
    setNewSavingsAmount('');
    setNewSavingsStartPeriod(getCurrentPeriod());
    setIsCreatingSavings(true);
  };

  const handleSaveNewSavings = async () => {
    if (!newSavingsName || !newSavingsAmount) return;
    setCreatingSavings(true);
    try {
      const amount = parseAmountInput(newSavingsAmount);
      await fetch('/api/finance/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSavingsName,
          isInflow: true,
          monthlyAmount: amount,
          startPeriod: newSavingsStartPeriod,
        }),
      });
      setIsCreatingSavings(false);
      fetchData();
    } catch (error) {
      console.error('Error creating savings category:', error);
    } finally {
      setCreatingSavings(false);
    }
  };

  // Goal handlers
  const handleCreateGoal = () => {
    setEditingGoal(null);
    setEditGoalName('');
    setEditGoalTarget('');
    setEditGoalDate('');
    setEditGoalColor('#4CAF50');
    setIsCreatingGoal(true);
  };

  const handleEditGoal = (goal: Goal) => {
    setEditingGoal(goal);
    setEditGoalName(goal.name);
    setEditGoalTarget(formatCompact(goal.targetAmount).replace('-', ''));
    setEditGoalDate(goal.targetDate ? goal.targetDate.substring(0, 10) : '');
    setEditGoalColor(goal.color || '#4CAF50');
    setIsCreatingGoal(false);
  };

  const handleSaveGoal = async () => {
    const amount = parseAmountInput(editGoalTarget);
    // Reject blank / unparseable targets so we don't silently save ₹0 and
    // surprise the user with a wiped goal.
    if (!editGoalName.trim()) {
      toast.error('Goal name is required');
      return;
    }
    if (!editGoalTarget.trim() || amount <= 0) {
      toast.error(
        `Couldn't read the target "${editGoalTarget}". Use e.g. 75L, 1Cr, 7500000.`,
      );
      return;
    }
    setSavingGoal(true);
    try {
      const res = isCreatingGoal
        ? await fetch('/api/finance/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: editGoalName,
              targetAmount: amount,
              targetDate: editGoalDate || null,
              color: editGoalColor,
            }),
          })
        : await fetch('/api/finance/goals', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: editingGoal!.id,
              name: editGoalName,
              targetAmount: amount,
              targetDate: editGoalDate || null,
              color: editGoalColor,
            }),
          });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'save failed');
      }
      toast.success(isCreatingGoal ? 'Goal created' : 'Goal updated');
      setEditingGoal(null);
      setIsCreatingGoal(false);
      fetchData();
    } catch (error) {
      console.error('Error saving goal:', error);
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSavingGoal(false);
    }
  };

  const handleDeleteGoal = async (id: number) => {
    if (!confirm('Are you sure you want to delete this goal?')) return;
    setDeletingGoalId(id);
    try {
      await fetch(`/api/finance/goals?id=${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error('Error deleting goal:', error);
    } finally {
      setDeletingGoalId(null);
    }
  };

  // Delegate to the shared lenient parser which already handles commas,
  // 'lakh'/'crore' words, and bare numeric input — the old local parser
  // silently returned 0 on anything it didn't recognise (e.g. "75,00,000"),
  // which is exactly how goal targets were getting wiped to 0 on save.
  const parseAmountInput = (input: string): number => parseAmount(input);

  const totalGoalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
  const completedGoals = goals.filter(g => g.progress >= 100).length;
  // Current Total Savings is just the asset-backed total — no more manual
  // carryforward categories. The user's two forward-looking inputs (lump sum
  // + monthly) project onto each goal's target date but don't inflate today's
  // balance.
  const combinedSavings = assetIncludedTotal;
  const combinedCoveragePct =
    totalGoalTarget > 0
      ? Math.round((combinedSavings / totalGoalTarget) * 100)
      : 0;
  // suppress unused-warning while the projection categories table is still
  // queried by the projections API (other consumers may rely on it).
  void categories;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Savings & Goals</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track your savings and progress towards financial goals
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
          <Calendar className="h-4 w-4 text-gray-500" />
          <span className="text-sm text-gray-600">As of:</span>
          <input
            type="month"
            value={periodToMonthInput(asOfPeriod)}
            onChange={(e) => setAsOfPeriod(monthInputToPeriod(e.target.value))}
            className="border-none bg-transparent text-sm font-medium focus:outline-none"
          />
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard
            title="Total Goals"
            value={goals.length.toString()}
            subtitle={`${completedGoals} completed`}
            icon={Target}
            className="bg-blue-50 border-blue-200"
            iconClassName="text-blue-600"
          />
          <SummaryCard
            title="Target Value"
            value={formatCompact(totalGoalTarget)}
            subtitle="Combined targets"
            icon={TrendingUp}
            className="bg-purple-50 border-purple-200"
            iconClassName="text-purple-600"
          />
          <SummaryCard
            title="Total Savings"
            value={formatCompact(combinedSavings)}
            subtitle={
              futureMonthlyPaisa > 0 || futureLumpPaisa > 0
                ? `+ planned ${formatCompact(futureLumpPaisa)} lump · ${formatCompact(futureMonthlyPaisa)}/mo`
                : 'From liquid assets'
            }
            icon={PiggyBank}
            className="bg-green-50 border-green-200"
            iconClassName="text-green-600"
          />
          <SummaryCard
            title="Coverage"
            value={`${combinedCoveragePct}%`}
            subtitle={
              combinedCoveragePct >= 100
                ? 'Fully covered!'
                : `${formatCompact(totalGoalTarget - combinedSavings)} to go`
            }
            icon={CheckCircle2}
            className={combinedCoveragePct >= 100 ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}
            iconClassName={combinedCoveragePct >= 100 ? 'text-green-600' : 'text-orange-600'}
          />
        </div>
      )}

      {/* Coverage Progress Bar */}
      {summary && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-600 font-medium">Savings vs Goals</span>
            <span className={cn(
              'font-semibold',
              combinedCoveragePct >= 100 ? 'text-green-600' : 'text-blue-600'
            )}>
              {formatCompact(combinedSavings)} / {formatCompact(totalGoalTarget)}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
            <div
              className={cn(
                'h-4 rounded-full transition-all duration-500',
                combinedCoveragePct >= 100 ? 'bg-green-500' : 'bg-gradient-to-r from-green-500 to-blue-500'
              )}
              style={{ width: `${Math.min(100, combinedCoveragePct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Liquid Assets — pull live values from the portfolio into savings */}
      <section className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-start justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Coins className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Liquid Assets</h2>
              <p className="text-xs text-gray-500">
                Live values from your portfolio · tick which classes count as
                savings against your goals
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Asset-backed total
            </p>
            <p className="font-mono text-lg font-bold text-gray-900">
              {formatCompact(assetIncludedTotal)}
            </p>
          </div>
        </div>
        <div className="p-4 space-y-2">
          {assetClasses.map((c) => {
            const tone =
              c.liquidity === 'liquid'
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : c.liquidity === 'semi-liquid'
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-gray-500 bg-gray-50 border-gray-200';

            if (c.kind === 'aggregate') {
              const isOn = c.included;
              const isToggling = togglingAsset === c.assetClass;
              return (
                <label
                  key={c.assetClass}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors',
                    isOn
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50',
                    isToggling && 'opacity-60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={isToggling}
                      onChange={(e) =>
                        toggleAssetClass(c.assetClass, e.target.checked)
                      }
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-900">{c.label}</span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                        tone,
                      )}
                    >
                      {c.liquidity}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-gray-700">
                    {formatCompact(c.valuePaisa)}
                  </span>
                </label>
              );
            }

            // Itemized class — render as expandable section with per-item ticks.
            return (
              <ItemizedClassRow
                key={c.assetClass}
                cls={c}
                togglingKey={togglingAsset}
                onToggleItem={(itemId, included) =>
                  toggleAssetClass(c.assetClass, included, itemId)
                }
                tone={tone}
              />
            );
          })}
        </div>
      </section>

      {/* Future Savings Plan — two forward-looking inputs that project onto goals */}
      <section className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-start justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Future Savings Plan</h2>
              <p className="text-xs text-gray-500">
                What you plan to add on top of liquid assets — drives the
                projected coverage on each goal below.
              </p>
            </div>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
              Future lump sum (₹, one-time)
            </label>
            <input
              type="number"
              min={0}
              step={10000}
              value={futureLumpRupees}
              onChange={(e) => setFutureLumpRupees(e.target.value)}
              onBlur={() => saveFuturePlan('lumpSumPaisa', futureLumpRupees)}
              placeholder="0"
              className="w-full border border-gray-200 rounded-md px-3 py-2 font-mono text-lg focus:border-blue-400 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Bonus, FD maturity, sale proceeds — added once at the target date.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
              Future monthly (₹/month)
            </label>
            <input
              type="number"
              min={0}
              step={1000}
              value={futureMonthlyRupees}
              onChange={(e) => setFutureMonthlyRupees(e.target.value)}
              onBlur={() => saveFuturePlan('monthlyPaisa', futureMonthlyRupees)}
              placeholder="0"
              className="w-full border border-gray-200 rounded-md px-3 py-2 font-mono text-lg focus:border-blue-400 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Recurring monthly addition — multiplied by months until each goal's target date.
            </p>
          </div>
        </div>
        {savingFuture && (
          <div className="px-4 pb-3 text-[11px] text-gray-500 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> saving…
          </div>
        )}
      </section>

      {/* Goals — full width, each card shows current + projected coverage */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Target className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Financial Goals</h2>
              <p className="text-xs text-gray-500">
                Projected by target date = current assets + lump + monthly × months left
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleCreateGoal}>
            <Plus className="h-4 w-4 mr-1" />
            Add Goal
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              totalSavings={assetIncludedTotal}
              totalGoalTarget={totalGoalTarget}
              futureLumpPaisa={futureLumpPaisa}
              futureMonthlyPaisa={futureMonthlyPaisa}
              onEdit={() => handleEditGoal(goal)}
              onDelete={() => handleDeleteGoal(goal.id)}
              isDeleting={deletingGoalId === goal.id}
            />
          ))}
          {goals.length === 0 && (
            <div className="col-span-full text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
              <Target className="h-10 w-10 mx-auto mb-3 text-gray-400" />
              <p className="text-sm">No goals defined yet</p>
              <p className="text-xs text-gray-400 mt-1">Click &quot;Add Goal&quot; to create one</p>
            </div>
          )}
        </div>
      </section>

      {/* Savings Edit Dialog */}
      <Dialog open={!!editingCategory} onOpenChange={() => setEditingCategory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editingCategory?.name}</DialogTitle>
            <DialogDescription>
              Update the monthly amount for this savings category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Amount</label>
              <input
                type="text"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                placeholder="e.g., 36K, 3.6L"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Use K for thousands, L for lakhs, Cr for crores</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Apply Changes To</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="updateType" value="from_date" checked={updateType === 'from_date'} onChange={() => setUpdateType('from_date')} className="h-4 w-4 text-blue-600" />
                  <span className="text-sm">From a specific month onwards</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="updateType" value="all" checked={updateType === 'all'} onChange={() => setUpdateType('all')} className="h-4 w-4 text-blue-600" />
                  <span className="text-sm">All entries (retrospective)</span>
                </label>
              </div>
            </div>
            {updateType === 'from_date' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Starting From</label>
                <input
                  type="month"
                  value={periodToMonthInput(fromPeriod)}
                  onChange={(e) => setFromPeriod(monthInputToPeriod(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCategory(null)}>Cancel</Button>
            <Button onClick={handleSaveCategory} disabled={savingCategory}>
              {savingCategory ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goal Edit/Create Dialog */}
      <Dialog open={!!editingGoal || isCreatingGoal} onOpenChange={() => { setEditingGoal(null); setIsCreatingGoal(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isCreatingGoal ? 'Create New Goal' : `Edit ${editingGoal?.name}`}</DialogTitle>
            <DialogDescription>
              {isCreatingGoal ? 'Define a new financial goal to track.' : 'Update your financial goal details.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Goal Name</label>
              <input
                type="text"
                value={editGoalName}
                onChange={(e) => setEditGoalName(e.target.value)}
                placeholder="e.g., Marriage Fund"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Amount</label>
              <input
                type="text"
                value={editGoalTarget}
                onChange={(e) => setEditGoalTarget(e.target.value)}
                placeholder="e.g., 67L, 1Cr"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Use K for thousands, L for lakhs, Cr for crores</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Date (Optional)</label>
              <input
                type="date"
                value={editGoalDate}
                onChange={(e) => setEditGoalDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
              <div className="flex gap-2">
                {['#4CAF50', '#2196F3', '#E91E63', '#FF9800', '#9C27B0', '#00BCD4'].map(color => (
                  <button
                    key={color}
                    onClick={() => setEditGoalColor(color)}
                    className={cn('w-8 h-8 rounded-full border-2 transition-all', editGoalColor === color ? 'border-gray-800 scale-110' : 'border-transparent')}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingGoal(null); setIsCreatingGoal(false); }}>Cancel</Button>
            <Button onClick={handleSaveGoal} disabled={savingGoal || !editGoalName || !editGoalTarget}>
              {savingGoal ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isCreatingGoal ? 'Create Goal' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Savings Dialog */}
      <Dialog open={isCreatingSavings} onOpenChange={() => setIsCreatingSavings(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Savings Category</DialogTitle>
            <DialogDescription>
              Create a new savings category to track monthly contributions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category Name</label>
              <input
                type="text"
                value={newSavingsName}
                onChange={(e) => setNewSavingsName(e.target.value)}
                placeholder="e.g., SIP, RD, FD"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Amount</label>
              <input
                type="text"
                value={newSavingsAmount}
                onChange={(e) => setNewSavingsAmount(e.target.value)}
                placeholder="e.g., 36K, 50K"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-500 mt-1">Use K for thousands, L for lakhs, Cr for crores</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start From</label>
              <input
                type="month"
                value={periodToMonthInput(newSavingsStartPeriod)}
                onChange={(e) => setNewSavingsStartPeriod(monthInputToPeriod(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-500 mt-1">Entries will be created for 3 years from this date</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreatingSavings(false)}>Cancel</Button>
            <Button onClick={handleSaveNewSavings} disabled={creatingSavings || !newSavingsName || !newSavingsAmount}>
              {creatingSavings ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Savings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Summary Card Component
function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
  className,
  iconClassName,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn('p-4 rounded-lg border', className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
        </div>
        <Icon className={cn('h-10 w-10', iconClassName)} />
      </div>
    </div>
  );
}

// Savings Card Component
function SavingsCard({
  category,
  onEdit,
}: {
  category: ProjectionCategory;
  onEdit: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow border-l-4 border-l-green-500">
      <div className="flex items-start justify-between">
        <h3 className="font-medium text-gray-900">{category.name}</h3>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Edit2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="bg-gray-50 rounded p-2">
          <p className="text-xs text-gray-500">Monthly</p>
          <p className="font-semibold text-green-600">+{formatCompact(category.monthlyAmount)}</p>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <p className="text-xs text-gray-500">Accumulated</p>
          <p className="font-semibold text-gray-700">{formatCompact(category.cumulativeAmount)}</p>
        </div>
        <div className="bg-green-50 rounded p-2">
          <p className="text-xs text-gray-500">Balance</p>
          <p className="font-bold text-green-700">{formatCompact(category.asOfBalance)}</p>
        </div>
      </div>
      {category.carryforwardAmount > 0 && (
        <p className="text-xs text-gray-500 mt-2">Includes {formatCompact(category.carryforwardAmount)} carryforward</p>
      )}
    </div>
  );
}

// Goal Card Component
function GoalCard({
  goal,
  totalSavings,
  totalGoalTarget,
  futureLumpPaisa,
  futureMonthlyPaisa,
  onEdit,
  onDelete,
  isDeleting,
}: {
  goal: Goal;
  totalSavings: number;
  totalGoalTarget: number;
  futureLumpPaisa: number;
  futureMonthlyPaisa: number;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  // Calculate this goal's share of total savings (proportional allocation —
  // each goal gets its slice of the asset pool weighted by its target size).
  const goalShare = totalGoalTarget > 0 ? goal.targetAmount / totalGoalTarget : 0;
  const allocatedSavings = Math.round(totalSavings * goalShare);
  const progress = goal.targetAmount > 0
    ? Math.min(100, Math.round((allocatedSavings / goal.targetAmount) * 100))
    : 0;
  const isCompleted = progress >= 100;

  // Projected coverage by the goal's target date. Lump sum lands on that day;
  // monthly contributions accumulate over the months between now and then.
  // Both are proportionally allocated to this goal (same logic as current).
  const monthsLeft = Math.max(0, goal.monthsRemaining ?? 0);
  const projectedPool =
    totalSavings + futureLumpPaisa + futureMonthlyPaisa * monthsLeft;
  const projectedAllocated = Math.round(projectedPool * goalShare);
  const projectedProgress = goal.targetAmount > 0
    ? Math.min(100, Math.round((projectedAllocated / goal.targetAmount) * 100))
    : 0;
  const hasPlan = futureLumpPaisa > 0 || futureMonthlyPaisa > 0;
  const projectedDelta = projectedAllocated - allocatedSavings;

  // What this allocation would actually be worth at the goal's target date if
  // the current pool compounds at a moderate return (10% default — matches
  // the retirement page's pre-retirement assumption). Lets the user see the
  // time-value alongside the raw "if-nothing-grows" projected pool above.
  const GOAL_RETURN_RATE = 0.1;
  const yearsLeft = monthsLeft / 12;
  const allocatedAtTargetDate = Math.round(
    allocatedSavings * Math.pow(1 + GOAL_RETURN_RATE, yearsLeft),
  );
  const compoundedProgress = goal.targetAmount > 0
    ? Math.min(100, Math.round((allocatedAtTargetDate / goal.targetAmount) * 100))
    : 0;

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
      style={{ borderLeftWidth: 4, borderLeftColor: goal.color || '#9333EA' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-900">{goal.name}</h3>
          {isCompleted && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            className="text-red-500 hover:text-red-700 hover:bg-red-50"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-500">Progress</span>
          <span className={cn('text-sm font-semibold', isCompleted ? 'text-green-600' : 'text-gray-900')}>
            {progress}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={cn('h-2 rounded-full transition-all duration-500', isCompleted ? 'bg-green-500' : '')}
            style={{ width: `${progress}%`, backgroundColor: isCompleted ? undefined : (goal.color || '#9333EA') }}
          />
        </div>
      </div>

      {/* Amounts — today + at-target-date + target */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-gray-50 rounded p-2">
          <p className="text-[10px] text-gray-500">Allocated today</p>
          <p className="font-semibold text-gray-900">{formatCompact(allocatedSavings)}</p>
        </div>
        <div className="bg-blue-50 rounded p-2">
          <p className="text-[10px] text-gray-500">
            At {goal.targetDate
              ? new Date(goal.targetDate).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
              : 'target'}{' '}
            (10%)
          </p>
          <p className="font-semibold text-blue-700">{formatCompact(allocatedAtTargetDate)}</p>
          <p className={cn(
            'text-[9px] font-mono',
            compoundedProgress >= 100 ? 'text-emerald-600' : 'text-blue-600',
          )}>
            {compoundedProgress}% cov
          </p>
        </div>
        <div className="bg-purple-50 rounded p-2">
          <p className="text-[10px] text-gray-500">Target</p>
          <p className="font-bold text-purple-700">{formatCompact(goal.targetAmount)}</p>
        </div>
      </div>

      {/* Projected by target date (only shown when there's a forward-looking plan) */}
      {hasPlan && monthsLeft > 0 && (
        <div className="mt-3 rounded-md border border-blue-100 bg-blue-50/50 p-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
              Projected by {goal.targetDate ? new Date(goal.targetDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'target'}
            </span>
            <span className={cn(
              'text-sm font-bold',
              projectedProgress >= 100 ? 'text-green-600' : 'text-blue-700',
            )}>
              {projectedProgress}%
            </span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
            <div
              className={cn(
                'h-1.5 rounded-full transition-all duration-500',
                projectedProgress >= 100 ? 'bg-green-500' : 'bg-blue-500',
              )}
              style={{ width: `${projectedProgress}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-blue-700">
            {formatCompact(projectedAllocated)} projected
            {projectedDelta > 0 && (
              <> · +{formatCompact(projectedDelta)} from plan</>
            )}
          </p>
        </div>
      )}

      {/* Status Footer */}
      {goal.targetDate && (
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-100 text-xs">
          <div className="flex items-center text-gray-500">
            <Calendar className="h-3 w-3 mr-1" />
            {goal.monthsRemaining !== null && goal.monthsRemaining > 0 ? (
              <span>{goal.monthsRemaining} months left</span>
            ) : (
              <span>{new Date(goal.targetDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
            )}
          </div>
          {!isCompleted && goal.monthlyRequired && goal.monthlyRequired > 0 && (
            <div className="flex items-center text-orange-600">
              <AlertCircle className="h-3 w-3 mr-1" />
              <span>{formatCompact(goal.monthlyRequired)}/mo needed</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One row per itemized asset class (Chit Funds, Insurance Policies).
 * Collapsed by default; expands to show per-item checkboxes sorted by
 * maturity date, with the running sum of ticked items at the top.
 */
function ItemizedClassRow({
  cls,
  togglingKey,
  onToggleItem,
  tone,
}: {
  cls: ItemizedAssetClass;
  togglingKey: string | null;
  onToggleItem: (itemId: number, included: boolean) => void;
  tone: string;
}) {
  const [open, setOpen] = useState(false);
  const tickedCount = cls.items.filter((i) => i.included).length;
  const totalCount = cls.items.length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 rounded-lg"
      >
        <div className="flex items-center gap-2">
          <Plus
            className={cn(
              'h-4 w-4 text-gray-500 transition-transform',
              open && 'rotate-45',
            )}
          />
          <span className="text-sm font-medium text-gray-900">{cls.label}</span>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
              tone,
            )}
          >
            {cls.liquidity}
          </span>
          <span className="text-[11px] text-gray-500">
            {tickedCount} / {totalCount} selected
          </span>
        </div>
        <span className="font-mono text-sm font-semibold text-gray-700">
          {formatCompact(cls.includedSumPaisa)}
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1">
          {cls.basis && (
            <p className="text-[11px] text-gray-500 italic mb-1">{cls.basis}</p>
          )}
          {cls.items.length === 0 && (
            <p className="text-[11px] text-gray-500 italic">
              No matching items found. Update the underlying records to surface
              them here.
            </p>
          )}
          {cls.items.map((it) => {
            const key = `${cls.assetClass}:${it.id}`;
            const isToggling = togglingKey === key;
            return (
              <label
                key={it.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
                  it.included ? 'bg-blue-50' : 'hover:bg-gray-50',
                  isToggling && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={it.included}
                    disabled={isToggling}
                    onChange={(e) => onToggleItem(it.id, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900 truncate">{it.label}</p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {it.sublabel && <>{it.sublabel} · </>}
                      {it.maturityDate ? (
                        <>
                          matures{' '}
                          {new Date(it.maturityDate).toLocaleDateString('en-IN', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </>
                      ) : (
                        'no maturity date'
                      )}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-sm font-semibold text-gray-700 shrink-0">
                  {formatCompact(it.valuePaisa)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Helper functions
function periodToMonthInput(period: string): string {
  if (!period || period.length !== 6) return '';
  const month = period.substring(0, 2);
  const year = period.substring(2, 6);
  return `${year}-${month}`;
}

function monthInputToPeriod(monthInput: string): string {
  if (!monthInput) return getCurrentPeriod();
  const [year, month] = monthInput.split('-');
  return `${month}${year}`;
}
