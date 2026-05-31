'use client';

/**
 * Goals — new goal registration.
 *
 * Two-stage flow:
 *   1. Type picker — 8 cards, each suggesting a default disbursement
 *      shape based on how that kind of goal usually funds.
 *   2. Form — name/target/dates + the disbursement controls. Field
 *      labels swap based on disbursement_type so the UI matches the
 *      mental model (LUMPSUM: "Total target", SWP: "Per-year withdrawal").
 *
 * Money convention here is RUPEES on the form, paisa on the wire.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import {
  Target,
  Home,
  Car,
  GraduationCap,
  Plane,
  ShieldAlert,
  Heart,
  Briefcase,
  CircleDot,
  Loader2,
  ArrowLeft,
} from 'lucide-react';

type GoalType =
  | 'HOUSE' | 'CAR' | 'EDUCATION' | 'TRAVEL'
  | 'EMERGENCY' | 'WEDDING' | 'BUSINESS' | 'OTHER';
type DisbursementType = 'LUMPSUM' | 'FIXED_PERIOD_SWP' | 'INFLATION_SWP';

interface TypeCard {
  key: GoalType;
  title: string;
  tagline: string;
  defaultDisbursement: DisbursementType;
  Icon: typeof Target;
}

const TYPE_CARDS: TypeCard[] = [
  {
    key: 'HOUSE',
    title: 'House',
    tagline: 'Buy or upgrade — single big lumpsum',
    defaultDisbursement: 'LUMPSUM',
    Icon: Home,
  },
  {
    key: 'CAR',
    title: 'Car',
    tagline: 'Down payment or full purchase',
    defaultDisbursement: 'LUMPSUM',
    Icon: Car,
  },
  {
    key: 'EDUCATION',
    title: 'Education',
    tagline: 'Multi-year fees — funds drawn over the course',
    defaultDisbursement: 'INFLATION_SWP',
    Icon: GraduationCap,
  },
  {
    key: 'TRAVEL',
    title: 'Travel',
    tagline: 'Vacation, sabbatical — one-shot',
    defaultDisbursement: 'LUMPSUM',
    Icon: Plane,
  },
  {
    key: 'EMERGENCY',
    title: 'Emergency',
    tagline: 'Liquid buffer for life events',
    defaultDisbursement: 'LUMPSUM',
    Icon: ShieldAlert,
  },
  {
    key: 'WEDDING',
    title: 'Wedding',
    tagline: 'Once-only event',
    defaultDisbursement: 'LUMPSUM',
    Icon: Heart,
  },
  {
    key: 'BUSINESS',
    title: 'Business',
    tagline: 'Capital injection or runway',
    defaultDisbursement: 'LUMPSUM',
    Icon: Briefcase,
  },
  {
    key: 'OTHER',
    title: 'Other',
    tagline: 'Custom — pick disbursement shape below',
    defaultDisbursement: 'LUMPSUM',
    Icon: CircleDot,
  },
];

const DISBURSEMENT_OPTIONS: Array<{ label: string; value: DisbursementType }> = [
  { label: 'Lumpsum (single payout)', value: 'LUMPSUM' },
  { label: 'Fixed-period SWP (flat per-year)', value: 'FIXED_PERIOD_SWP' },
  { label: 'Inflation-linked SWP (per-year grows)', value: 'INFLATION_SWP' },
];

export default function NewGoalPage() {
  const router = useRouter();
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form fields — strings throughout, parsed at submit.
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [disbursementType, setDisbursementType] = useState<DisbursementType>('LUMPSUM');
  const [targetAmount, setTargetAmount] = useState('');
  const [disbursementYears, setDisbursementYears] = useState('');
  const [disbursementStartDate, setDisbursementStartDate] = useState('');
  const [growthPctPerYr, setGrowthPctPerYr] = useState('0');
  const [expectedReturnPct, setExpectedReturnPct] = useState('8');
  const [inflationPct, setInflationPct] = useState('6');
  const [color, setColor] = useState('#4CAF50');

  // When a goal type is picked, apply its default disbursement shape.
  // The user can still override below.
  useEffect(() => {
    if (!goalType) return;
    const card = TYPE_CARDS.find((c) => c.key === goalType);
    if (card) {
      setDisbursementType(card.defaultDisbursement);
      if (card.defaultDisbursement === 'INFLATION_SWP') {
        setGrowthPctPerYr('6');
      } else if (card.defaultDisbursement === 'FIXED_PERIOD_SWP') {
        setGrowthPctPerYr('0');
      }
    }
  }, [goalType]);

  const isSWP = disbursementType !== 'LUMPSUM';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalType) {
      toast.error('Pick a goal type');
      return;
    }
    if (!name.trim()) {
      toast.error('Goal name is required');
      return;
    }
    if (!targetDate) {
      toast.error('Target date is required');
      return;
    }
    const target = parseFloat(targetAmount);
    if (!Number.isFinite(target) || target <= 0) {
      toast.error('Enter a positive target amount');
      return;
    }
    if (isSWP) {
      const yrs = Number(disbursementYears);
      if (!Number.isFinite(yrs) || yrs <= 0) {
        toast.error('Enter how many years the SWP runs');
        return;
      }
      if (!disbursementStartDate) {
        toast.error('SWP start date is required');
        return;
      }
    }

    setIsSaving(true);
    try {
      // For LUMPSUM, target_amount IS the lumpsum. For SWP flavours,
      // target_amount is treated as "total target across all years"
      // and disbursementAmountPerYrPaisa carries the per-year payout.
      // The /projections page that depends on target_amount continues
      // to see a single number — its progress math works either way.
      const targetPaisa = Math.round(target * 100);
      const body: Record<string, unknown> = {
        name: name.trim(),
        targetAmount: targetPaisa,
        targetDate,
        color,
        goalType,
        disbursementType,
        growthPctPerYr: parseFloat(growthPctPerYr) || 0,
        expectedReturnPct: parseFloat(expectedReturnPct) || 8,
        inflationPct: parseFloat(inflationPct) || 6,
      };
      if (isSWP) {
        // Convert per-year withdrawal to paisa. For SWP we treat the
        // entered "target amount" field as the per-year amount AND
        // also stash totalTarget = perYear × years for the progress
        // calc.
        const perYearPaisa = targetPaisa;
        const yrs = Number(disbursementYears);
        body.disbursementAmountPerYrPaisa = perYearPaisa;
        body.disbursementYears = yrs;
        body.disbursementStartDate = disbursementStartDate;
        body.targetAmount = perYearPaisa * yrs;
      }

      const r = await fetch('/api/finance/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to create goal');
      toast.success('Goal created');
      const newId = data.goal?.id;
      if (newId) {
        router.push(`/goals/${newId}`);
      } else {
        router.push('/goals');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create goal');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/goals"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to goals
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add Goal
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Pick the goal type — we&apos;ll suggest a sensible disbursement shape and
          you can tune it below.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {TYPE_CARDS.map((card) => {
          const active = goalType === card.key;
          const Icon = card.Icon;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setGoalType(card.key)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon
                  className={`h-6 w-6 ${
                    active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-brand)]'
                  }`}
                />
                <div className="flex-1">
                  <p
                    className={`font-semibold ${
                      active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'
                    }`}
                  >
                    {card.title}
                  </p>
                  <p className="text-xs text-[var(--dxp-text-secondary)] mt-1">
                    {card.tagline}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {goalType && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Target className="h-5 w-5 text-[var(--dxp-brand)]" />
              Goal details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">
              All amounts in rupees (₹). Defaults assume an 8% return / 6% inflation portfolio.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Goal name
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. House down payment"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Target date
                  </label>
                  <Input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Disbursement type
                  </label>
                  <Select
                    value={disbursementType}
                    onChange={(v) => setDisbursementType(v as DisbursementType)}
                    options={DISBURSEMENT_OPTIONS}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    {isSWP ? 'Per-year withdrawal (₹)' : 'Total target (₹)'}
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    placeholder={isSWP ? 'e.g. 500000' : 'e.g. 5000000'}
                  />
                </div>
                {isSWP && (
                  <>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Disbursement years
                      </label>
                      <Input
                        type="number"
                        step="1"
                        value={disbursementYears}
                        onChange={(e) => setDisbursementYears(e.target.value)}
                        placeholder="e.g. 4"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        SWP start date
                      </label>
                      <Input
                        type="date"
                        value={disbursementStartDate}
                        onChange={(e) => setDisbursementStartDate(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Growth %/yr (SWP only)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={growthPctPerYr}
                    onChange={(e) => setGrowthPctPerYr(e.target.value)}
                    placeholder="0 = flat, 6 = inflation-linked"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Expected return %/yr
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={expectedReturnPct}
                    onChange={(e) => setExpectedReturnPct(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Inflation %/yr
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={inflationPct}
                    onChange={(e) => setInflationPct(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Colour
                  </label>
                  <Input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.back()}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save goal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
