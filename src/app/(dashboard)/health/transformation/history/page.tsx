'use client';

/**
 * Transformation tracker — history view.
 *
 * Pulls everything from /api/health/transformation/history (one request)
 * and renders stat cards, charts (weight + calories/protein), a habit
 * grid heatmap, and a full daily-entries timeline.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  StatsDisplay,
} from '@dxp/ui';
import {
  ArrowLeft,
  TrendingDown,
  Flame,
  Trophy,
  CalendarRange,
  Loader2,
  Sparkles,
} from 'lucide-react';
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
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

interface TextEntry {
  itemId: number;
  sectionName: string;
  label: string;
  value: string;
  calories: number | null;
  proteinG: number | null;
}
interface DaySummary {
  date: string;
  dayNumber: number;
  currentWeightKg: number | null;
  journal: string | null;
  completionPct: number;
  checkDone: number;
  checkTotal: number;
  totalCalories: number;
  totalProteinG: number;
  textEntries: TextEntry[];
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
}
interface Summary {
  daysLogged: number;
  weightStart: number | null;
  weightLatest: number | null;
  weightDelta: number | null;
  avgCalories: number | null;
  avgProteinG: number | null;
  currentStreak: number;
  longestStreak: number;
  checkItemsTotal: number;
}

export default function TransformationHistoryPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/health/transformation/history');
        const j = await r.json();
        setPlan(j.plan);
        setDays(j.days ?? []);
        setSummary(j.summary);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const daysDesc = useMemo(() => [...days].sort((a, b) => b.date.localeCompare(a.date)), [days]);

  const dayByNumber = useMemo(() => {
    const m = new Map<number, DaySummary>();
    for (const d of days) m.set(d.dayNumber, d);
    return m;
  }, [days]);

  const chartData = useMemo(
    () =>
      days.map((d) => ({
        date: d.date,
        dayLabel: `D${d.dayNumber}`,
        weight: d.currentWeightKg,
        calories: d.totalCalories || null,
        protein: d.totalProteinG ? Math.round(d.totalProteinG * 10) / 10 : null,
      })),
    [days],
  );

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
          <p className="text-[var(--dxp-text-muted)]">No plan found.</p>
        </CardContent>
      </Card>
    );
  }

  const calorieTarget = plan.dailyCalorieTarget ?? null;
  const proteinTarget = plan.dailyProteinTargetG ?? null;
  const goalWeight = plan.goalWeightKg ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link href="/health/transformation">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" /> Today
            </Button>
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            <Sparkles className="h-7 w-7 text-amber-500" />
            History
          </h1>
          <p className="text-sm text-[var(--dxp-text-secondary)]">
            {plan.name} · started{' '}
            {new Date(plan.startDate).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* Stat cards */}
      {summary && (
        <StatsDisplay
          columns={4}
          stats={[
            {
              label: 'Days logged',
              value: summary.daysLogged,
              format: 'number',
              delta: { value: plan.dayCount, label: `of ${plan.dayCount}` },
            },
            {
              label: 'Weight delta',
              value: summary.weightDelta ?? 0,
              format: 'number',
              delta:
                summary.weightStart != null && summary.weightLatest != null
                  ? {
                      value: summary.weightLatest,
                      label: `${summary.weightStart} → ${summary.weightLatest} kg`,
                    }
                  : undefined,
            },
            {
              label: 'Avg calories',
              value: summary.avgCalories ?? 0,
              format: 'number',
              delta: calorieTarget
                ? { value: calorieTarget, label: `target ${calorieTarget}` }
                : undefined,
            },
            {
              label: 'Avg protein (g)',
              value: summary.avgProteinG ?? 0,
              format: 'number',
              delta: proteinTarget
                ? { value: proteinTarget, label: `target ${proteinTarget} g` }
                : undefined,
            },
          ]}
        />
      )}

      {/* Streaks */}
      {summary && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-emerald-600" />
                <span className="text-[var(--dxp-text-secondary)]">Current streak:</span>
                <span className="font-mono font-semibold text-[var(--dxp-text)]">
                  {summary.currentStreak} day{summary.currentStreak === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-600" />
                <span className="text-[var(--dxp-text-secondary)]">Longest streak:</span>
                <span className="font-mono font-semibold text-[var(--dxp-text)]">
                  {summary.longestStreak} day{summary.longestStreak === 1 ? '' : 's'}
                </span>
              </div>
              <span className="text-xs text-[var(--dxp-text-muted)]">
                A streak day = 100% checkbox completion.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weight trend */}
      {chartData.some((d) => d.weight != null) && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <TrendingDown className="h-5 w-5 text-blue-500" /> Weight trend
            </h3>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dayLabel" />
                  <YAxis domain={['auto', 'auto']} unit=" kg" />
                  <Tooltip />
                  <Legend />
                  {goalWeight != null && (
                    <ReferenceLine
                      y={goalWeight}
                      stroke="#10b981"
                      strokeDasharray="4 4"
                      label={{ value: `Goal ${goalWeight} kg`, position: 'right', fill: '#10b981', fontSize: 11 }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="weight"
                    name="Weight"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily calorie + protein */}
      {chartData.some((d) => d.calories != null || d.protein != null) && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Flame className="h-5 w-5 text-amber-500" /> Daily calories &amp; protein
            </h3>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dayLabel" />
                  <YAxis yAxisId="cal" orientation="left" />
                  <YAxis yAxisId="pro" orientation="right" />
                  <Tooltip />
                  <Legend />
                  {calorieTarget != null && (
                    <ReferenceLine
                      yAxisId="cal"
                      y={calorieTarget}
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                    />
                  )}
                  <Bar yAxisId="cal" dataKey="calories" name="Calories" fill="#f59e0b" />
                  <Bar yAxisId="pro" dataKey="protein" name="Protein (g)" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Habit heatmap */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <CalendarRange className="h-5 w-5 text-purple-500" /> {plan.dayCount}-day habit grid
          </h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Click any logged day to open it. Empty cells = future or not yet logged.
          </p>
        </CardHeader>
        <CardContent>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}
          >
            {Array.from({ length: plan.dayCount }, (_, i) => {
              const n = i + 1;
              const day = dayByNumber.get(n);
              const pct = day?.completionPct ?? -1;
              const bg =
                pct < 0
                  ? 'bg-gray-100 border-gray-200'
                  : pct === 0
                    ? 'bg-rose-50 border-rose-200'
                    : pct < 50
                      ? 'bg-amber-100 border-amber-200'
                      : pct < 100
                        ? 'bg-emerald-200 border-emerald-300'
                        : 'bg-emerald-500 border-emerald-600 text-white';
              const cell = (
                <div
                  className={`relative aspect-square rounded border ${bg} flex items-center justify-center text-[10px] font-mono cursor-default`}
                  title={
                    day
                      ? `Day ${n} · ${day.date} · ${day.completionPct}% (${day.checkDone}/${day.checkTotal})`
                      : `Day ${n} · not logged`
                  }
                >
                  {n}
                </div>
              );
              return day ? (
                <Link key={n} href={`/health/transformation?date=${day.date}`}>
                  {cell}
                </Link>
              ) : (
                <div key={n}>{cell}</div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--dxp-text-muted)] flex-wrap">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-gray-100 border border-gray-200"></span>
              not logged
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-rose-50 border border-rose-200"></span>
              0%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-200"></span>
              &lt; 50%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-emerald-200 border border-emerald-300"></span>
              50-99%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-emerald-500 border border-emerald-600"></span>
              100%
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Recent days with full journal + text entries */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Daily entries</h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            {daysDesc.length} day{daysDesc.length === 1 ? '' : 's'} logged · latest first
          </p>
        </CardHeader>
        <CardContent>
          {daysDesc.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--dxp-text-muted)]">
              No days logged yet.
            </p>
          ) : (
            <div className="space-y-4">
              {daysDesc.map((d) => (
                <div
                  key={d.date}
                  className="rounded-lg border border-[var(--dxp-border-light)] p-4"
                >
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-bold text-[var(--dxp-text)]">
                        Day {d.dayNumber} ·{' '}
                        {new Date(d.date).toLocaleDateString('en-IN', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--dxp-text-muted)]">
                        {d.currentWeightKg != null && (
                          <>
                            <span className="font-mono">{d.currentWeightKg} kg</span>
                            {' · '}
                          </>
                        )}
                        {d.totalCalories > 0 && (
                          <>
                            <span className="font-mono">{d.totalCalories} cal</span>
                            {' · '}
                          </>
                        )}
                        {d.totalProteinG > 0 && (
                          <>
                            <span className="font-mono">
                              {d.totalProteinG.toFixed(1)} g protein
                            </span>
                            {' · '}
                          </>
                        )}
                        <span className="font-mono">
                          {d.checkDone}/{d.checkTotal} ({d.completionPct}%)
                        </span>
                      </p>
                    </div>
                    <Link href={`/health/transformation?date=${d.date}`}>
                      <Button variant="secondary" size="sm">
                        Open
                      </Button>
                    </Link>
                  </div>

                  {d.textEntries.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {d.textEntries.map((t) => (
                        <div
                          key={t.itemId}
                          className="rounded bg-[var(--dxp-surface)] border border-[var(--dxp-border-light)] p-2 text-[12px]"
                        >
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-semibold text-[var(--dxp-text-secondary)]">
                              {t.sectionName} · {t.label}
                            </span>
                            {t.calories != null && (
                              <span className="text-[10px] text-amber-700">
                                {t.calories} cal · {(t.proteinG ?? 0).toFixed(1)} g
                              </span>
                            )}
                          </div>
                          <p className="text-[var(--dxp-text)] whitespace-pre-wrap">
                            {t.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {d.journal && d.journal.trim() && (
                    <div className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)] mb-1">
                        Journal
                      </p>
                      <p className="text-sm text-[var(--dxp-text)] whitespace-pre-wrap">
                        {d.journal}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
