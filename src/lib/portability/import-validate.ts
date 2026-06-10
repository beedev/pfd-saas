/**
 * Sprint 6.4c — strict structural validator for export payloads.
 * Sprint S11 — per-column row validation driven by Drizzle column
 * metadata (hand-rolled; see note below on why not drizzle-zod).
 *
 * Used in two places:
 *   1. POST /api/portability/import — validates the upload before
 *      previewing the diff and storing the file for the confirm step.
 *   2. POST /api/portability/import/confirm — re-validates on read-back
 *      (defense in depth: the on-disk file could have been edited).
 *
 * All errors are collected into a single array — multiple problems
 * surface in one round trip instead of one-by-one.
 *
 * Row validation policy (conservative — type safety only, NO business
 * range checks, so any legitimate export always round-trips):
 *   - each present value must match the column's primitive type
 *     (see COLUMN_KIND_BY_TYPE); integer columns — including every
 *     bigint(mode:'number') paisa column — reject non-integers and
 *     non-finite values
 *   - `null` is allowed only when the column is nullable
 *   - UNKNOWN KEYS ARE STRIPPED, not rejected — counted per table and
 *     surfaced in the result (`strippedUnknownKeys`); the cleaned rows
 *     (sans unknown keys) are what `data` carries forward to insert
 *   - missing keys are NOT errors (export emits every column; partial
 *     rows fall through to Postgres defaults/constraints)
 *   - `id` is preserved verbatim; `userId` is skipped here because
 *     import-commit force-overrides it with the importing user's id
 *
 * Why not drizzle-zod: although drizzle-zod 0.8.x is peer-compatible
 * with drizzle-orm 0.45.2 + zod 4, createInsertSchema() emits
 * `z.date()` for timestamp(mode:'date') columns while the JSON payload
 * carries ISO strings there — every one of the ~136 timestamp columns
 * would need a manual override — and zod strips unknown keys silently,
 * so counting them needs a manual key-diff anyway. The metadata-driven
 * validator below matches the wire format exactly with no new dep.
 */

import { getTableColumns } from 'drizzle-orm';
import { MANIFEST } from './table-manifest';
import { EXPORT_VERSION } from './constants';
import { SCHEMA_HASH } from './schema-hash.generated';
import type { ExportPayload, TableExport } from './export';

const MANIFEST_NAMES = new Set(MANIFEST.map((m) => m.tableName));
const SPEC_BY_NAME = new Map(MANIFEST.map((m) => [m.tableName, m]));

export interface ValidateResult {
  ok: boolean;
  errors?: string[];
  data?: ExportPayload;
  /** Per-table count of unknown keys that were stripped from rows.
   *  Only tables with a non-zero count appear. */
  strippedUnknownKeys?: Record<string, number>;
  /** Sum of all stripped unknown keys across tables. */
  totalStrippedKeys?: number;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/* ─── Per-column row validation (S11) ─────────────────────────────── */

type ColumnKind = 'int' | 'float' | 'string' | 'boolean' | 'json';

interface ColumnRule {
  kind: ColumnKind | undefined; // undefined → unrecognised type, skip type check
  nullable: boolean;
}

/**
 * Map of Drizzle `columnType` → primitive kind expected in the JSON
 * payload. Covers every column type the schema uses today (verified
 * against src/db/schema.ts) plus close siblings for safety. Anything
 * not listed gets nullability checking only — permissive by design so
 * a new column type never breaks legitimate round trips.
 *
 * Note: PgTimestamp (mode:'date') and PgDate (mode:'date') serialise
 * to ISO 8601 strings in JSON — so on the wire they are strings.
 * PgNumeric is returned as a string by postgres-js (precision-safe).
 */
const COLUMN_KIND_BY_TYPE: Record<string, ColumnKind> = {
  PgBigInt53: 'int',
  PgInteger: 'int',
  PgSerial: 'int',
  PgSmallInt: 'int',
  PgSmallSerial: 'int',
  PgBigSerial53: 'int',
  PgReal: 'float',
  PgDoublePrecision: 'float',
  PgText: 'string',
  PgVarchar: 'string',
  PgChar: 'string',
  PgUUID: 'string',
  PgNumeric: 'string',
  PgDateString: 'string',
  PgDate: 'string',
  PgTimestamp: 'string',
  PgTimestampString: 'string',
  PgTime: 'string',
  PgBoolean: 'boolean',
  PgJsonb: 'json',
  PgJson: 'json',
};

/** Lazily-built, cached column rules per table (73 tables — don't pay
 *  the getTableColumns walk at module load). */
const ruleCache = new Map<string, Record<string, ColumnRule>>();

function rulesForTable(tableName: string): Record<string, ColumnRule> | undefined {
  const cached = ruleCache.get(tableName);
  if (cached) return cached;
  const spec = SPEC_BY_NAME.get(tableName);
  if (!spec) return undefined;
  const cols = getTableColumns(
    spec.drizzleTable as unknown as Parameters<typeof getTableColumns>[0],
  );
  const rules: Record<string, ColumnRule> = {};
  for (const [propName, col] of Object.entries(cols)) {
    const meta = col as { columnType?: string; notNull?: boolean };
    rules[propName] = {
      kind: meta.columnType ? COLUMN_KIND_BY_TYPE[meta.columnType] : undefined,
      nullable: !meta.notNull,
    };
  }
  ruleCache.set(tableName, rules);
  return rules;
}

function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return `number ${v}`;
  if (typeof v === 'string') return 'string';
  return typeof v;
}

