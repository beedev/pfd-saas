/**
 * Sprint 6.4b — build a portable export payload for one user.
 *
 * Walks MANIFEST in forward order, SELECTs every row scoped to userId,
 * and assembles the array-of-{table, rows} envelope. IDs are preserved
 * verbatim so the import side can restore the same graph.
 *
 * Serialization notes:
 *   - Drizzle timestamp(mode:'date') returns JS Date → JSON.stringify
 *     emits ISO 8601 strings (round-trips back to Date on import via
 *     Drizzle's value parser).
 *   - Postgres numeric returns string via postgres-js (preserves
 *     precision); we forward verbatim.
 *   - bigint columns declared with { mode: 'number' } return number,
 *     which JSON handles natively.
 */

import { eq, asc, getTableColumns } from 'drizzle-orm';
import { db } from '@/db';
import { MANIFEST } from './table-manifest';
import { EXPORT_VERSION } from './constants';
import { SCHEMA_HASH } from './schema-hash.generated';

export interface TableExport {
  table: string;
  rows: Record<string, unknown>[];
}

export interface ExportPayload {
  version: string;
  exportedAt: string;
  schemaHash: string;
  data: TableExport[];
}

export async function buildExport(userId: string): Promise<ExportPayload> {
  const data: TableExport[] = [];

  for (const spec of MANIFEST) {
    // Every table in MANIFEST is user-scoped — `userId` column is part
    // of the row shape, so the cast is safe.
    const cols = getTableColumns(
      spec.drizzleTable as unknown as Parameters<typeof getTableColumns>[0],
    );
    const tbl = spec.drizzleTable as unknown as { userId: unknown };
    // Deterministic ordering — sort by `id` when present (covers all
    // serial-PK tables), else by `userId` (covers userPreferences which
    // is the only single-row table whose PK is userId). The point is to
    // make export → import → re-export a byte-identical round trip
    // ignoring exportedAt.
    const orderCol = ('id' in cols ? cols.id : cols.userId) as never;
    const rows = (await db
      .select()
      .from(spec.drizzleTable)
      .where(eq(tbl.userId as never, userId))
      .orderBy(asc(orderCol))) as Record<string, unknown>[];

    data.push({ table: spec.tableName, rows });
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    schemaHash: SCHEMA_HASH,
    data,
  };
}
