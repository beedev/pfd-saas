/**
 * Zerodha tax-P&L (.xlsx) capital-gains parser.
 *
 * Zerodha's console tax-P&L workbook carries a clean "Realized Profit
 * Breakdown" block on the "Equity and Non Equity" and "Mutual Funds"
 * sheets (Short Term / Long Term / Non-Equity profit). We read those
 * summary figures via exceljs — the per-trade rows below them aren't
 * needed. Output maps onto computeAggregateCapitalGainsTax.
 */

import ExcelJS from 'exceljs';
import type { CgStatementParsed, CgStatementRow } from './types';

const EQUITY_SHEET = /Equity and Non Equity/i;
const MF_SHEET = /Mutual Funds/i;

/** Find the numeric value in the cell immediately right of a label match
 *  (column offsets vary — Zerodha indents the breakdown into column B). */
function labelledValue(ws: ExcelJS.Worksheet, label: RegExp): number | null {
  let found: number | null = null;
  ws.eachRow((row) => {
    if (found !== null) return;
    let labelCol = -1;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (labelCol === -1 && typeof cell.value === 'string' && label.test(cell.value)) {
        labelCol = col;
      }
    });
    if (labelCol === -1) return;
    const v = row.getCell(labelCol + 1).value;
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    if (Number.isFinite(n)) found = n;
  });
  return found;
}

function rupeesToPaisa(n: number | null): number {
  return n == null ? 0 : Math.round(n * 100);
}

/** FY from a sheet's "... from 2025-04-01 to 2026-03-31" title row. */
function detectFy(ws: ExcelJS.Worksheet): string | null {
  let fy: string | null = null;
  ws.eachRow((row) => {
    if (fy) return;
    for (let c = 1; c <= 3; c++) {
      const v = row.getCell(c).value;
      const m = typeof v === 'string' && v.match(/from (\d{4})-\d{2}-\d{2} to (\d{4})-\d{2}-\d{2}/);
      if (m) fy = `${m[1]}-${m[2].slice(2)}`;
    }
  });
  return fy;
}

export async function parseZerodhaTaxPnl(buffer: Buffer): Promise<CgStatementParsed> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const equity = wb.worksheets.find((w) => EQUITY_SHEET.test(w.name));
  const mf = wb.worksheets.find((w) => MF_SHEET.test(w.name));
  const fy = (equity && detectFy(equity)) || (mf && detectFy(mf)) || null;
  const saleDate = fy ? `${Number(fy.slice(0, 4)) + 1}-03-31` : null;

  const rows: CgStatementRow[] = [];
  const push = (assetType: string, hp: 'LTCG' | 'STCG', paisa: number) => {
    if (paisa !== 0) rows.push({ assetType, holdingPeriod: hp, saleDate, capitalGainPaisa: paisa, scrip: null });
  };

  if (equity) {
    push('EQUITY', 'STCG', rupeesToPaisa(labelledValue(equity, /^Short Term profit$/i)));
    push('EQUITY', 'LTCG', rupeesToPaisa(labelledValue(equity, /^Long Term profit$/i)));
    // Intraday is speculative business income, not capital gains — skip.
    push('DEBT', 'STCG', rupeesToPaisa(labelledValue(equity, /^Non Equity profit$/i)));
  }
  if (mf) {
    push('EQUITY_MF', 'STCG', rupeesToPaisa(labelledValue(mf, /Short Term profit Equity/i)));
    push('EQUITY_MF', 'LTCG', rupeesToPaisa(labelledValue(mf, /Long Term profit Equity/i)));
    push('DEBT_MF', 'STCG', rupeesToPaisa(labelledValue(mf, /Short Term profit Debt/i)));
    push('DEBT_MF', 'LTCG', rupeesToPaisa(labelledValue(mf, /Long Term profit Debt/i)));
  }

  const totalStcgPaisa = rows.filter((r) => r.holdingPeriod === 'STCG').reduce((s, r) => s + r.capitalGainPaisa, 0);
  const totalLtcgPaisa = rows.filter((r) => r.holdingPeriod === 'LTCG').reduce((s, r) => s + r.capitalGainPaisa, 0);

  return {
    type: 'cg-statement',
    broker: 'ZERODHA',
    fy,
    rows,
    totalStcgPaisa,
    totalLtcgPaisa,
    warnings: rows.length === 0 ? ['No realised capital gains found in the Zerodha tax-P&L workbook.'] : [],
  };
}
