/**
 * Sprint 6.4d — commit a previously-previewed import in Replace mode.
 *
 * Algorithm:
 *   1. Read the stored payload from uploads/portability/<userId>/<id>.json
 *   2. Re-validate (defense in depth — file could have been edited
 *      after the preview).
 *   3. Open one Drizzle transaction.
 *   4. DELETE every row owned by this user in MANIFEST REVERSE order
 *      (children first, parents last) so FK references collapse cleanly.
 *   5. INSERT every row from the payload in MANIFEST FORWARD order.
 *      - userPreferences uses ON CONFLICT (user_id) DO UPDATE because
 *        its PK is user_id itself; the row is created by onboarding
 *        and never naturally absent.
 *      - All other tables use plain INSERT — the DELETE sweep above
 *        guarantees the destination is empty for this user.
 *      - For every row: `userId` is overwritten with the importing
 *        user's id; every other column (including the `id`) is
 *        preserved verbatim so cross-table FKs stay valid.
 *      - Rows are batched in chunks of 500 to avoid blowing the
 *        Postgres parameter limit (~65k per statement).
 *   6. For each serial-PK table that received rows, advance the
 *      sequence to MAX(id) so subsequent INSERTs from the app don't
 *      collide.
 *   7. Commit. On any throw → Drizzle auto-rolls back.
 *   8. Delete the on-disk file (idempotent — best-effort).
 *
 * Optional-parent handling (tdsCredits.reconciledViaUploadId,
 * projectionCategories.goalId, savingsAssetInclusion.goalId,
 * cashflowEvents.goalId): if the parent row is absent from the payload
 * for any reason, the FK is set to null before insert. The schema
 * already declares these columns as nullable, so this is harmless.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { sql, eq, getTableColumns } from 'drizzle-orm';
import { db } from '@/db';
import { MANIFEST } from './table-manifest';
import { validateExport } from './import-validate';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'portability');
const BATCH_SIZE = 500;

/** Tables whose primary key is `userId` (not a serial id). Special-cased
 *  for ON CONFLICT during INSERT, and skipped during the setval sweep. */
const USER_PK_TABLES = new Set(['userPreferences']);

/** Optional-FK targets that should be nulled when the referenced parent
 *  row is missing from the payload. Keyed by child table → column name
 *  → parent table. */
const OPTIONAL_FKS: Record<string, Record<string, string>> = {
  projectionCategories: { goalId: 'financialGoals' },
  savingsAssetInclusion: { goalId: 'financialGoals' },
  cashflowEvents: { goalId: 'financialGoals' },
  tdsCredits: { reconciledViaUploadId: 'form26asUploads' },
};

export interface CommitResult {
  inserted: Record<string, number>;
  totalInserted: number;
}

/**
 * For each table, list the column names that are timestamp(mode:'date')
 * — Drizzle's postgres-js driver insists on JS Date instances for those
 * columns; raw ISO strings throw `value.toISOString is not a function`.
 *
 * Built once per call from the live Drizzle table metadata so we don't
 * have to hand-maintain a column list.
 */
function buildDateColumnMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const spec of MANIFEST) {
    const cols = getTableColumns(
      spec.drizzleTable as unknown as Parameters<typeof getTableColumns>[0],
    );
    const dateCols: string[] = [];
    for (const [propName, col] of Object.entries(cols)) {
      // Drizzle's PgTimestamp columnType is 'PgTimestamp' for mode:'date'.
      const columnType = (col as { columnType?: string }).columnType;
      if (columnType === 'PgTimestamp' || columnType === 'PgTimestampString') {
        dateCols.push(propName);
      }
    }
    if (dateCols.length > 0) map[spec.tableName] = dateCols;
  }
  return map;
}

