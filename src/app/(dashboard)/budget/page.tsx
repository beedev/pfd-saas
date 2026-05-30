'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EditableGrid, GridColumn, GridRow, CellValue } from '@/components/finance/editable-grid';
import { formatPeriodShort, addMonthsToPeriod, getCurrentPeriod } from '@/lib/finance/amount';
import { ChevronLeft, ChevronRight, Loader2, Plus, X, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BudgetCategory {
  id: number;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  sortOrder: number;
}

interface BudgetEntry {
  id: number;
  categoryId: number;
  period: string;
  plannedAmount: number;
  actualAmount: number;
  notes?: string;
}

const MONTHS_TO_SHOW = 6;

export default function BudgetPage() {
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [cardStatuses, setCardStatuses] = useState<Record<string, Record<string, 'paid' | 'unpaid' | 'partial'>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startPeriod, setStartPeriod] = useState(() => {
    return getCurrentPeriod();
  });

  // Carry forward per period
  const [carryForward, setCarryForward] = useState<Record<string, number>>({});

  // New category state
  const [addingCategory, setAddingCategory] = useState<'INCOME' | 'EXPENSE' | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const newCategoryInputRef = useRef<HTMLInputElement>(null);

  // Focus input when adding category
  useEffect(() => {
    if (addingCategory && newCategoryInputRef.current) {
      newCategoryInputRef.current.focus();
    }
  }, [addingCategory]);

  // Generate the periods to display
  const periods = useMemo(() => {
    const result: string[] = [];
    let current = startPeriod;
    for (let i = 0; i < MONTHS_TO_SHOW; i++) {
      result.push(current);
      current = addMonthsToPeriod(current, 1);
    }
    return result;
  }, [startPeriod]);

  const endPeriod = periods[periods.length - 1];

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetRes, cfRes] = await Promise.all([
        fetch(`/api/finance/budget?from=${startPeriod}&to=${endPeriod}`),
        fetch(`/api/finance/budget/carry-forward?periods=${periods.join(',')}`),
      ]);
      const data = await budgetRes.json();
      const cfData = await cfRes.json();
      setCategories(data.categories || []);
      setEntries(data.entries || []);
      setCardStatuses(data.cardStatuses || {});
      const cfMap: Record<string, number> = {};
      for (const cf of cfData.carryForward || []) {
        cfMap[cf.period] = cf.amount;
      }
      setCarryForward(cfMap);
    } catch (error) {
      console.error('Error fetching budget data:', error);
    } finally {
      setLoading(false);
    }
  }, [startPeriod, endPeriod, periods]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveCarryForward = useCallback(async (period: string, amountPaisa: number) => {
    try {
      await fetch('/api/finance/budget/carry-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, amount: amountPaisa / 100 }),
      });
      setCarryForward((prev) => ({ ...prev, [period]: amountPaisa }));
    } catch (error) {
      console.error('Error saving carry forward:', error);
    }
  }, []);

  // Navigate months
  const goToPrevious = () => {
    setStartPeriod(prev => addMonthsToPeriod(prev, -MONTHS_TO_SHOW));
  };

  const goToNext = () => {
    setStartPeriod(prev => addMonthsToPeriod(prev, MONTHS_TO_SHOW));
  };

  // Add new category
  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !addingCategory) return;

    setSaving(true);
    try {
      const response = await fetch('/api/finance/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          type: addingCategory,
        }),
      });

      if (response.ok) {
        const newCategory = await response.json();
        setCategories(prev => [...prev, newCategory]);
        setNewCategoryName('');
        setAddingCategory(null);
      }
    } catch (error) {
      console.error('Error adding category:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelAddCategory = () => {
    setNewCategoryName('');
    setAddingCategory(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddCategory();
    } else if (e.key === 'Escape') {
      handleCancelAddCategory();
    }
  };

  // Delete category
  const handleDeleteCategory = async (categoryId: number, categoryName: string) => {
    if (!confirm(`Delete "${categoryName}"? This will remove all budget entries for this category.`)) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/finance/categories/${categoryId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setCategories(prev => prev.filter(c => c.id !== categoryId));
        setEntries(prev => prev.filter(e => e.categoryId !== categoryId));
      } else {
        console.error('Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
    } finally {
      setSaving(false);
    }
  };

  // Build columns: Label + one column per month
  const columns: GridColumn[] = useMemo(() => {
    const cols: GridColumn[] = [
      { id: 'label', header: 'Category', width: 150, editable: false, type: 'readonly' },
    ];

    periods.forEach(period => {
      cols.push({
        id: period,
        header: formatPeriodShort(period),
        width: 90,
        editable: true,
        type: 'amount',
      });
    });

    return cols;
  }, [periods]);

  // Build rows: Income header + income categories + Expenses header + expense categories + Totals
  const rows: GridRow[] = useMemo(() => {
    const incomeCategories = categories.filter(c => c.type === 'INCOME');
    const expenseCategories = categories.filter(c => c.type === 'EXPENSE');

    const result: GridRow[] = [];

    // Income section
    result.push({ id: 'income-header', label: 'INCOME', type: 'header' });
    incomeCategories.forEach(cat => {
      result.push({ id: `cat-${cat.id}`, label: cat.name, type: 'data' });
    });

    // Expense section
    result.push({ id: 'expense-header', label: 'EXPENSES', type: 'header' });
    expenseCategories.forEach(cat => {
      result.push({ id: `cat-${cat.id}`, label: cat.name, type: 'data' });
    });

    // Totals
    result.push({ id: 'total-expense', label: 'Total Expenses', type: 'total' });
    result.push({ id: 'savings', label: 'SAVINGS', type: 'total', className: 'font-bold' });

    return result;
  }, [categories]);

  // Build data map
  const data: Map<string, CellValue> = useMemo(() => {
    const map = new Map<string, CellValue>();

    // Populate category data
    categories.forEach(cat => {
      const rowId = `cat-${cat.id}`;

      periods.forEach(period => {
        const entry = entries.find(e => e.categoryId === cat.id && e.period === period);
        const status = cardStatuses[period]?.[cat.name];
        map.set(`${rowId}-${period}`, {
          rowId,
          columnId: period,
          value: entry?.plannedAmount ?? 0,
          status,
        });
      });
    });

    // Calculate totals
    const incomeCategories = categories.filter(c => c.type === 'INCOME');
    const expenseCategories = categories.filter(c => c.type === 'EXPENSE');

    periods.forEach(period => {
      let totalIncome = 0;
      incomeCategories.forEach(cat => {
        const entry = entries.find(e => e.categoryId === cat.id && e.period === period);
        totalIncome += entry?.plannedAmount ?? 0;
      });

      let totalExpense = 0;
      expenseCategories.forEach(cat => {
        const entry = entries.find(e => e.categoryId === cat.id && e.period === period);
        totalExpense += entry?.plannedAmount ?? 0;
      });

      map.set(`total-expense-${period}`, {
        rowId: 'total-expense',
        columnId: period,
        value: totalExpense,
      });

      map.set(`savings-${period}`, {
        rowId: 'savings',
        columnId: period,
        value: totalIncome - totalExpense,
      });
    });

    return map;
  }, [categories, entries, periods, cardStatuses]);

  // Handle cell change - update local state and save to server
  const handleCellChange = useCallback(async (rowId: string, columnId: string, value: number | string | null) => {
    const categoryIdMatch = rowId.match(/^cat-(\d+)$/);
    if (!categoryIdMatch) {
      console.log('Invalid rowId:', rowId);
      return;
    }

    const categoryId = parseInt(categoryIdMatch[1], 10);
    const period = columnId;
    const amount = value as number;

    // Update local state immediately
    setEntries(prev => {
      const existing = prev.find(e => e.categoryId === categoryId && e.period === period);
      if (existing) {
        return prev.map(e =>
          e.categoryId === categoryId && e.period === period
            ? { ...e, plannedAmount: amount }
            : e
        );
      } else {
        return [
          ...prev,
          {
            id: Date.now(),
            categoryId,
            period,
            plannedAmount: amount,
            actualAmount: 0,
          },
        ];
      }
    });

    // Save to server
    setSaving(true);
    try {
      const response = await fetch('/api/finance/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          period,
          plannedAmount: amount,
          actualAmount: amount,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('API Error:', error);
      } else {
        console.log('Saved successfully');
      }
    } catch (error) {
      console.error('Error saving budget entry:', error);
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const incomeCategories = categories.filter(c => c.type === 'INCOME');
  const expenseCategories = categories.filter(c => c.type === 'EXPENSE');

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budget Tracker</h1>
          <p className="text-sm text-gray-500 mt-1">
            Click any cell to edit. Tab to move right, Enter to move down.
          </p>
        </div>

        {/* Period navigation */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToPrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-gray-700 min-w-[180px] text-center">
            {formatPeriodShort(startPeriod)} - {formatPeriodShort(endPeriod)}
          </span>
          <Button variant="outline" size="sm" onClick={goToNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status indicator */}
      {saving && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Saving...
        </div>
      )}

      {/* Budget Table */}
      <div className="overflow-auto border border-gray-300 rounded-lg">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-800 text-white">
              <th className="px-3 py-2 text-xs font-semibold text-left border-b border-gray-600 sticky left-0 z-20 bg-gray-800" style={{ width: 150, minWidth: 150 }}>
                Category
              </th>
              {periods.map(period => (
                <th key={period} className="px-3 py-2 text-xs font-semibold text-right border-b border-gray-600" style={{ width: 90, minWidth: 90 }}>
                  {formatPeriodShort(period)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Carry Forward Row */}
            <CarryForwardRow
              periods={periods}
              carryForward={carryForward}
              onSave={saveCarryForward}
            />

            {/* Income Header */}
            <tr className="bg-gray-100">
              <td colSpan={periods.length + 1} className="px-3 py-2 text-xs font-bold text-gray-700">
                INCOME
              </td>
            </tr>

            {/* Income Categories */}
            {incomeCategories.map(cat => (
              <CategoryRow
                key={cat.id}
                category={cat}
                periods={periods}
                entries={entries}
                cardStatuses={cardStatuses}
                onCellChange={handleCellChange}
                onDelete={handleDeleteCategory}
              />
            ))}

            {/* Add Income Row */}
            <tr className="hover:bg-gray-50">
              <td colSpan={periods.length + 1} className="px-3 py-1 border-b border-gray-200">
                {addingCategory === 'INCOME' ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={newCategoryInputRef}
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Category name..."
                      className="flex-1 px-2 py-1 text-xs border border-blue-400 rounded outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleAddCategory}
                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleCancelAddCategory}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingCategory('INCOME')}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    <Plus className="h-3 w-3" />
                    Add Income
                  </button>
                )}
              </td>
            </tr>

            {/* Expense Header */}
            <tr className="bg-gray-100">
              <td colSpan={periods.length + 1} className="px-3 py-2 text-xs font-bold text-gray-700">
                EXPENSES
              </td>
            </tr>

            {/* Expense Categories */}
            {expenseCategories.map(cat => (
              <CategoryRow
                key={cat.id}
                category={cat}
                periods={periods}
                entries={entries}
                cardStatuses={cardStatuses}
                onCellChange={handleCellChange}
                onDelete={handleDeleteCategory}
              />
            ))}

            {/* Add Expense Row */}
            <tr className="hover:bg-gray-50">
              <td colSpan={periods.length + 1} className="px-3 py-1 border-b border-gray-200">
                {addingCategory === 'EXPENSE' ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={newCategoryInputRef}
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Category name..."
                      className="flex-1 px-2 py-1 text-xs border border-blue-400 rounded outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleAddCategory}
                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleCancelAddCategory}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingCategory('EXPENSE')}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    <Plus className="h-3 w-3" />
                    Add Expense
                  </button>
                )}
              </td>
            </tr>

            {/* Total Expenses */}
            <tr className="bg-gray-50 font-bold border-t-2 border-gray-300">
              <td className="px-3 py-2 text-xs sticky left-0 bg-gray-50">Total Expenses</td>
              {periods.map(period => {
                const total = expenseCategories.reduce((sum, cat) => {
                  const entry = entries.find(e => e.categoryId === cat.id && e.period === period);
                  return sum + (entry?.plannedAmount ?? 0);
                }, 0);
                return (
                  <td key={period} className="px-3 py-2 text-xs text-right font-mono">
                    {formatAmount(total)}
                  </td>
                );
              })}
            </tr>

            {/* Savings (Income + Carry Forward - Expenses) */}
            <tr className="bg-blue-50 font-bold">
              <td className="px-3 py-2 text-xs sticky left-0 bg-blue-50">SAVINGS</td>
              {periods.map(period => {
                const cf = carryForward[period] ?? 0;
                const totalIncome = incomeCategories.reduce((sum, cat) => {
                  const entry = entries.find(e => e.categoryId === cat.id && e.period === period);
                  return sum + (entry?.plannedAmount ?? 0);
                }, 0);
                const totalExpense = expenseCategories.reduce((sum, cat) => {
                  const entry = entries.find(e => e.categoryId === cat.id && e.period === period);
                  return sum + (entry?.plannedAmount ?? 0);
                }, 0);
                const savings = cf + totalIncome - totalExpense;
                return (
                  <td key={period} className={cn(
                    'px-3 py-2 text-xs text-right font-mono',
                    savings >= 0 ? 'text-green-700' : 'text-red-600'
                  )}>
                    {formatAmount(savings)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Category Row Component with inline editing
function CategoryRow({
  category,
  periods,
  entries,
  cardStatuses,
  onCellChange,
  onDelete,
}: {
  category: BudgetCategory;
  periods: string[];
  entries: BudgetEntry[];
  cardStatuses: Record<string, Record<string, 'paid' | 'unpaid' | 'partial'>>;
  onCellChange: (rowId: string, columnId: string, value: number | string | null) => void;
  onDelete: (categoryId: number, categoryName: string) => void;
}) {
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // Track locally committed values to show immediately before parent re-renders
  const [localValues, setLocalValues] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  // Get value for a period - use local value if exists, otherwise from entries prop
  const getValue = (period: string): number => {
    if (period in localValues) {
      return localValues[period];
    }
    const entry = entries.find(e => e.categoryId === category.id && e.period === period);
    return entry?.plannedAmount ?? 0;
  };


  const startEditing = (period: string, currentValue: number) => {
    setEditingCell(period);
    setEditValue(currentValue ? formatEditValue(currentValue) : '');
  };

  const commitEdit = (period: string) => {
    const amount = parseAmount(editValue);
    console.log('CategoryRow commitEdit:', { categoryId: category.id, period, editValue, amount });

    // Update local value immediately for instant UI feedback
    setLocalValues(prev => ({ ...prev, [period]: amount }));

    // Notify parent to save to server
    onCellChange(`cat-${category.id}`, period, amount);

    setEditingCell(null);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, period: string) => {
    if (e.key === 'Enter') {
      commitEdit(period);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit(period);
      // Move to next cell
      const periodIndex = periods.indexOf(period);
      if (periodIndex < periods.length - 1) {
        const nextPeriod = periods[periodIndex + 1];
        startEditing(nextPeriod, getValue(nextPeriod));
      }
    }
  };

  return (
    <tr className="hover:bg-gray-50 group">
      <td className="px-3 py-1 text-xs font-medium border-b border-gray-200 bg-white sticky left-0">
        <div className="flex items-center justify-between">
          <span>{category.name}</span>
          <button
            onClick={() => onDelete(category.id, category.name)}
            className="p-0.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete category"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
      {periods.map(period => {
        const planned = getValue(period);
        const isEditing = editingCell === period;
        const status = cardStatuses[period]?.[category.name];
        // Pull actualAmount from the source entry (not affected by localValues
        // overrides since localValues only tracks planned).
        const sourceEntry = entries.find(e => e.categoryId === category.id && e.period === period);
        const actual = sourceEntry?.actualAmount ?? 0;
        // For partial cells, show the actual paid amount; otherwise show planned.
        const value = status === 'partial' ? actual : planned;
        const statusClass =
          status === 'paid'
            ? 'bg-emerald-100 text-emerald-900 font-semibold border-l-4 border-l-emerald-500'
            : status === 'unpaid'
              ? 'bg-amber-100 text-amber-900 font-semibold border-l-4 border-l-amber-500'
              : status === 'partial'
                ? 'bg-sky-100 text-sky-900 font-semibold border-l-4 border-l-sky-500'
                : '';
        const statusTitle =
          status === 'paid'
            ? `Paid in full · ₹${(actual / 100).toLocaleString('en-IN')}`
            : status === 'unpaid'
              ? `Pending · planned ₹${(planned / 100).toLocaleString('en-IN')}`
              : status === 'partial'
                ? `Partial · paid ₹${(actual / 100).toLocaleString('en-IN')} of ₹${(planned / 100).toLocaleString('en-IN')}`
                : undefined;

        return (
          <td
            key={period}
            className="px-0 py-0 border-b border-gray-200"
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(period)}
                onKeyDown={(e) => handleKeyDown(e, period)}
                className="w-full h-full px-3 py-1 text-xs text-right font-mono border-2 border-blue-500 outline-none"
              />
            ) : (
              <div
                onClick={() => startEditing(period, planned)}
                title={statusTitle}
                className={cn(
                  'px-3 py-1 text-xs text-right font-mono cursor-cell hover:bg-blue-50 transition-colors',
                  value < 0 && 'text-red-600',
                  statusClass
                )}
              >
                {formatAmount(value)}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// Format amount for display (paisa to formatted string)
function formatAmount(paisa: number): string {
  if (paisa === 0) return '-';
  const rupees = paisa / 100;
  if (Math.abs(rupees) >= 100000) {
    return `${(rupees / 100000).toFixed(1)}L`;
  } else if (Math.abs(rupees) >= 1000) {
    return `${(rupees / 1000).toFixed(0)}K`;
  }
  return rupees.toLocaleString('en-IN');
}

// Format amount for editing
function formatEditValue(paisa: number): string {
  if (paisa === 0) return '';
  const rupees = paisa / 100;
  if (rupees >= 100000) {
    return `${(rupees / 100000).toFixed(1)}L`;
  } else if (rupees >= 1000) {
    return `${(rupees / 1000).toFixed(0)}K`;
  }
  return rupees.toString();
}

// Parse amount input (supports K, L suffixes)
function parseAmount(input: string): number {
  if (!input || input.trim() === '') return 0;

  const cleaned = input.trim().toUpperCase().replace(/,/g, '');
  let multiplier = 100; // Convert to paisa
  let numStr = cleaned;

  if (cleaned.endsWith('L')) {
    multiplier = 100 * 100000; // Lakhs to paisa
    numStr = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('K')) {
    multiplier = 100 * 1000; // Thousands to paisa
    numStr = cleaned.slice(0, -1);
  }

  const num = parseFloat(numStr);
  if (isNaN(num)) return 0;

  return Math.round(num * multiplier);
}

// Carry Forward Row — editable, one cell per period
function CarryForwardRow({
  periods,
  carryForward,
  onSave,
}: {
  periods: string[];
  carryForward: Record<string, number>;
  onSave: (period: string, amountPaisa: number) => void;
}) {
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const commitEdit = (period: string) => {
    const amount = parseAmount(editValue);
    onSave(period, amount);
    setEditingCell(null);
    setEditValue('');
  };

  return (
    <tr className="bg-purple-50 font-semibold">
      <td className="px-3 py-1 text-xs border-b border-purple-200 bg-purple-50 sticky left-0">
        Carry Forward
      </td>
      {periods.map((period) => {
        const value = carryForward[period] ?? 0;
        const isEditing = editingCell === period;
        return (
          <td key={period} className="px-0 py-0 border-b border-purple-200">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(period)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(period);
                  if (e.key === 'Escape') { setEditingCell(null); setEditValue(''); }
                }}
                className="w-full h-full px-3 py-1 text-xs text-right font-mono border-2 border-purple-500 outline-none"
              />
            ) : (
              <div
                onClick={() => {
                  setEditingCell(period);
                  setEditValue(value ? formatEditValue(value) : '');
                }}
                className="px-3 py-1 text-xs text-right font-mono cursor-cell hover:bg-purple-100 transition-colors text-purple-700"
              >
                {formatAmount(value)}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}
