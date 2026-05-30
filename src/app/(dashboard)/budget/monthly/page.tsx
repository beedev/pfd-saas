'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, X, Check, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatPeriodShort,
  addMonthsToPeriod,
  getCurrentPeriod,
} from '@/lib/finance/amount';
import { cn } from '@/lib/utils';

type RowStatus = 'paid' | 'unpaid' | 'partial';
type RowSource = 'cc' | 'sip' | 'chit' | 'manual';

interface MonthlyRow {
  categoryId: number;
  categoryName: string;
  categoryType: 'INCOME' | 'EXPENSE';
  plannedAmount: number;
  actualAmount: number;
  status: RowStatus | null;
  source: RowSource;
  recurringId: number | null;
  recurrence: string | null;
}

interface BudgetCategory {
  id: number;
  name: string;
  type: 'INCOME' | 'EXPENSE';
}

const RECURRENCE_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Every 3 months' },
  { value: 'ANNUALLY', label: 'Yearly' },
] as const;

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paisa / 100,
  );

export default function MonthlyExpensesPage() {
  const [period, setPeriod] = useState<string>(() => getCurrentPeriod());
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [recurringRow, setRecurringRow] = useState<MonthlyRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [monthlyRes, catsRes] = await Promise.all([
        fetch(`/api/finance/budget/monthly?period=${period}`),
        fetch('/api/finance/budget'),
      ]);
      const monthly = await monthlyRes.json();
      const cats = await catsRes.json();
      setRows(monthly.rows || []);
      setCategories(cats.categories || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load monthly view');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const togglePaid = async (row: MonthlyRow) => {
    if (row.source !== 'manual') {
      toast.info(`${row.categoryName} status is auto-tracked from ${row.source.toUpperCase()} data`);
      return;
    }
    try {
      const r = await fetch('/api/finance/budget/monthly/toggle-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: row.categoryId, period }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      toast.success(data.paid ? `${row.categoryName} marked paid` : `${row.categoryName} unmarked`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to toggle');
    }
  };

  const editActual = async (row: MonthlyRow, newAmountRupees: number) => {
    if (row.source !== 'manual') {
      toast.info(`${row.categoryName} actual is auto-tracked`);
      return;
    }
    try {
      const r = await fetch('/api/finance/budget/monthly/toggle-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: row.categoryId, period, actualAmountRupees: newAmountRupees }),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data?.error || 'Failed');
      }
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const editPlanned = async (row: MonthlyRow, newPlannedRupees: number) => {
    try {
      const r = await fetch('/api/finance/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: row.categoryId,
          period,
          plannedAmount: Math.round(newPlannedRupees * 100),
          actualAmount: row.source === 'manual' ? row.actualAmount : undefined,
        }),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data?.error || 'Failed');
      }
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const incomeRows = useMemo(() => rows.filter((r) => r.categoryType === 'INCOME'), [rows]);
  const expenseRows = useMemo(() => rows.filter((r) => r.categoryType === 'EXPENSE'), [rows]);

  const totalPlanned = expenseRows.reduce((s, r) => s + r.plannedAmount, 0);
  const totalPaid = expenseRows.reduce((s, r) => s + (r.status === 'paid' || r.status === 'partial' ? r.actualAmount : 0), 0);
  const paidPct = totalPlanned > 0 ? Math.round((totalPaid / totalPlanned) * 100) : 0;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Expenses</h1>
          <p className="text-sm text-gray-500">Mark expenses paid, manage recurring entries</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Expense
        </button>
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-white p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPeriod(addMonthsToPeriod(period, -1))}
            className="rounded border p-1 hover:bg-gray-50"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] text-center text-sm font-bold text-gray-900">
            {formatPeriodShort(period)}
          </span>
          <button
            onClick={() => setPeriod(addMonthsToPeriod(period, 1))}
            className="rounded border p-1 hover:bg-gray-50"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="text-xs text-gray-600">
          Paid: <span className="font-bold text-emerald-700">{formatINR(totalPaid)}</span> /{' '}
          <span className="font-bold">{formatINR(totalPlanned)}</span> ({paidPct}%)
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {incomeRows.length > 0 && (
            <RowGroup
              title="INCOME"
              rows={incomeRows}
              onToggle={togglePaid}
              onEditActual={editActual}
              onEditPlanned={editPlanned}
              onEditRecurring={(row) => setRecurringRow(row)}
            />
          )}
          <RowGroup
            title="EXPENSES"
            rows={expenseRows}
            onToggle={togglePaid}
            onEditActual={editActual}
            onEditPlanned={editPlanned}
            onEditRecurring={(row) => setRecurringRow(row)}
          />
        </>
      )}

      {showAddModal && (
        <AddExpenseModal
          period={period}
          categories={categories}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            load();
          }}
        />
      )}

      {recurringRow && (
        <ManageRecurringModal
          row={recurringRow}
          period={period}
          onClose={() => setRecurringRow(null)}
          onSaved={() => {
            setRecurringRow(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function RowGroup({
  title,
  rows,
  onToggle,
  onEditActual,
  onEditPlanned,
  onEditRecurring,
}: {
  title: string;
  rows: MonthlyRow[];
  onToggle: (row: MonthlyRow) => void;
  onEditActual: (row: MonthlyRow, amountRupees: number) => void;
  onEditPlanned: (row: MonthlyRow, amountRupees: number) => void;
  onEditRecurring: (row: MonthlyRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b bg-gray-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-gray-700">
        {title}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-600">
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th className="px-3 py-2 text-right font-medium">Planned</th>
            <th className="px-3 py-2 text-right font-medium">Actual</th>
            <th className="px-3 py-2 text-center font-medium">Status</th>
            <th className="px-3 py-2 text-center font-medium">Recurring</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-500">
                No entries this month
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <Row
              key={row.categoryId}
              row={row}
              onToggle={onToggle}
              onEditActual={onEditActual}
              onEditPlanned={onEditPlanned}
              onEditRecurring={onEditRecurring}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  row,
  onToggle,
  onEditActual,
  onEditPlanned,
  onEditRecurring,
}: {
  row: MonthlyRow;
  onToggle: (row: MonthlyRow) => void;
  onEditActual: (row: MonthlyRow, amountRupees: number) => void;
  onEditPlanned: (row: MonthlyRow, amountRupees: number) => void;
  onEditRecurring: (row: MonthlyRow) => void;
}) {
  const [editingActual, setEditingActual] = useState(false);
  const [editingPlanned, setEditingPlanned] = useState(false);
  const [actualInput, setActualInput] = useState((row.actualAmount / 100).toFixed(0));
  const [plannedInput, setPlannedInput] = useState((row.plannedAmount / 100).toFixed(0));

  useEffect(() => {
    setActualInput((row.actualAmount / 100).toFixed(0));
  }, [row.actualAmount]);

  useEffect(() => {
    setPlannedInput((row.plannedAmount / 100).toFixed(0));
  }, [row.plannedAmount]);

  const statusBadge =
    row.status === 'paid' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        ● Paid
      </span>
    ) : row.status === 'partial' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
        ● Partial
      </span>
    ) : row.status === 'unpaid' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
        ● Pending
      </span>
    ) : (
      <span className="text-xs text-gray-400">—</span>
    );

  const sourceBadge =
    row.source === 'cc' ? (
      <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-600">CC</span>
    ) : row.source === 'sip' ? (
      <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-600">auto</span>
    ) : row.source === 'chit' ? (
      <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-600">auto</span>
    ) : null;

  const canEditActual = row.source === 'manual';
  // Planned is editable for ALL categories (CC/SIP/Chit users may want to set
  // a planned/budget amount even though actual is auto-tracked).
  const canEditPlanned = true;

  const commitActual = () => {
    const num = Number(actualInput);
    if (!Number.isFinite(num) || num < 0) {
      setActualInput((row.actualAmount / 100).toFixed(0));
      setEditingActual(false);
      return;
    }
    onEditActual(row, num);
    setEditingActual(false);
  };

  const commitPlanned = () => {
    const num = Number(plannedInput);
    if (!Number.isFinite(num) || num < 0) {
      setPlannedInput((row.plannedAmount / 100).toFixed(0));
      setEditingPlanned(false);
      return;
    }
    onEditPlanned(row, num);
    setEditingPlanned(false);
  };

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-sm">
        <span className="font-medium text-gray-900">{row.categoryName}</span>
        {sourceBadge}
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm">
        {editingPlanned ? (
          <input
            type="number"
            value={plannedInput}
            onChange={(e) => setPlannedInput(e.target.value)}
            onBlur={commitPlanned}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPlanned();
              if (e.key === 'Escape') {
                setPlannedInput((row.plannedAmount / 100).toFixed(0));
                setEditingPlanned(false);
              }
            }}
            autoFocus
            className="w-24 rounded border border-blue-400 px-2 py-0.5 text-right text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <span
            onClick={() => canEditPlanned && setEditingPlanned(true)}
            className="inline-block min-w-[60px] cursor-text rounded px-1 text-gray-900 hover:bg-blue-50"
            title="Click to edit planned amount"
          >
            {row.plannedAmount > 0 ? formatINR(row.plannedAmount) : '—'}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-sm">
        {editingActual && canEditActual ? (
          <input
            type="number"
            value={actualInput}
            onChange={(e) => setActualInput(e.target.value)}
            onBlur={commitActual}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitActual();
              if (e.key === 'Escape') {
                setActualInput((row.actualAmount / 100).toFixed(0));
                setEditingActual(false);
              }
            }}
            autoFocus
            className="w-24 rounded border border-blue-400 px-2 py-0.5 text-right text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <span
            onClick={() => canEditActual && setEditingActual(true)}
            className={cn(
              'inline-block min-w-[60px]',
              canEditActual && 'cursor-text rounded px-1 hover:bg-blue-50',
              row.actualAmount > 0 ? 'text-gray-900' : 'text-gray-400',
            )}
            title={canEditActual ? 'Click to edit actual amount' : 'Auto-tracked from source'}
          >
            {row.actualAmount > 0 ? formatINR(row.actualAmount) : '—'}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {canEditActual ? (
          <button
            onClick={() => onToggle(row)}
            className={cn(
              'rounded px-2 py-0.5 hover:opacity-80',
              row.status === 'paid' || row.status === 'partial' ? '' : 'cursor-pointer',
            )}
            title={
              row.status === 'paid' || row.status === 'partial'
                ? 'Click to unmark'
                : 'Click to mark paid (sets actual = planned)'
            }
          >
            {statusBadge}
          </button>
        ) : (
          statusBadge
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <button
          onClick={() => onEditRecurring(row)}
          className="rounded px-2 py-0.5 hover:bg-blue-50"
          title={row.recurringId ? 'Click to manage recurring' : 'Click to set recurring'}
        >
          {row.recurringId ? (
            <span className="inline-flex items-center gap-1 text-xs text-gray-700">
              <Repeat className="h-3 w-3" />{' '}
              {row.recurrence?.[0]}
              {row.recurrence?.slice(1).toLowerCase()}
            </span>
          ) : (
            <span className="text-xs text-blue-600 hover:underline">+ Set</span>
          )}
        </button>
      </td>
    </tr>
  );
}

function AddExpenseModal({
  period,
  categories,
  onClose,
  onSaved,
}: {
  period: string;
  categories: BudgetCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryType, setCategoryType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'>('MONTHLY');
  const [endPeriod, setEndPeriod] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amtNum = Number(amount);
    if (!amtNum || amtNum <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    let finalCategoryId = categoryId;
    if (creatingCategory) {
      if (!newCategoryName.trim()) {
        toast.error('Category name required');
        return;
      }
      try {
        const r = await fetch('/api/finance/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newCategoryName.trim(), type: categoryType }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Failed to create category');
        finalCategoryId = data.category.id;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create category');
        return;
      }
    }

    if (typeof finalCategoryId !== 'number') {
      toast.error('Pick a category');
      return;
    }

    setSaving(true);
    try {
      if (recurring) {
        const r = await fetch('/api/finance/budget/recurring', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId: finalCategoryId,
            amountRupees: amtNum,
            recurrence: recurrenceType,
            startPeriod: period,
            endPeriod: endPeriod || null,
            notes: notes || null,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Failed');
        toast.success(`Recurring expense added for ${data.created} period(s)`);
      } else {
        const r = await fetch('/api/finance/budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId: finalCategoryId,
            period,
            plannedAmount: Math.round(amtNum * 100),
            actualAmount: 0,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Failed');
        toast.success('Expense added');
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Add Expense</h3>
          <button onClick={onClose} disabled={saving} className="rounded p-1 hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
              Category
            </label>
            {creatingCategory ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="New category name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                <select
                  value={categoryType}
                  onChange={(e) => setCategoryType(e.target.value as 'EXPENSE' | 'INCOME')}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
                <button
                  onClick={() => {
                    setCreatingCategory(false);
                    setNewCategoryName('');
                  }}
                  className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={categoryId === '' ? '' : String(categoryId)}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">Select…</option>
                  <optgroup label="Expense">
                    {categories
                      .filter((c) => c.type === 'EXPENSE')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Income">
                    {categories
                      .filter((c) => c.type === 'INCOME')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
                <button
                  onClick={() => setCreatingCategory(true)}
                  className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                >
                  + New
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
              Amount (₹)
            </label>
            <input
              type="number"
              placeholder="e.g. 25000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Recurring expense (repeats automatically)
            </label>
            {recurring && (
              <div className="mt-3 space-y-2 pl-6">
                <div>
                  <label className="mb-1 block text-xs text-gray-700">Frequency</label>
                  <select
                    value={recurrenceType}
                    onChange={(e) => setRecurrenceType(e.target.value as typeof recurrenceType)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    {RECURRENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-700">
                    Ends (leave blank for ‘until I cancel’)
                  </label>
                  <input
                    type="text"
                    placeholder="MMYYYY (e.g. 122027)"
                    value={endPeriod}
                    onChange={(e) => setEndPeriod(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  <p className="mt-1 text-[10px] text-gray-500">
                    Starts {period}. Generates entries from there onwards.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            <Check className="h-3 w-3" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageRecurringModal({
  row,
  period,
  onClose,
  onSaved,
}: {
  row: MonthlyRow;
  period: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const hasTemplate = row.recurringId != null;
  const [amount, setAmount] = useState((row.plannedAmount / 100).toFixed(0));
  const [recurrenceType, setRecurrenceType] = useState<'MONTHLY' | 'QUARTERLY' | 'ANNUALLY'>(
    (row.recurrence as 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY') || 'MONTHLY',
  );
  const [endPeriod, setEndPeriod] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const amtNum = Number(amount);
    if (!amtNum || amtNum <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setSaving(true);
    try {
      // If a template exists, soft-delete it first (then create fresh).
      if (hasTemplate && row.recurringId) {
        const del = await fetch(`/api/finance/budget/recurring?id=${row.recurringId}`, {
          method: 'DELETE',
        });
        if (!del.ok) throw new Error('Failed to remove old recurring');
      }
      const r = await fetch('/api/finance/budget/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: row.categoryId,
          amountRupees: amtNum,
          recurrence: recurrenceType,
          startPeriod: period,
          endPeriod: endPeriod || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      toast.success(`Recurring ${recurrenceType.toLowerCase()} set for ${row.categoryName}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const stop = async () => {
    if (!row.recurringId) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/finance/budget/recurring?id=${row.recurringId}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('Failed to stop');
      toast.success(`Stopped recurring for ${row.categoryName}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to stop');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">
            {hasTemplate ? 'Manage Recurring' : 'Set Recurring'} — {row.categoryName}
          </h3>
          <button onClick={onClose} disabled={saving} className="rounded p-1 hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
              Amount (₹) per occurrence
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
              Frequency
            </label>
            <select
              value={recurrenceType}
              onChange={(e) => setRecurrenceType(e.target.value as typeof recurrenceType)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            >
              {RECURRENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">
              Ends (leave blank for ‘until I cancel’)
            </label>
            <input
              type="text"
              placeholder="MMYYYY (e.g. 122027)"
              value={endPeriod}
              onChange={(e) => setEndPeriod(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <p className="mt-1 text-[10px] text-gray-500">
              Starts {period}. Generates entries from there onwards.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-between gap-2">
          <div>
            {hasTemplate && (
              <button
                onClick={stop}
                disabled={saving}
                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
              >
                Stop Recurring
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              <Check className="h-3 w-3" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