export async function commitImport(userId: string, importId: string): Promise<CommitResult> {
  if (!/^[a-f0-9]{32}$/.test(importId)) {
    throw new Error('Invalid importId.');
  }
  const filePath = path.join(UPLOAD_ROOT, userId, `${importId}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    throw new Error('Import file not found. Re-upload to retry.');
  }
  const json = JSON.parse(raw);
  const validation = validateExport(json);
  if (!validation.ok || !validation.data) {
    throw new Error(
      `Stored import failed re-validation: ${(validation.errors ?? []).join('; ')}`,
    );
  }
  const payload = validation.data;

  // Build a quick lookup of which parent tables actually have rows in
  // the payload, used by the optional-FK null-out step.
  const presentIds: Record<string, Set<number>> = {};
  for (const entry of payload.data) {
    const ids = new Set<number>();
    for (const row of entry.rows) {
      const id = (row as { id?: unknown }).id;
      if (typeof id === 'number') ids.add(id);
    }
    presentIds[entry.table] = ids;
  }

  const inserted: Record<string, number> = {};
  const dateColumns = buildDateColumnMap();

  await db.transaction(async (tx) => {
    // 1. DELETE in reverse FK order.
    for (let i = MANIFEST.length - 1; i >= 0; i -= 1) {
      const spec = MANIFEST[i];
      const tbl = spec.drizzleTable as unknown as { userId: unknown };
      await tx.delete(spec.drizzleTable).where(eq(tbl.userId as never, userId));
    }

    // 2. INSERT in forward FK order.
    for (const spec of MANIFEST) {
      const entry = payload.data.find((t) => t.table === spec.tableName);
      inserted[spec.tableName] = 0;
      if (!entry || entry.rows.length === 0) continue;

      // Normalise rows: override userId, null out missing optional FKs,
      // and coerce ISO-string timestamps back into Date instances (which
      // is what the postgres-js driver requires for mode:'date' columns).
      const optionalFkSpec = OPTIONAL_FKS[spec.tableName];
      const dateCols = dateColumns[spec.tableName] ?? [];
      const prepared = entry.rows.map((rawRow) => {
        const row: Record<string, unknown> = { ...rawRow, userId };
        if (optionalFkSpec) {
          for (const [col, parentTable] of Object.entries(optionalFkSpec)) {
            const val = row[col];
            if (val == null) continue;
            const parentIds = presentIds[parentTable];
            if (!parentIds || !parentIds.has(val as number)) {
              row[col] = null;
            }
          }
        }
        for (const col of dateCols) {
          const val = row[col];
          if (typeof val === 'string' && val.length > 0) {
            row[col] = new Date(val);
          }
        }
        return row;
      });

      if (USER_PK_TABLES.has(spec.tableName)) {
        // userPreferences: ON CONFLICT (user_id) DO UPDATE so an existing
        // row from onboarding gets overwritten rather than colliding.
        for (const row of prepared) {
          // Drizzle's onConflictDoUpdate needs the set object; build it from
          // every non-userId column in the row.
          const set: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (k === 'userId') continue;
            set[k] = v;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (tx.insert(spec.drizzleTable) as any)
            .values(row)
            .onConflictDoUpdate({
              target: (spec.drizzleTable as unknown as { userId: unknown }).userId,
              set,
            });
        }
        inserted[spec.tableName] = prepared.length;
        continue;
      }

      // Batched plain INSERT.
      for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
        const chunk = prepared.slice(i, i + BATCH_SIZE);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx.insert(spec.drizzleTable) as any).values(chunk);
      }
      inserted[spec.tableName] = prepared.length;
    }

    // 3. Advance sequences for every serial-PK table that received rows.
    //    Drizzle's pgTable doesn't expose the underlying SQL name as a
    //    plain string; pg_get_serial_sequence walks the catalog by
    //    table_name + column_name, so we resolve the wire-protocol name
    //    via Drizzle's internal Symbol.
    for (const spec of MANIFEST) {
      if (USER_PK_TABLES.has(spec.tableName)) continue;
      if ((inserted[spec.tableName] ?? 0) === 0) continue;
      // Drizzle pgTable: `getTableConfig` would also work; we use the
      // internal symbol for speed and zero imports.
      const tableSym = Object.getOwnPropertySymbols(spec.drizzleTable).find(
        (s) => s.description === 'drizzle:Name',
      );
      if (!tableSym) {
        throw new Error(
          `Could not resolve SQL table name for '${spec.tableName}' (Drizzle internal symbol missing).`,
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sqlName = (spec.drizzleTable as any)[tableSym] as string;
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence(${sqlName}, 'id'), COALESCE((SELECT MAX(id) FROM ${sql.identifier(sqlName)}), 1), true)`,
      );
    }
  });

  // 4. Clean up the upload (best-effort).
  try {
    await fs.unlink(filePath);
  } catch {
    /* not fatal — file may already be gone */
  }

  const totalInserted = Object.values(inserted).reduce((s, n) => s + n, 0);
  return { inserted, totalInserted };
}
