'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { formatCompact } from '@/lib/finance/amount';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Loader2,
  ArrowDownCircle,
  BarChart3,
  PieChart,
  Percent,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  PieChart as RechartsPieChart,
  Pie,
} from 'recharts';

interface MonthlyTrendItem {
  period: string;
  month: string;
  income: number;
  expense: number;
  cashflow: number;
}

interface CategorySpend {
  id: number;
  name: string;
  amount: number;
}

interface AnalyticsData {
  monthlyTrend: MonthlyTrendItem[];
  spendByCategory: CategorySpend[];
  incomeByCategory: { id: number; name: string; amount: number }[];
  categoryPeriod: string;
  currentPeriod: string;
  availablePeriods: string[];
  summary: {
    currentIncome: number;
    currentExpense: number;
    currentCashflow: number;
    ytdIncome: number;
    ytdExpense: number;
    ytdCashflow: number;
    avgMonthlyIncome: number;
    avgMonthlyExpense: number;
    avgMonthlyCashflow: number;
    savingsRate: number;
    expenseRatio: number;
  };
}

// Colors for pie chart
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'];

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const pathname = usePathname();

  const fetchData = useCallback(async (period?: string) => {
    setLoading(true);
    try {
      const url = period
        ? `/api/finance/analytics?period=${period}`
        : '/api/finance/analytics';
      const response = await fetch(url);
      const result = await response.json();
      setData(result);
      // Set selected period to match what the API returned
      if (!period) {
        setSelectedPeriod(result.categoryPeriod);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch when navigating to this page
  useEffect(() => {
    fetchData();
  }, [fetchData, pathname]);

  // Refetch when period changes
  const handlePeriodChange = (period: string) => {
    setSelectedPeriod(period);
    fetchData(period);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <p>Failed to load analytics data</p>
      </div>
    );
  }

  // Format chart data (convert paisa to rupees)
  const trendChartData = data.monthlyTrend.map(item => ({
    ...item,
    income: item.income / 100,
    expense: item.expense / 100,
    cashflow: item.cashflow / 100,
  }));

  // Pie chart data for spend by category
  const pieData = data.spendByCategory.map(cat => ({
    name: cat.name,
    value: cat.amount / 100,
  }));

  const totalExpense = data.spendByCategory.reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Budget Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">
          Track your budget and spending patterns
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          title="This Month"
          value={formatCompact(data.summary.currentCashflow)}
          subtitle={`${formatCompact(data.summary.currentIncome)} - ${formatCompact(data.summary.currentExpense)}`}
          icon={Wallet}
          positive={data.summary.currentCashflow >= 0}
        />
        <SummaryCard
          title="YTD Cashflow"
          value={formatCompact(data.summary.ytdCashflow)}
          subtitle={`Avg: ${formatCompact(data.summary.avgMonthlyCashflow)}/mo`}
          icon={data.summary.ytdCashflow >= 0 ? TrendingUp : TrendingDown}
          positive={data.summary.ytdCashflow >= 0}
        />
        <SummaryCard
          title="Savings Rate"
          value={`${data.summary.savingsRate}%`}
          subtitle={data.summary.savingsRate >= 10 ? 'Good' : 'Needs improvement'}
          icon={TrendingUp}
          positive={data.summary.savingsRate >= 10}
        />
        <SummaryCard
          title="Expense Ratio"
          value={`${data.summary.expenseRatio}%`}
          subtitle="of income spent"
          icon={Percent}
          positive={data.summary.expenseRatio <= 90}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Income vs Expense Trend */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            Income vs Expense
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => `${(value / 100000).toFixed(0)}L`}
                />
                <Tooltip
                  formatter={(value) => [`₹${(Number(value) || 0).toLocaleString('en-IN')}`, '']}
                  labelStyle={{ fontWeight: 'bold' }}
                />
                <Legend />
                <Bar dataKey="income" name="Income" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Cashflow Trend */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Monthly Cashflow
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => {
                    if (Math.abs(value) >= 100000) return `${(value / 100000).toFixed(0)}L`;
                    return `${(value / 1000).toFixed(0)}K`;
                  }}
                />
                <Tooltip
                  formatter={(value) => [`₹${(Number(value) || 0).toLocaleString('en-IN')}`, '']}
                  labelStyle={{ fontWeight: 'bold' }}
                />
                <Line
                  type="monotone"
                  dataKey="cashflow"
                  name="Cashflow"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ fill: '#3B82F6', r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Spend by Category Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pie Chart */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-purple-600" />
            Spend Distribution
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [`₹${(Number(value) || 0).toLocaleString('en-IN')}`, '']}
                />
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center mt-2">
            <p className="text-sm text-gray-500">Total: {formatCompact(totalExpense)}</p>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <ArrowDownCircle className="h-5 w-5 text-red-600" />
              Expense by Category
            </h3>
            <select
              value={selectedPeriod || data.categoryPeriod}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {data.availablePeriods.map((period) => (
                <option key={period} value={period}>
                  {formatPeriodLabel(period)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {data.spendByCategory.map((category, index) => {
              const percent = totalExpense > 0 ? Math.round((category.amount / totalExpense) * 100) : 0;
              return (
                <div key={category.id} className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 truncate">
                        {category.name}
                      </span>
                      <span className="text-sm text-gray-600 flex-shrink-0 ml-2">
                        {formatCompact(category.amount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: COLORS[index % COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-10 text-right">{percent}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* YTD Summary */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Year to Date Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Income</p>
            <p className="text-xl font-bold text-green-700">{formatCompact(data.summary.ytdIncome)}</p>
            <p className="text-xs text-gray-500">Avg: {formatCompact(data.summary.avgMonthlyIncome)}/mo</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Total Expense</p>
            <p className="text-xl font-bold text-red-700">{formatCompact(data.summary.ytdExpense)}</p>
            <p className="text-xs text-gray-500">Avg: {formatCompact(data.summary.avgMonthlyExpense)}/mo</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Net Cashflow</p>
            <p className={cn('text-xl font-bold', data.summary.ytdCashflow >= 0 ? 'text-blue-700' : 'text-red-700')}>
              {formatCompact(data.summary.ytdCashflow)}
            </p>
            <p className="text-xs text-gray-500">Avg: {formatCompact(data.summary.avgMonthlyCashflow)}/mo</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Savings Rate</p>
            <p className={cn('text-xl font-bold', data.summary.savingsRate >= 10 ? 'text-green-700' : 'text-red-700')}>
              {data.summary.savingsRate}%
            </p>
            <p className="text-xs text-gray-500">of income saved</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Summary Card Component
function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
  positive,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  positive: boolean;
}) {
  return (
    <div className={cn(
      'p-4 rounded-lg border',
      positive ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
    )}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className={cn('text-2xl font-bold mt-1', positive ? 'text-green-700' : 'text-red-700')}>
            {value}
          </p>
          <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
        </div>
        <Icon className={cn('h-10 w-10', positive ? 'text-green-600' : 'text-red-600')} />
      </div>
    </div>
  );
}

// Helper to format period label
function formatPeriodLabel(period: string): string {
  if (!period || period.length !== 6) return period;
  const month = parseInt(period.substring(0, 2), 10);
  const year = period.substring(4, 6);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[month - 1]} '${year}`;
}
