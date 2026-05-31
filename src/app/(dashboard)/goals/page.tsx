'use client';

/**
 * Goals — list page.
 *
 * Replaces the old redirect-to-/projections. Shows a tile strip on top
 * (active count, total target, currently funded, gap) and a grid of
 * goal cards below. Each card is clickable into the detail page.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay } from '@dxp/ui';
import {
  Plus,
  Loader2,
  Target,
  Home,
  Car,
  GraduationCap,
  Plane,
  ShieldAlert,
  Heart,
  Briefcase,
  CircleDot,
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
  currentCorpusPaisa: number;
  yearlyContributionPaisa: number;
}

const GOAL_TYPE_META: Record<GoalType, { label: string; Icon: typeof Target }> = {
  HOUSE: { label: 'House', Icon: Home },
  CAR: { label: 'Car', Icon: Car },
  EDUCATION: { label: 'Education', Icon: GraduationCap },
  TRAVEL: { label: 'Travel', Icon: Plane },
  EMERGENCY: { label: 'Emergency', Icon: ShieldAlert },
  WEDDING: { label: 'Wedding', Icon: Heart },
  BUSINESS: { label: 'Business', Icon: Briefcase },
  OTHER: { label: 'Other', Icon: CircleDot },
};

const DISBURSEMENT_LABELS: Record<DisbursementType, string> = {
  LUMPSUM: 'Lumpsum',
  FIXED_PERIOD_SWP: 'Fixed SWP',
  INFLATION_SWP: 'Inflation-linked SWP',
};

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/finance/goals').then((r) => r.json());
      setGoals(r.goals || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load goals');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeGoals = goals.filter((g) => g.isActive);
  const totalTarget = activeGoals.reduce((s, g) => s + g.targetAmount, 0);
  const totalFunded = activeGoals.reduce((s, g) => s + g.currentCorpusPaisa, 0);
  const fundingGap = Math.max(0, totalTarget - totalFunded);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Goals
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Track funding progress across major life goals — house, education, retirement bridge.
          </p>
        </div>
        <Link href="/goals/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add goal
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active goals', value: activeGoals.length, format: 'number' },
          { label: 'Total target', value: totalTarget / 100, format: 'currency' },
          { label: 'Currently funded', value: totalFunded / 100, format: 'currency' },
          { label: 'Funding gap', value: fundingGap / 100, format: 'currency' },
        ]}
      />

      {activeGoals.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Target className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">
                No goals yet. Add one to start tracking funding progress.
              </p>
              <Link href="/goals/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" /> Add your first goal
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeGoals.map((g) => {
            const meta = GOAL_TYPE_META[g.goalType] ?? GOAL_TYPE_META.OTHER;
            const Icon = meta.Icon;
            const progress =
              g.targetAmount > 0
                ? Math.min(100, Math.round((g.currentCorpusPaisa / g.targetAmount) * 100))
                : 0;
            return (
              <Link
                key={g.id}
                href={`/goals/${g.id}`}
                className="block focus:outline-none focus:ring-2 focus:ring-[var(--dxp-brand)] rounded-lg"
              >
                <Card className="h-full hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <Icon
                          className="h-6 w-6 mt-0.5 shrink-0"
                          style={{ color: g.color || 'var(--dxp-brand)' }}
                        />
                        <div>
                          <h3 className="text-base font-bold text-[var(--dxp-text)]">
                            {g.name}
                          </h3>
                          <p className="text-xs text-[var(--dxp-text-secondary)]">
                            {meta.label} · {DISBURSEMENT_LABELS[g.disbursementType]}
                          </p>
                        </div>
                      </div>
                      <Badge variant="info">{g.goalType}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-xs text-[var(--dxp-text-muted)]">
                            Funded
                          </span>
                          <span className="text-xs font-mono text-[var(--dxp-text-secondary)]">
                            {progress}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[var(--dxp-surface-alt)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${progress}%`,
                              backgroundColor: g.color || 'var(--dxp-brand)',
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-mono font-semibold text-[var(--dxp-text)]">
                          {formatINR(g.currentCorpusPaisa)}
                        </span>
                        <span className="text-xs text-[var(--dxp-text-muted)]">
                          of {formatINR(g.targetAmount)}
                        </span>
                      </div>
                      {g.targetDate && (
                        <p className="text-xs text-[var(--dxp-text-muted)]">
                          Target: {g.targetDate}
                        </p>
                      )}
                      {g.yearlyContributionPaisa > 0 && (
                        <p className="text-xs text-[var(--dxp-text-secondary)]">
                          +{formatINR(g.yearlyContributionPaisa)}/yr from mapped SIPs & earmarks
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