function typeError(kind: ColumnKind, value: unknown): string | null {
  switch (kind) {
    case 'int':
      // Number.isInteger is false for NaN/±Infinity, so this also
      // rejects non-finite values (the bigint-mode-number paisa guard).
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return `expected integer, got ${describeValue(value)}`;
      }
      return null;
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `expected number, got ${describeValue(value)}`;
      }
      return null;
    case 'string':
      if (typeof value !== 'string') {
        return `expected string, got ${describeValue(value)}`;
      }
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `expected boolean, got ${describeValue(value)}`;
      }
      return null;
    case 'json':
      // jsonb accepts any JSON value (including null handled earlier).
      return null;
  }
}

/**
 * Validate one row against its table's column rules.
 * Returns the cleaned row (unknown keys stripped — a copy is made only
 * when stripping is needed) plus how many keys were stripped. Errors
 * are appended to `errors`, prefixed with table + row index + column.
 */
function validateRow(
  row: Record<string, unknown>,
  rules: Record<string, ColumnRule>,
  prefix: string,
  errors: string[],
): { cleaned: Record<string, unknown>; stripped: number } {
  let cleaned = row;
  let stripped = 0;
  for (const key of Object.keys(row)) {
    const rule = rules[key];
    if (!rule) {
      // Unknown key — strip, don't error (forward-compat with exports
      // that carried since-removed columns).
      if (cleaned === row) cleaned = { ...row };
      delete cleaned[key];
      stripped += 1;
      continue;
    }
    if (key === 'userId') continue; // force-overridden in import-commit
    const value = row[key];
    if (value === null) {
      if (!rule.nullable) {
        errors.push(`${prefix} column '${key}': null not allowed (column is NOT NULL).`);
      }
      continue;
    }
    if (rule.kind) {
      const err = typeError(rule.kind, value);
      if (err) errors.push(`${prefix} column '${key}': ${err}.`);
    }
  }
  return { cleaned, stripped };
}

export function validateExport(json: unknown): ValidateResult {
  const errors: string[] = [];

  if (!isPlainObject(json)) {
    return { ok: false, errors: ['Top-level value must be a JSON object.'] };
  }

  const version = json.version;
  if (version !== EXPORT_VERSION) {
    errors.push(
      `Unsupported export version. Expected '${EXPORT_VERSION}', got '${String(version)}'.`,
    );
  }

  const schemaHash = json.schemaHash;
  if (schemaHash !== SCHEMA_HASH) {
    errors.push(
      `This export was made on a different version of pfd-saas; not safe to import. ` +
        `Expected ${SCHEMA_HASH}, got ${String(schemaHash)}.`,
    );
  }

  if (typeof json.exportedAt !== 'string') {
    errors.push("Field 'exportedAt' must be an ISO-8601 string.");
  }

  if (!Array.isArray(json.data)) {
    errors.push("Field 'data' must be an array of {table, rows}.");
    return { ok: false, errors };
  }

  const seenTables = new Set<string>();
  const tables: TableExport[] = [];
  const strippedUnknownKeys: Record<string, number> = {};
  let totalStrippedKeys = 0;
  for (let i = 0; i < json.data.length; i += 1) {
    const entry: unknown = json.data[i];
    if (!isPlainObject(entry)) {
      errors.push(`data[${i}] is not an object.`);
      continue;
    }
    const t = entry.table;
    if (typeof t !== 'string') {
      errors.push(`data[${i}].table must be a string.`);
      continue;
    }
    if (!MANIFEST_NAMES.has(t)) {
      errors.push(`data[${i}].table '${t}' is not a known portable table.`);
      continue;
    }
    if (seenTables.has(t)) {
      errors.push(`data[${i}].table '${t}' appears more than once.`);
      continue;
    }
    seenTables.add(t);
    if (!Array.isArray(entry.rows)) {
      errors.push(`data[${i}].rows must be an array (table=${t}).`);
      continue;
    }
    // Each row must be a plain object, and each present column value
    // must match the column's type (S11). Unknown keys are stripped
    // and counted, not rejected.
    const rules = rulesForTable(t);
    const rows = entry.rows;
    const cleanedRows: Record<string, unknown>[] = [];
    let tableStripped = 0;
    for (let j = 0; j < rows.length; j += 1) {
      const row = rows[j];
      if (!isPlainObject(row)) {
        errors.push(`data[${i}].rows[${j}] (table=${t}) must be an object.`);
        continue;
      }
      if (!rules) {
        // Should be unreachable (table name already manifest-checked),
        // but never let a lookup miss turn into a crash.
        cleanedRows.push(row);
        continue;
      }
      const { cleaned, stripped } = validateRow(
        row,
        rules,
        `data[${i}].rows[${j}] (table=${t})`,
        errors,
      );
      cleanedRows.push(cleaned);
      tableStripped += stripped;
    }
    if (tableStripped > 0) {
      strippedUnknownKeys[t] = tableStripped;
      totalStrippedKeys += tableStripped;
    }
    tables.push({ table: t, rows: cleanedRows });
  }

  if (errors.length > 0) return { ok: false, errors };

  const payload: ExportPayload = {
    version: version as string,
    exportedAt: json.exportedAt as string,
    schemaHash: schemaHash as string,
    data: tables,
  };
  return { ok: true, data: payload, strippedUnknownKeys, totalStrippedKeys };
}
