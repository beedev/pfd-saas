/**
 * Sprint 6.2d — Excel generator helpers.
 *
 * Conventions used across every workbook:
 *   • Sheet 1 = Summary (totals only)
 *   • Sheet 2..N-1 = Detail (per logical group)
 *   • Sheet N = Metadata (FY, generated-at, user, schema version)
 *
 * Currency: stored as JS numbers in rupees (paisa / 100). We don't
 * use SheetJS number formatting (it varies between Excel/Calc) — let
 * the consumer format. The Summary sheet uses a string column for
 * `inr()`-formatted display values; raw numbers live in Detail sheets
 * for downstream formula use.
 *
 * Column widths are estimated from the longest cell in each column
 * (capped at 50 chars) so the workbook opens with sensible widths
 * without per-sheet hand-tuning.
 */

import * as XLSX from 'xlsx';
import { SCHEMA_HASH } from '@/lib/portability/schema-hash.generated';

export interface SheetSpec {
  name: string;
  rows: (string | number | boolean | null)[][];
}

/** Convert a 2D array of cells into a sheet with auto column widths.
 *  First row is treated as the header (no special formatting beyond
 *  the natural Excel layout). */
export function makeSheet(spec: SheetSpec): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(spec.rows);

  // Auto column widths — Math.max of cell-as-string length across all rows.
  if (spec.rows.length > 0) {
    const colCount = Math.max(...spec.rows.map((r) => r.length));
    const widths: number[] = [];
    for (let c = 0; c < colCount; c++) {
      let max = 8;
      for (const row of spec.rows) {
        const v = row[c];
        const s = v == null ? '' : String(v);
        if (s.length > max) max = s.length;
      }
      widths.push(Math.min(50, max + 2));
    }
    ws['!cols'] = widths.map((wch) => ({ wch }));
  }
  return ws;
}

/** Standard metadata sheet appended as the last sheet of every report
 *  workbook. Includes the schema hash so a downstream auditor can
 *  verify the data was generated against the same schema version. */
export function metadataSheet(opts: {
  reportId: string;
  title: string;
  fy?: string;
  userId: string;
}): XLSX.WorkSheet {
  return makeSheet({
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
  });
}

/** Convert paisa → rupees as a JS number for Excel-side math. */
export function rs(paisa: bigint | number | null | undefined): number {
  if (paisa == null) return 0;
  const n = typeof paisa === 'bigint' ? Number(paisa) : paisa;
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Serialise a workbook to a Buffer suitable for HTTP response. */
export function writeWorkbook(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf);
}
