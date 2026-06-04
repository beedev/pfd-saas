/**
 * Sprint 6.4 — data portability constants.
 *
 * EXPORT_VERSION:
 *   Embedded in every export file. Bump when the export shape changes
 *   incompatibly (rename fields, restructure, etc). The schema hash gates
 *   schema drift independently — bump EXPORT_VERSION only for envelope
 *   shape changes.
 *
 * EXCLUDED_TABLES:
 *   Tables intentionally NOT exported or imported.
 *
 *   - Auth-owned (`users`, `sessions`, `accounts`, `verificationTokens`):
 *     managed by NextAuth + DrizzleAdapter. The importing user's id is
 *     injected into every row at insert time, so we don't carry the
 *     source identity over.
 *
 *   - Govt reference data (`taxSlabs`, `taxRegimeConfig`,
 *     `costInflationIndex`, `sacCodes`): seeded per container at build
 *     time; not user-scoped.
 *
 *   - Cron state (`scheduledJobs`): machine-specific cron history; never
 *     portable between hosts.
 */
export const EXPORT_VERSION = 'pfd-saas/0.6.4';

export const EXCLUDED_TABLES = [
  'users',
  'sessions',
  'accounts',
  'verificationTokens',
  'taxSlabs',
  'taxRegimeConfig',
  'costInflationIndex',
  'sacCodes',
  'scheduledJobs',
] as const;

export type ExcludedTable = (typeof EXCLUDED_TABLES)[number];
