import { NextRequest, NextResponse } from 'next/server';
import { db, budgetEntries, budgetCategories } from '@/db';
import { eq } from 'drizzle-orm';

// GET - Get budget-focused analytics data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedPeriod = searchParams.get('period'); // Optional: specific period for category breakdown

    const now = new Date();
    const currentPeriod = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear()}`;

    // Get all budget categories
    const categories = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.isActive, true));

    const incomeCategories = categories.filter(c => c.type === 'INCOME');
    const expenseCategories = categories.filter(c => c.type === 'EXPENSE');
    const incomeCategoryIds = incomeCategories.map(c => c.id);
    const expenseCategoryIds = expenseCategories.map(c => c.id);

    // Get last 12 months of budget entries
    // Note: We fetch all entries and filter in JS because MMYYYY format doesn't sort correctly as strings
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 11);
    const startPeriod = `${(startDate.getMonth() + 1).toString().padStart(2, '0')}${startDate.getFullYear()}`;

    const allEntries = await db
      .select()
      .from(budgetEntries);

    // Filter entries using proper period comparison (MMYYYY doesn't sort correctly as strings)
    const entries = allEntries.filter(entry => comparePeriods(entry.period, startPeriod) >= 0);

    // =========================================================================
    // 1. MONTHLY BUDGET TREND (Planned vs Actual for last 12 months)
    // =========================================================================

    const periodMap = new Map<string, {
      income: number;
      expense: number;
    }>();

    entries.forEach(entry => {
      if (!periodMap.has(entry.period)) {
        periodMap.set(entry.period, {
          income: 0,
          expense: 0,
        });
      }
      const data = periodMap.get(entry.period)!;

      if (incomeCategoryIds.includes(entry.categoryId)) {
        data.income += entry.plannedAmount || 0;
      } else if (expenseCategoryIds.includes(entry.categoryId)) {
        data.expense += entry.plannedAmount || 0;
      }
    });

    // Convert to array with calculated fields
    const monthlyTrend = Array.from(periodMap.entries())
      .sort(([a], [b]) => comparePeriods(a, b))
      .map(([period, data]) => {
        const cashflow = data.income - data.expense;

        return {
          period,
          month: formatPeriodLabel(period),
          income: data.income,
          expense: data.expense,
          cashflow,
        };
      });

    // =========================================================================
    // 2. SPEND BY CATEGORY (Selected month, current month, or most recent past month)
    // =========================================================================

    let categoryPeriod = currentPeriod;

    // If a specific period is requested, use that
    if (selectedPeriod && periodMap.has(selectedPeriod)) {
      categoryPeriod = selectedPeriod;
    } else {
      // Use current month if it has data, otherwise find most recent PAST month with data
      const currentMonthData = periodMap.get(currentPeriod);

      if (!currentMonthData || currentMonthData.expense === 0) {
        // Find most recent past month with expense data
        const pastPeriods = Array.from(periodMap.keys())
          .filter(p => comparePeriods(p, currentPeriod) < 0) // Only past months
          .sort((a, b) => comparePeriods(b, a)); // Most recent first

        for (const period of pastPeriods) {
          const data = periodMap.get(period)!;
          if (data.expense > 0) {
            categoryPeriod = period;
            break;
          }
        }
      }
    }

    const categoryEntries = entries.filter(e => e.period === categoryPeriod);
    const spendByCategory = expenseCategories.map(cat => {
      const entry = categoryEntries.find(e => e.categoryId === cat.id);
      const amount = entry?.plannedAmount || 0;

      return {
        id: cat.id,
        name: cat.name,
        amount,
      };
    }).filter(c => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // =========================================================================
    // 3. INCOME BY CATEGORY
    // =========================================================================

    const incomeByCategory = incomeCategories.map(cat => {
      const entry = categoryEntries.find(e => e.categoryId === cat.id);
      const amount = entry?.plannedAmount || 0;

      return {
        id: cat.id,
        name: cat.name,
        amount,
      };
    }).filter(c => c.amount > 0);

    // =========================================================================
    // 4. SUMMARY STATS
    // =========================================================================

    // Current month data
    const currentData = periodMap.get(currentPeriod) || {
      income: 0,
      expense: 0,
    };

    const currentIncome = currentData.income;
    const currentExpense = currentData.expense;
    const currentCashflow = currentIncome - currentExpense;

    // YTD calculations (only include current and past months of current year)
    const currentYear = now.getFullYear().toString();
    const ytdEntries = Array.from(periodMap.entries())
      .filter(([period]) => {
        const periodYear = period.substring(2, 6);
        // Must be current year AND not a future month
        return periodYear === currentYear && comparePeriods(period, currentPeriod) <= 0;
      });

    let ytdIncome = 0;
    let ytdExpense = 0;

    ytdEntries.forEach(([_, data]) => {
      ytdIncome += data.income;
      ytdExpense += data.expense;
    });

    const ytdCashflow = ytdIncome - ytdExpense;

    // Average monthly
    const monthsWithData = monthlyTrend.length || 1;
    const avgMonthlyIncome = Math.round(ytdIncome / monthsWithData);
    const avgMonthlyExpense = Math.round(ytdExpense / monthsWithData);
    const avgMonthlyCashflow = Math.round(ytdCashflow / monthsWithData);

    // Savings rate (cashflow as % of income)
    const savingsRate = ytdIncome > 0 ? Math.round((ytdCashflow / ytdIncome) * 100) : 0;

    // Expense ratio (expense as % of income)
    const expenseRatio = ytdIncome > 0 ? Math.round((ytdExpense / ytdIncome) * 100) : 0;

    // Get all available periods for the month selector (sorted newest first)
    const availablePeriods = Array.from(periodMap.keys())
      .sort((a, b) => comparePeriods(b, a));

    return NextResponse.json({
      monthlyTrend,
      spendByCategory,
      incomeByCategory,
      categoryPeriod,
      currentPeriod,
      availablePeriods,
      summary: {
        currentIncome,
        currentExpense,
        currentCashflow,
        ytdIncome,
        ytdExpense,
        ytdCashflow,
        avgMonthlyIncome,
        avgMonthlyExpense,
        avgMonthlyCashflow,
        savingsRate,
        expenseRatio,
      },
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}

// Helper to format period (MMYYYY) to readable label
function formatPeriodLabel(period: string): string {
  if (!period || period.length !== 6) return period;
  const month = parseInt(period.substring(0, 2), 10);
  const year = period.substring(4, 6);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[month - 1]} '${year}`;
}

// Helper to compare MMYYYY periods
function comparePeriods(a: string, b: string): number {
  const yearA = a.substring(2, 6);
  const monthA = a.substring(0, 2);
  const yearB = b.substring(2, 6);
  const monthB = b.substring(0, 2);
  if (yearA !== yearB) return yearA.localeCompare(yearB);
  return monthA.localeCompare(monthB);
}
