'use client';

/**
 * Year-grouped vertical timeline for cashflow events.
 *
 * Replaces an earlier horizontal-bar timeline that compressed 40 years
 * into a few hundred pixels and made one-time events into invisible
 * 1-pixel ticks. The chronological reading order — "what happens next?"
 * — is the whole point of this view, so we lean into it: events grouped
 * by their kick-in year, sorted by month within the year, with the year
 * label as a section header.
 *
 * Recurring events appear once, in the year they start, with their end
 * date noted as context ("lifelong" / "until 2048"). They don't repeat
 * across every year of their lifetime — that would just clutter the
 * page with the same salary line forty times.
 *
 * Used by /planning/cashflows (global manager) and /retirement (filtered
 * to retirement years).
 */

import { Badge } from '@dxp/ui';
import { CalendarDays, Zap, RotateCw } from 'lucide-react';

// Narrow prop shape — only the fields the timeline renders. Both
// /planning/cashflows (which keeps its own row interface) and
// /retirement (which builds events client-side) satisfy this without
// having to share a single canonical type.
export type CashflowSourceKind =
  | 'INSURANCE_MATURITY' | 'ANNUITY' | 'PENSION' | 'NPS_LUMPSUM' | 'NPS_ANNUITY'
  | 'PPF_MATURITY' | 'SSY_MATURITY' | 'NSC_MATURITY' | 'KVP_MATURITY'
  | 'RENTAL' | 'SALARY' | 'BUSINESS' | 'INHERITANCE' | 'OTHER';
export type CashflowFrequency = 'ONE_TIME' | 'MONTHLY' | 'YEARLY';
export type CashflowTaxTreatment = 'TAX_FREE' | 'TAXABLE' | 'TDS';

export interface TimelineEvent {
  id: number;
  name: string;
  sourceKind: CashflowSourceKind;
  startDate: string;
  endDate: string | null;
  amountPaisa: number;
  frequency: CashflowFrequency;
  growthPctPerYear: number;
  taxTreatment: CashflowTaxTreatment;
  autoDerived: boolean;
}

const KIND_LABELS: Record<CashflowSourceKind, string> = {
  INSURANCE_MATURITY: 'Insurance maturity',
  ANNUITY: 'Annuity',
  PENSION: 'Pension',
  NPS_LUMPSUM: 'NPS lumpsum',
  NPS_ANNUITY: 'NPS annuity',
  PPF_MATURITY: 'PPF maturity',
  SSY_MATURITY: 'SSY maturity',
  NSC_MATURITY: 'NSC maturity',
  KVP_MATURITY: 'KVP maturity',
  RENTAL: 'Rental income',
  SALARY: 'Salary',
  BUSINESS: 'Business income',
  INHERITANCE: 'Inheritance',
  OTHER: 'Other',
};

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatINR(paisa: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);
}

function frequencyLabel(e: { frequency: CashflowFrequency; endDate: string | null }): string {
  if (e.frequency === 'ONE_TIME') return 'one-time';
  const cadence = e.frequency === 'MONTHLY' ? '/month' : '/year';
  if (!e.endDate) return `${cadence}, lifelong`;
  const endYear = e.endDate.slice(0, 4);
  return `${cadence}, until ${endYear}`;
}

function taxBadge(tax: CashflowTaxTreatment) {
  if (tax === 'TAX_FREE') return <Badge variant="success">Tax-free</Badge>;
  if (tax === 'TDS') return <Badge variant="warning">TDS</Badge>;
  return <Badge variant="default">Taxable</Badge>;
}

export interface CashflowTimelineProps {
  events: TimelineEvent[];
  /** Optional year window to filter to. When set, only events that
   *  *start* between minYear and maxYear (inclusive) are rendered.
   *  Recurring events that started earlier but are still active in the
   *  window are included separately as "Already active" — see
   *  `showAlreadyActive`. */
  minYear?: number;
  maxYear?: number;
  /** When a year window is set, surface recurring events that started
   *  before minYear but remain active during it (e.g., rental income
   *  that began years before retirement and continues into it). Default
   *  true — without this, the retirement timeline would hide the
   *  rental income that's been there all along. */
  showAlreadyActive?: boolean;
  /** Compact mode for embedded use (smaller text, tighter spacing). */
  compact?: boolean;
  /** Shown when there are zero events to render. */
  emptyMessage?: string;
}

interface YearGroup {
  year: number;
  events: TimelineEvent[];
}

