'use client';

/**
 * Tax onboarding checklist — Sprint 5.2 commit 1 (U9).
 *
 * Shown when the user has no salary income AND no deductions for the
 * selected FY. Five numbered steps with auto-checkmarking based on
 * whether the relevant table has any rows.
 *
 * If only one or two steps are completed, the parent page can choose
 * to render BOTH this checklist (with partial checkmarks) AND the
 * regime card. This component just renders the steps; it does NOT
 * decide visibility.
 */

import Link from 'next/link';
import { Card, CardHeader, CardContent, Button } from '@dxp/ui';
import {
  CheckCircle2,
  Circle,
  Banknote,
  Receipt,
  ClipboardCheck,
  FileCheck2,
  Package,
  Upload,
} from 'lucide-react';

export interface OnboardingStatus {
  hasSalary: boolean;
  hasDeductions: boolean;
  has26AS: boolean;
  hasItrSelection: boolean;
  hasFilingPack: boolean;
}

interface Props {
  fy: string;
  status: OnboardingStatus;
}

const STEPS = [
  {
    n: 1,
    title: 'Add salary income',
    href: '/income',
    icon: <Banknote className="h-4 w-4" />,
    key: 'hasSalary' as const,
  },
  {
    n: 2,
    title: 'Record Section 80 deductions',
    href: '/tax/new',
    icon: <Receipt className="h-4 w-4" />,
    key: 'hasDeductions' as const,
  },
  {
    n: 3,
    title: 'Upload Form 26AS',
    href: '/tax/form-26as',
    icon: <ClipboardCheck className="h-4 w-4" />,
    key: 'has26AS' as const,
  },
  {
    n: 4,
    title: 'Pick the right ITR form',
    href: '/tax/itr-wizard',
    icon: <FileCheck2 className="h-4 w-4" />,
    key: 'hasItrSelection' as const,
  },
  {
    n: 5,
    title: 'Generate filing pack',
    href: '/tax/filing-pack',
    icon: <Package className="h-4 w-4" />,
    key: 'hasFilingPack' as const,
  },
];

export function TaxOnboardingChecklist({ fy, status }: Props) {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-bold text-[var(--dxp-text)]">
          Get started with tax tracking — FY {fy}
        </h3>
        <p className="text-xs text-[var(--dxp-text-secondary)]">
          Five steps from zero to a filed return. We check each one as data lands.
        </p>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {STEPS.map((s) => {
            const done = status[s.key];
            return (
              <li
                key={s.n}
                className={`flex items-center gap-3 rounded-md border p-3 ${
                  done
                    ? 'border-emerald-300 bg-emerald-50/60'
                    : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)]'
                }`}
              >
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    done
                      ? 'bg-emerald-500 text-white'
                      : 'border border-[var(--dxp-border)] text-[var(--dxp-text-muted)]'
                  }`}
                >
                  {s.n}
                </span>
                <div className="flex flex-1 items-center gap-2 text-sm">
                  <span className="text-[var(--dxp-text-muted)]">{s.icon}</span>
                  <span
                    className={
                      done
                        ? 'text-emerald-900 line-through decoration-emerald-400/60'
                        : 'text-[var(--dxp-text)]'
                    }
                  >
                    {s.title}
                  </span>
                </div>
                {done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <Link href={s.href}>
                    <Button variant="primary" size="sm">
                      Start
                    </Button>
                  </Link>
                )}
                {done && <Circle className="hidden" />}
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex items-center justify-between rounded-md border border-sky-300 bg-sky-50/40 p-3">
          <div>
            <p className="text-sm font-bold text-[var(--dxp-text)]">
              Already filed via Yeswanth TaxCalc?
            </p>
            <p className="text-xs text-[var(--dxp-text-secondary)]">
              Import the xlsx — we&apos;ll pre-fill every block above.
            </p>
          </div>
          <Link href="/tax/import">
            <Button variant="primary" size="sm">
              <Upload className="mr-1 h-3 w-3" /> Import from Yeswanth
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
