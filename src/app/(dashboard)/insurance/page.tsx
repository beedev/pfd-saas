'use client';

/**
 * Insurance overview (Sprint 3.5 Phase 1).
 *
 * Top-level hub for the three protection-side asset classes that share a
 * "what protects you" framing: Life, Health, and Vehicles. Each card
 * surfaces a one-line summary + a "View all" link to the existing detail
 * page (URLs stayed at /investments/* — only the sidebar regrouped).
 *
 * This page deliberately keeps the math light. Each detail page has the
 * full UX; this overview is the landing pad that confirms "yes, you've
 * tracked these" and shunts the user to the right place.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Card, CardHeader, CardContent, Button, StatsDisplay } from '@dxp/ui';
import {
  Umbrella,
  HeartPulse,
  Car,
  ArrowRight,
  Loader2,
} from 'lucide-react';

interface LifePolicy {
  id: number;
  policyType: string;
  sumAssured: number;
  investmentValue: number | null;
  status: string;
}
interface HealthPolicy {
  id: number;
  sumInsured: number;
  status: string;
}
interface Vehicle {
  id: number;
  registrationNumber: string;
}

const CASH_VALUE_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export default function InsuranceOverviewPage() {
  const [life, setLife] = useState<LifePolicy[]>([]);
  const [health, setHealth] = useState<HealthPolicy[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/investments/insurance').then((r) => r.json()),
      fetch('/api/investments/health-insurance').then((r) => r.json()),
      fetch('/api/investments/vehicles').then((r) => r.json()),
    ])
      .then(([lifeData, healthData, vehData]) => {
        setLife(lifeData.policies || []);
        setHealth(healthData.policies || []);
        setVehicles(vehData.vehicles || []);
      })
      .catch(() => {
        /* empty state */
      })
      .finally(() => setIsLoading(false));
  }, []);

  const lifeActive = life.filter((p) => p.status === 'ACTIVE');
  const lifeCover =
    lifeActive.reduce((s, p) => s + p.sumAssured, 0) / 100;
  const lifeCashValue =
    lifeActive
      .filter((p) => CASH_VALUE_TYPES.includes(p.policyType))
      .reduce((s, p) => s + (p.investmentValue ?? 0), 0) / 100;

  const healthActive = health.filter((p) => p.status === 'ACTIVE');
  const healthCover =
    healthActive.reduce((s, p) => s + p.sumInsured, 0) / 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Insurance
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          What protects you — life, health, and your vehicles
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[var(--dxp-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <>
          <SummaryCard
            title="Life Insurance"
            icon={<Umbrella className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/insurance"
            count={`${lifeActive.length} active polic${lifeActive.length === 1 ? 'y' : 'ies'}`}
            stats={[
              { label: 'Total life cover', value: lifeCover },
              { label: 'Cash / surrender value', value: lifeCashValue },
            ]}
          />

          <SummaryCard
            title="Health Insurance"
            icon={<HeartPulse className="h-5 w-5 text-rose-500" />}
            href="/investments/health-insurance"
            count={`${healthActive.length} active polic${healthActive.length === 1 ? 'y' : 'ies'}`}
            stats={[{ label: 'Total sum insured', value: healthCover }]}
          />

          <SummaryCard
            title="Vehicles"
            icon={<Car className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/vehicles"
            count={`${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
            stats={[
              {
                label: 'Tracked vehicles',
                value: vehicles.length,
                format: 'number',
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  icon,
  href,
  count,
  stats,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  count: string;
  stats: Array<{ label: string; value: number; format?: 'currency' | 'number' }>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                {title}
              </h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">{count}</p>
            </div>
          </div>
          <Link href={href}>
            <Button variant="secondary" size="sm">
              View all <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <StatsDisplay
          currency="INR"
          locale="en-IN"
          columns={(stats.length >= 3 ? 3 : 2) as 2 | 3}
          stats={stats.map((s) => ({
            label: s.label,
            value: s.value,
            format: s.format ?? ('currency' as const),
          }))}
        />
      </CardContent>
    </Card>
  );
}
