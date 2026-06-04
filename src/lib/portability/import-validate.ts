/**
 * Sprint 6.4c — strict structural validator for export payloads.
 *
 * Used in two places:
 *   1. POST /api/portability/import — validates the upload before
 *      previewing the diff and storing the file for the confirm step.
 *   2. POST /api/portability/import/confirm — re-validates on read-back
 *      (defense in depth: the on-disk file could have been edited).
 *
 * All errors are collected into a single array — multiple problems
 * surface in one round trip instead of one-by-one.
 */

import { MANIFEST } from './table-manifest';
import { EXPORT_VERSION } from './constants';
import { SCHEMA_HASH } from './schema-hash.generated';
import type { ExportPayload, TableExport } from './export';

const MANIFEST_NAMES = new Set(MANIFEST.map((m) => m.tableName));

export interface ValidateResult {
  ok: boolean;
  errors?: string[];
  data?: ExportPayload;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
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
  for (let i = 0; i < json.data.length; i += 1) {
    const entry = json.data[i];
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
    // Each row must itself be a plain object.
    const rows = entry.rows;
    for (let j = 0; j < rows.length; j += 1) {
      if (!isPlainObject(rows[j])) {
        errors.push(`data[${i}].rows[${j}] (table=${t}) must be an object.`);
      }
    }
    tables.push({ table: t, rows: rows as Record<string, unknown>[] });
  }

  if (errors.length > 0) return { ok: false, errors };

  const payload: ExportPayload = {
    version: version as string,
    exportedAt: json.exportedAt as string,
    schemaHash: schemaHash as string,
    data: tables,
  };
  return { ok: true, data: payload };
}
