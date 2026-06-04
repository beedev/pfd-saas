/**
 * Sprint 6.2 — Downloadable reports.
 *
 * Format-agnostic helpers used by PDF/Excel/CSV generators alike.
 *
 * Conventions enforced project-wide (see CLAUDE.md):
 *   • Money is stored as paisa (bigint) → divide by 100 on display.
 *   • Currency rendered via Intl.NumberFormat('en-IN', maximumFractionDigits: 0)
 *     with a leading "₹" prefix.
 *   • FY notation: "FY 2025-26".
 *   • Dates rendered as "dd MMM yyyy" (e.g. "04 Jun 2026").
 *
 * Everything here is pure — no DB, no IO, safe for any runtime.
 */

import { format, parseISO } from 'date-fns';

/** INR formatter — no fractional rupees, Indian grouping (1,23,456). */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'decimal',
  maximumFractionDigits: 0,
});

/** Render a paisa amount as INR with `₹` prefix.
 *  Negative numbers get a minus sign in front of the symbol. */
export function inr(paisa: bigint | number | null | undefined): string {
  if (paisa == null) return '₹0';
  const n = typeof paisa === 'bigint' ? Number(paisa) : paisa;
  if (!Number.isFinite(n)) return '₹0';
  const rupees = n / 100;
  return rupees < 0 ? `-₹${INR.format(-rupees)}` : `₹${INR.format(rupees)}`;
}

/** Same as `inr()` but always includes a sign (`+` for non-negative).
 *  Useful for delta columns where the sign is meaningful. */
export function inrSigned(paisa: bigint | number | null | undefined): string {
  if (paisa == null) return '+₹0';
  const n = typeof paisa === 'bigint' ? Number(paisa) : paisa;
  if (!Number.isFinite(n) || n === 0) return '+₹0';
  const rupees = n / 100;
  return rupees < 0 ? `-₹${INR.format(-rupees)}` : `+₹${INR.format(rupees)}`;
}

/** RFC 4180 CSV cell escape — quotes wrap any cell containing comma,
 *  quote, or newline; embedded quotes are doubled. `null`/`undefined`
 *  become empty strings. */
export function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Strip filename-unfriendly characters so the resulting string can
 *  safely live in a Content-Disposition header on every OS. */
export function safeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** "2025-26" → "FY 2025-26". Pass-through for already-prefixed values. */
export function fyLabel(fy: string): string {
  if (!fy) return '';
  if (fy.toUpperCase().startsWith('FY')) return fy;
  return `FY ${fy}`;
}

/** Indian-FY runs Apr → next-Mar. `monthRange('2025-26')` → Apr-01-2025 .. Mar-31-2026. */
export function monthRange(fy: string): { start: Date; end: Date } {
  const [aStr, bStr] = fy.split('-');
  const startYear = Number(aStr);
  const endYear = startYear + 1;
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
    throw new Error(`Invalid FY: ${fy}`);
  }
  return {
    start: new Date(startYear, 3, 1), // April 1
    end: new Date(endYear, 2, 31),    // March 31
  };
}

/** 12-month grid Apr → Mar with calendar metadata.
 *  Used by the Cashflow report's column headers and downstream
 *  per-month aggregations. `month` is 0-indexed (3 = April). */
export function fyMonths(fy: string): { label: string; year: number; month: number }[] {
  const [aStr] = fy.split('-');
  const startYear = Number(aStr);
  if (!Number.isFinite(startYear)) throw new Error(`Invalid FY: ${fy}`);
  const out: { label: string; year: number; month: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = (3 + i) % 12;               // 3,4,5...11,0,1,2
    const y = startYear + (3 + i >= 12 ? 1 : 0);
    out.push({
      label: format(new Date(y, m, 1), 'MMM yyyy'),
      year: y,
      month: m,
    });
  }
  return out;
}

/** "dd MMM yyyy" — accepts Date, ISO string, or null.
 *  Returns '' for nullish input so callers can compose without
 *  pre-guarding. */
export function fmtDate(d: Date | string | null | undefined): string {
  if (d == null) return '';
  try {
    const dt = typeof d === 'string' ? parseISO(d) : d;
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return '';
    return format(dt, 'dd MMM yyyy');
  } catch {
    return '';
  }
}
