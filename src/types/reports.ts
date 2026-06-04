/**
 * Sprint 6.2 — Downloadable reports.
 *
 * Type vocabulary shared by:
 *   • `src/lib/reports/index.ts`       — registry of REPORTS
 *   • `src/lib/reports/data/fetch*.ts` — canonical fetchers
 *   • `src/lib/reports/pdf|excel|csv`  — format-specific generators
 *   • `src/app/api/reports/[id]/[format]/route.ts` — dynamic dispatch
 *   • `src/components/reports/*.tsx`   — hub + per-screen buttons
 *
 * The registry is the source of truth for which (id × format) combos
 * exist — the dynamic API route refuses anything outside it (400) and
 * the UI only shows chips/menu items the registry declares.
 */

/** Output formats supported by the reports pipeline. */
export type ReportFormat = 'pdf' | 'xlsx' | 'csv' | 'zip';

/** Top-level grouping used by the /reports hub UI. */
export type ReportCategory = 'tax' | 'wealth' | 'planning';

export interface ReportDescriptor {
  /** URL-safe identifier (matches the [id] route segment). */
  id: string;
  /** Human-facing display name shown on the hub and per-screen button. */
  title: string;
  /** Single-line description used in the hub card body. */
  description: string;
  /** Hub grouping. */
  category: ReportCategory;
  /** Formats this report can produce. Anything outside this list 400s. */
  formats: ReportFormat[];
  /** Whether the report scope is FY-dependent — the hub renders an
   *  inline FY selector when true. Non-FY reports (e.g. net worth as-of
   *  today) ignore the param. */
  needsFy: boolean;
}

/** Inputs every fetcher receives. Optional fields are normalised by
 *  the fetcher to safe defaults. */
export interface ReportParams {
  /** Always the authenticated user's id (multi-tenant gate). */
  userId: string;
  /** "YYYY-YY", e.g. "2025-26". Required for FY-scoped reports. */
  fy?: string;
  /** As-of date for snapshot reports (net worth). Defaults to today. */
  asOfDate?: Date;
}
