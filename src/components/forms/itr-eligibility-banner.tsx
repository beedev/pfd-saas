'use client';

/**
 * ITR Eligibility Banner — Sprint 5.4.
 *
 * Single reusable component that sits at the very top of /tax/itr1,
 * /tax/itr2, /tax/itr3 and /tax/itr4. Surfaces:
 *
 *   1. Wizard mismatch — if the wizard picked a different form than the
 *      one the user is currently on, render an amber callout naming the
 *      recommended form + the rupee value of income that this form
 *      silently drops.
 *   2. Per-form ineligibility flags — each form has its own subset of
 *      checks (see `FLAGS_BY_FORM` below). Each fired flag becomes a
 *      one-line row with the data point that triggered it.
 *   3. Excluded income blocks — a one-liner listing what the current
 *      form chose to ignore (e.g. "rental from 2 extra properties · CG
 *      ₹7,85,000").
 *
 * If no ineligibility issues fire AND there's no wizard mismatch, the
 * banner collapses to a compact green "Eligible for {formCode}" badge.
 *
 * The component is purely presentational — every flag/value is computed
 * server-side in /api/tax/itr{N}/summary and passed in as props. The
 * stubs (foreign income, director, agricultural > ₹5k) currently always
 * resolve to false because the schema doesn't capture them yet, but the
 * types are correct so when capture lands the banner picks up the
 * signal without further UI changes.
 */

import Link from 'next/link';
import { Badge, Button } from '@dxp/ui';
import {
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  TrendingUp,
  Home,
  Briefcase,
  Globe,
  Building2,
  Wheat,
  CircleDollarSign,
} from 'lucide-react';

export type ItrFormCode = 'ITR-1' | 'ITR-2' | 'ITR-3' | 'ITR-4';

export interface EligibilityFlags {
  exceedsCap?: { actualPaisa: number; capPaisa: number };
  hasCapitalGains?: { totalPaisa: number; rowCount: number };
  multipleHouseProperties?: { count: number; rentalPaisa: number };
  hasBusiness?: { invoiceCount: number; turnoverPaisa: number };
  /** Stub — schema doesn't capture Schedule FA yet. Always false today. */
  hasForeignIncome?: boolean;
  /** Stub — user profile flag deferred. Always false today. */
  isDirectorOrUnlisted?: boolean;
  /** Stub — agricultural income line not captured. Always false today. */
  agriculturalOver5k?: boolean;
}

export interface ExcludedIncomeBlock {
  label: string;
  amountPaisa: number;
  reason: string;
}

interface Props {
  formCode: ItrFormCode;
  fy: string;
  wizardSelectedForm?: ItrFormCode | null;
  excludedIncomeBlocks: ExcludedIncomeBlock[];
  eligibilityFlags: EligibilityFlags;
}

/** Which flags each form should evaluate. Driven by IT rules:
 *  ITR-1: cap, CG, multi-HP, business, foreign, director, agri.
 *  ITR-4: cap, CG, multi-HP, foreign, director, agri (business is fine
 *         only if presumptive).
 *  ITR-2: business is the ONLY blocker.
 *  ITR-3: nothing — catch-all. */
const FLAGS_BY_FORM: Record<
  ItrFormCode,
  Array<keyof EligibilityFlags>
> = {
  'ITR-1': [
    'exceedsCap',
    'hasCapitalGains',
    'multipleHouseProperties',
    'hasBusiness',
    'hasForeignIncome',
    'isDirectorOrUnlisted',
    'agriculturalOver5k',
  ],
  'ITR-2': ['hasBusiness'],
  'ITR-3': [],
  'ITR-4': [
    'exceedsCap',
    'hasCapitalGains',
    'multipleHouseProperties',
    'hasForeignIncome',
    'isDirectorOrUnlisted',
    'agriculturalOver5k',
  ],
};

const SUGGESTED_FORM: Record<keyof EligibilityFlags, ItrFormCode> = {
  exceedsCap: 'ITR-2',
  hasCapitalGains: 'ITR-2',
  multipleHouseProperties: 'ITR-2',
  hasBusiness: 'ITR-3',
  hasForeignIncome: 'ITR-2',
  isDirectorOrUnlisted: 'ITR-2',
  agriculturalOver5k: 'ITR-2',
};