export function CashflowTimeline({
  events,
  minYear,
  maxYear,
  showAlreadyActive = true,
  compact = false,
  emptyMessage = 'No events to show.',
}: CashflowTimelineProps) {
  // Partition events into (a) starting inside the window and (b) already
  // active before the window started but still firing during it.
  const inWindow: TimelineEvent[] = [];
  const alreadyActive: TimelineEvent[] = [];

  for (const e of events) {
    const startYear = parseInt(e.startDate.slice(0, 4), 10);
    if (Number.isNaN(startYear)) continue;
    const inMinWindow = minYear == null || startYear >= minYear;
    const inMaxWindow = maxYear == null || startYear <= maxYear;
    if (inMinWindow && inMaxWindow) {
      inWindow.push(e);
    } else if (
      showAlreadyActive &&
      minYear != null &&
      startYear < minYear &&
      e.frequency !== 'ONE_TIME' &&
      (!e.endDate || parseInt(e.endDate.slice(0, 4), 10) >= minYear)
    ) {
      alreadyActive.push(e);
    }
  }

  // Group window events by start year and sort.
  const byYear = new Map<number, TimelineEvent[]>();
  for (const e of inWindow) {
    const y = parseInt(e.startDate.slice(0, 4), 10);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(e);
  }
  const yearGroups: YearGroup[] = Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, evs]) => ({
      year,
      events: evs.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)),
    }));

  if (yearGroups.length === 0 && alreadyActive.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--dxp-text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  const baseRow = compact
    ? 'grid grid-cols-[44px_1fr_auto] gap-3 py-1.5'
    : 'grid grid-cols-[56px_1fr_auto] gap-4 py-2';

  return (
    <div className="space-y-6">
      {/* Already-active recurring events that bleed into the window from
          before it started. Rendered as a small leading section so the
          eye sees "these are already paying when the window opens". */}
      {alreadyActive.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--dxp-text-muted)]">
            <RotateCw className="h-3.5 w-3.5" />
            Already active going in
          </div>
          <div className="rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)]/40 px-3 py-2">
            {alreadyActive
              .slice()
              .sort((a, b) => a.startDate.localeCompare(b.startDate))
              .map((e) => (
                <Row key={e.id} event={e} baseRow={baseRow} alreadyActive />
              ))}
          </div>
        </div>
      )}

      {yearGroups.map(({ year, events: evs }) => (
        <div key={year}>
          <div className="mb-2 flex items-center gap-3">
            <span className="text-lg font-bold text-[var(--dxp-text)]">{year}</span>
            <div className="h-px flex-1 bg-[var(--dxp-border)]" />
            <span className="text-xs text-[var(--dxp-text-muted)]">
              {evs.length} event{evs.length === 1 ? '' : 's'}
            </span>
          </div>
          <div>
            {evs.map((e) => (
              <Row key={e.id} event={e} baseRow={baseRow} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({
  event,
  baseRow,
  alreadyActive,
}: {
  event: TimelineEvent;
  baseRow: string;
  alreadyActive?: boolean;
}) {
  const e = event;
  const month = parseInt(e.startDate.slice(5, 7), 10);
  const monthLabel =
    Number.isNaN(month) || month < 1 || month > 12
      ? ''
      : MONTH_SHORT[month - 1];

  return (
    <div className={`${baseRow} border-b border-[var(--dxp-border)]/40 last:border-b-0`}>
      {/* Month cell — for one-time events shows the calendar month;
          for already-active recurring events shows a recycle icon
          since the start year is "before the window" and isn't useful. */}
      <div className="flex items-center text-sm text-[var(--dxp-text-muted)]">
        {alreadyActive ? (
          <span className="text-xs italic">since {e.startDate.slice(0, 4)}</span>
        ) : (
          <span className="font-mono">{monthLabel}</span>
        )}
      </div>

      {/* Event body — icon + name + cadence note */}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          {e.frequency === 'ONE_TIME' ? (
            <Zap className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
          ) : (
            <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-[var(--dxp-brand)]" />
          )}
          <span className="truncate text-sm font-semibold text-[var(--dxp-text)]">
            {e.name}
          </span>
        </div>
        <div className="ml-5 flex items-center gap-2 text-xs text-[var(--dxp-text-muted)]">
          <span>{KIND_LABELS[e.sourceKind]}</span>
          <span>·</span>
          <span>{frequencyLabel(e)}</span>
          {e.growthPctPerYear > 0 && (
            <>
              <span>·</span>
              <span>grows {e.growthPctPerYear.toFixed(1)}%/yr</span>
            </>
          )}
          {!e.autoDerived && (
            <>
              <span>·</span>
              <Badge variant="info">Manual</Badge>
            </>
          )}
        </div>
      </div>

      {/* Amount cell — right-aligned. The amount is the per-occurrence
          value; cadence above already says monthly/yearly/one-time. */}
      <div className="flex flex-col items-end justify-center text-right">
        <span className="text-sm font-semibold tabular-nums text-[var(--dxp-text)]">
          {formatINR(e.amountPaisa)}
        </span>
        <div className="mt-0.5">{taxBadge(e.taxTreatment)}</div>
      </div>
    </div>
  );
}
