/**
 * Sprint 6.2d — Excel generator helpers (exceljs-backed).
 *
 * Conventions used across every workbook:
 *   • Sheet 1 = Summary (totals only)
 *   • Sheet 2..N-1 = Detail (per logical group)
 *   • Sheet N = Metadata (FY, generated-at, user, schema version)
 *
 * Currency: stored as JS numbers in rupees (paisa / 100). We don't
 * use Excel number formatting (it varies between Excel/Calc) — let
 * the consumer format. The Summary sheet uses a string column for
 * `inr()`-formatted display values; raw numbers live in Detail sheets
 * for downstream formula use.
 *
 * Column widths are estimated from the longest cell in each column
 * (capped at 50 chars) so the workbook opens with sensible widths
 * without per-sheet hand-tuning.
 *
 * Migrated from SheetJS (`xlsx`, prototype-pollution CVE-2023-30533 +
 * ReDoS, no patched release) to `exceljs`. Generators now build sheets
 * via appendSheet(wb, spec) and writeWorkbook() is async
 * (exceljs serialisation returns a Promise).
 */

import ExcelJS from 'exceljs';
import { SCHEMA_HASH } from '@/lib/portability/schema-hash.generated';

export type Workbook = ExcelJS.Workbook;

export interface SheetSpec {
  name: string;
  rows: (string | number | boolean | null)[][];
}

/** Create an empty workbook. */
export function newWorkbook(): Workbook {
  return new ExcelJS.Workbook();
}

/** Append a sheet built from a 2D array of cells, with auto column
 *  widths. First row is treated as the header (no special formatting
 *  beyond the natural Excel layout). */
export function appendSheet(wb: Workbook, spec: SheetSpec): void {
  const ws = wb.addWorksheet(spec.name);
  for (const row of spec.rows) ws.addRow(row);

  // Auto column widths — Math.max of cell-as-string length across all rows.
  if (spec.rows.length > 0) {
    const colCount = Math.max(...spec.rows.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
      let max = 8;
      for (const row of spec.rows) {
        const v = row[c];
        const s = v == null ? '' : String(v);
        if (s.length > max) max = s.length;
      }
      ws.getColumn(c + 1).width = Math.min(50, max + 2);
    }
  }
}

/** Standard metadata sheet appended as the last sheet of every report
 *  workbook. Includes the schema hash so a downstream auditor can
 *  verify the data was generated against the same schema version. */
export function metadataSheet(opts: {
  reportId: string;
  title: string;
  fy?: string;
  userId: string;
}): SheetSpec {
  return {
    name: 'Metadata',
    rows: [
      ['Field', 'Value'],
      ['Report ID', opts.reportId],
      ['Title', opts.title],
      ['Financial Year', opts.fy ?? '—'],
      ['Generated At (UTC ISO)', new Date().toISOString()],
      ['User ID', opts.userId],
      ['Schema Hash', SCHEMA_HASH],
      ['Product', 'pfd-saas v0.6.2'],
    ],
  };
}

/** Convert paisa → rupees as a JS number for Excel-side math. */
export function rs(paisa: bigint | number | null | undefined): number {
  if (paisa == null) return 0;
  const n = typeof paisa === 'bigint' ? Number(paisa) : paisa;
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Serialise a workbook to a Buffer suitable for HTTP response. */
export async function writeWorkbook(wb: Workbook): Promise<Buffer> {
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