const formatINR = (paisa: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

/** A single ineligibility row — icon + headline + the data point that
 *  fired the flag. Kept compact so the banner can list 4-5 without
 *  feeling like a wall. */
function flagRow(
  flag: keyof EligibilityFlags,
  flags: EligibilityFlags,
  fy: string,
): { icon: React.ReactNode; headline: string; detail: string; suggest: ItrFormCode } | null {
  switch (flag) {
    case 'exceedsCap': {
      const v = flags.exceedsCap;
      if (!v) return null;
      return {
        icon: <CircleDollarSign className="h-4 w-4 text-amber-600" />,
        headline: 'Total income exceeds the form cap',
        detail: `Gross total ${formatINR(v.actualPaisa)} > cap ${formatINR(v.capPaisa)} for FY ${fy}.`,
        suggest: SUGGESTED_FORM.exceedsCap,
      };
    }
    case 'hasCapitalGains': {
      const v = flags.hasCapitalGains;
      if (!v || v.totalPaisa === 0) return null;
      return {
        icon: <TrendingUp className="h-4 w-4 text-amber-600" />,
        headline: 'Capital gains recorded',
        detail: `${v.rowCount} row(s) totalling ${formatINR(v.totalPaisa)} taxable gain for FY ${fy}.`,
        suggest: SUGGESTED_FORM.hasCapitalGains,
      };
    }
    case 'multipleHouseProperties': {
      const v = flags.multipleHouseProperties;
      if (!v || v.count <= 1) return null;
      return {
        icon: <Home className="h-4 w-4 text-amber-600" />,
        headline: 'More than one house property',
        detail:
          v.rentalPaisa > 0
            ? `${v.count} properties · additional rent ${formatINR(v.rentalPaisa)}/yr beyond the first.`
            : `${v.count} properties — only the first fits this form.`,
        suggest: SUGGESTED_FORM.multipleHouseProperties,
      };
    }
    case 'hasBusiness': {
      const v = flags.hasBusiness;
      if (!v || v.invoiceCount === 0) return null;
      return {
        icon: <Briefcase className="h-4 w-4 text-amber-600" />,
        headline: 'Business / professional income detected',
        detail: `${v.invoiceCount} GST invoice(s) totalling ${formatINR(v.turnoverPaisa)} turnover for FY ${fy}.`,
        suggest: SUGGESTED_FORM.hasBusiness,
      };
    }
    case 'hasForeignIncome': {
      if (!flags.hasForeignIncome) return null;
      return {
        icon: <Globe className="h-4 w-4 text-amber-600" />,
        headline: 'Foreign income / assets',
        detail: 'Schedule FA disclosure required.',
        suggest: SUGGESTED_FORM.hasForeignIncome,
      };
    }
    case 'isDirectorOrUnlisted': {
      if (!flags.isDirectorOrUnlisted) return null;
      return {
        icon: <Building2 className="h-4 w-4 text-amber-600" />,
        headline: 'Director of a company or unlisted shares',
        detail: 'Disclosure required — ITR-1/4 are not available.',
        suggest: SUGGESTED_FORM.isDirectorOrUnlisted,
      };
    }
    case 'agriculturalOver5k': {
      if (!flags.agriculturalOver5k) return null;
      return {
        icon: <Wheat className="h-4 w-4 text-amber-600" />,
        headline: 'Agricultural income above ₹5,000',
        detail: 'ITR-1/4 cap agricultural income at ₹5,000.',
        suggest: SUGGESTED_FORM.agriculturalOver5k,
      };
    }
    default:
      return null;
  }
}

export function ItrEligibilityBanner({
  formCode,
  fy,
  wizardSelectedForm,
  excludedIncomeBlocks,
  eligibilityFlags,
}: Props) {
  const relevantFlags = FLAGS_BY_FORM[formCode];
  const fired = relevantFlags
    .map((f) => flagRow(f, eligibilityFlags, fy))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const wizardMismatch =
    wizardSelectedForm && wizardSelectedForm !== formCode ? wizardSelectedForm : null;
  const excludedTotal = excludedIncomeBlocks.reduce((s, b) => s + b.amountPaisa, 0);

  // Happy path — compact eligible badge (still shows excluded blocks if
  // any, since e.g. ITR-3 covers all but a user might still want to
  // see "Schedule FA pending" once we wire that in).
  // Mobile: badge + note stack vertically; sm+: single row.
  if (!wizardMismatch && fired.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700" />
          <span className="text-sm font-bold text-emerald-800">
            Eligible for {formCode} — FY {fy}
          </span>
        </div>
        {excludedIncomeBlocks.length > 0 && (
          <span className="text-xs text-[var(--dxp-text-secondary)]">
            Note: {excludedIncomeBlocks.map((b) => `${b.label} ${formatINR(b.amountPaisa)}`).join(' · ')}
          </span>
        )}
      </div>
    );
  }

  // Warn path — wizard mismatch (most common), one or more fired flags,
  // or both.
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50/40 p-3">
      {wizardMismatch && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-bold text-[var(--dxp-text)]">
                Your wizard recommended {wizardMismatch} — these numbers are computed for {formCode}.
              </p>
              {excludedTotal > 0 && (
                <p className="text-xs text-[var(--dxp-text-secondary)]">
                  {formCode} skips {formatINR(excludedTotal)} of your income that {wizardMismatch} would
                  include.
                </p>
              )}
            </div>
          </div>
          <Link href={`/tax/${wizardMismatch.toLowerCase().replace('-', '')}?fy=${encodeURIComponent(fy)}`}>
            <Button variant="primary" size="sm">
              Go to {wizardMismatch} <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </div>
      )}

      {fired.length > 0 && (
        <ul className="space-y-1 pl-1">
          {fired.map((row, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              {row.icon}
              <span className="flex-1">
                <span className="font-bold text-[var(--dxp-text)]">{row.headline}.</span>{' '}
                <span className="text-[var(--dxp-text-secondary)]">{row.detail}</span>{' '}
                <Badge variant="warning">File {row.suggest}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}

      {excludedIncomeBlocks.length > 0 && (
        <p className="border-t border-amber-200 pt-2 text-xs text-[var(--dxp-text-secondary)]">
          <span className="font-bold text-[var(--dxp-text)]">Excluded from this form:</span>{' '}
          {excludedIncomeBlocks
            .map((b) => `${b.label} ${formatINR(b.amountPaisa)}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
