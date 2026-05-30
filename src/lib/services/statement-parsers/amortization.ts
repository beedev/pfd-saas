/**
 * Amortization schedule parser.
 * Supports CSV and PDF formats.
 *
 * Expected columns (flexible naming):
 *   Month/No, Date, Opening/Outstanding, EMI/Installment, Principal, Interest, Closing/Balance
 *
 * All amounts are parsed as rupees and returned as paisa.
 */

import Papa from 'papaparse';

export interface AmortizationParsedRow {
  monthNumber: number;
  dueDate: string | null;       // ISO date or null
  openingBalance: number;       // paisa
  emi: number;                  // paisa
  principal: number;            // paisa
  interest: number;             // paisa
  closingBalance: number;       // paisa
}

/**
 * Bank header metadata pulled from the top of the schedule (loan amount, EMI,
 * tenure, ROI, disbursement date, loan account number, applicant). All
 * optional — present when the parser can find them.
 */
export interface AmortizationMeta {
  loanAmountPaisa?: number;
  emiPaisa?: number;
  tenureMonths?: number;
  annualRate?: number;
  disbursementDate?: string | null;
  loanAccountNo?: string;
  applicant?: string;
}

export interface AmortizationParseResult {
  rows: AmortizationParsedRow[];
  meta?: AmortizationMeta;
  warnings: string[];
}

const toPaisa = (v: number) => Math.round(v * 100);

/**
 * Normalize a header name to a canonical key.
 */
function normalizeHeader(h: string): string {
  const s = h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  if (/^(month|no|sno|slno|instalment|installmentno|emi\s*no)/.test(s)) return 'month';
  if (/^(date|duedate|paymentdate|emidate)/.test(s)) return 'date';
  if (/^(open|outstand|beginbal|beginningbal)/.test(s)) return 'opening';
  if (/^(emi|installment|instalment|totalemi|monthlyemi|payment)/.test(s)) return 'emi';
  if (/^(princ)/.test(s)) return 'principal';
  if (/^(int)/.test(s)) return 'interest';
  if (/^(clos|endbal|endingbal|balance|remainbal|outstandingafter)/.test(s)) return 'closing';
  return s;
}

/**
 * Parse a number from a cell that may have ₹, commas, parentheses (negative), etc.
 */
function parseNum(val: unknown): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const s = String(val).replace(/[₹,\s]/g, '').replace(/\((.+)\)/, '-$1');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Try to parse a date from various formats.
 * Returns ISO date string or null.
 */
function parseDate(val: unknown): string | null {
  if (!val) return null;
  const s = String(val).trim();
  if (!s || s === '-') return null;

  // Try ISO format first (2026-04-01)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mdy) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  }

  // Try DD-Mon-YY or DD-Mon-YYYY  (e.g. "31-Dec-24", "31-December-2024")
  const dmonY = s.match(/^(\d{1,2})[\s\-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-](\d{2}|\d{4})$/i);
  if (dmonY) {
    const day = parseInt(dmonY[1], 10);
    const month = MONTH_INDEX[dmonY[2].slice(0, 3).toLowerCase()];
    let year = parseInt(dmonY[3], 10);
    if (year < 100) year += 2000;
    if (month) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Try natural language (e.g., "Apr 2026", "1 Apr 2026")
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);

  return null;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse "Mon YY" or "Mon YYYY" into the last day of that month (ISO date).
 * EMIs are conventionally due on the last day of the month for this format.
 */
function parseMonthYearToEom(s: string): string | null {
  const m = s.trim().match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2}|\d{4})$/i);
  if (!m) return null;
  const month = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  if (!month) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Parse CSV content into amortization rows.
 */
export function parseAmortizationCsv(csvContent: string): AmortizationParseResult {
  const warnings: string[] = [];

  const result = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (result.errors.length > 0) {
    warnings.push(...result.errors.map(e => `Row ${e.row}: ${e.message}`));
  }

  if (!result.data.length) {
    return { rows: [], warnings: ['No data rows found in CSV'] };
  }

  // Map headers to canonical names
  const rawHeaders = result.meta.fields || [];
  const headerMap: Record<string, string> = {};
  for (const h of rawHeaders) {
    headerMap[h] = normalizeHeader(h);
  }

  // Check required columns
  const mapped = new Set(Object.values(headerMap));
  const required = ['emi', 'principal', 'interest'];
  const missing = required.filter(r => !mapped.has(r));
  if (missing.length) {
    warnings.push(`Missing columns: ${missing.join(', ')}. Will use 0 for missing values.`);
  }

  const rows: AmortizationParsedRow[] = [];
  let autoMonth = 1;

  for (const raw of result.data as Record<string, unknown>[]) {
    // Build a normalized record
    const norm: Record<string, unknown> = {};
    for (const [origKey, canonKey] of Object.entries(headerMap)) {
      norm[canonKey] = raw[origKey];
    }

    const emi = parseNum(norm.emi);
    const principal = parseNum(norm.principal);
    const interest = parseNum(norm.interest);
    const opening = parseNum(norm.opening);
    const closing = parseNum(norm.closing);

    // Skip rows that look like headers or totals (all zeros or very small)
    if (emi === 0 && principal === 0 && interest === 0) continue;

    const monthNumber = norm.month ? Math.round(parseNum(norm.month)) || autoMonth : autoMonth;

    rows.push({
      monthNumber,
      dueDate: parseDate(norm.date),
      openingBalance: toPaisa(opening),
      emi: toPaisa(emi),
      principal: toPaisa(principal),
      interest: toPaisa(interest),
      closingBalance: toPaisa(closing || (opening - principal)),
    });

    autoMonth = monthNumber + 1;
  }

  if (!rows.length) {
    warnings.push('No valid amortization rows found');
  }

  return { rows, warnings };
}

/**
 * Parse a row-grouped PDF schedule (output of extractPdfRows) into amortization
 * rows + header metadata.
 *
 * Columns expected per data row (positional, tab-separated):
 *   S.No | Opening | EMI | Principal | Interest | Closing | [Due Month] | [Receipt Date]
 *
 * A row is accepted only if:
 *   1. First cell is a small integer (1..600).
 *   2. Next five cells parse as positive numbers.
 *   3. Opening − Principal ≈ Closing  (±2 rupees).
 *   4. Principal + Interest ≈ EMI     (±2 rupees).
 *
 * These two sanity equations make the parser format-agnostic enough to accept
 * any bank that lays its columns out in this conventional order, and reject
 * anything else cleanly instead of silently mis-mapping. Other column orders
 * can be added by detecting the header and permuting the index lookup.
 */
export function parseAmortizationPdfRows(rows: string[]): AmortizationParseResult {
  const warnings: string[] = [];
  const out: AmortizationParsedRow[] = [];

  const meta = extractAmortMeta(rows);

  for (const row of rows) {
    const cells = row.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 6) continue;
    if (!/^\d{1,3}$/.test(cells[0])) continue;
    const sno = parseInt(cells[0], 10);
    if (sno < 1 || sno > 600) continue;

    const opening = parseNum(cells[1]);
    const emi = parseNum(cells[2]);
    const principal = parseNum(cells[3]);
    const interest = parseNum(cells[4]);
    const closing = parseNum(cells[5]);

    if (opening <= 0 || emi <= 0 || principal <= 0 || interest <= 0 || closing < 0) continue;
    if (Math.abs(opening - principal - closing) > 2) continue;
    if (Math.abs(principal + interest - emi) > 2) continue;

    // Optional date cells. Receipt Date (col 7) is more precise; fall back to
    // Due Month (col 6) → last day of that month for future-dated rows.
    let dueDate: string | null = null;
    if (cells[7]) dueDate = parseDate(cells[7]);
    if (!dueDate && cells[6]) dueDate = parseMonthYearToEom(cells[6]) ?? parseDate(cells[6]);

    out.push({
      monthNumber: sno,
      dueDate,
      openingBalance: toPaisa(opening),
      emi: toPaisa(emi),
      principal: toPaisa(principal),
      interest: toPaisa(interest),
      closingBalance: toPaisa(closing),
    });
  }

  if (!out.length) {
    warnings.push(
      'No amortization rows detected. Expected columns: S.No, Opening, EMI, Principal, Interest, Closing. Try CSV if the PDF layout differs.',
    );
  } else {
    warnings.push(`Parsed ${out.length} rows from PDF.`);
  }
  return { rows: out, meta, warnings };
}

/**
 * Pull the header block (loan amount, EMI, tenure, ROI, disbursement date,
 * loan account no, applicant). Tolerant of single-row or multi-row layouts —
 * scans the first 10 rows for "Label : Value" pairs.
 */
function extractAmortMeta(rows: string[]): AmortizationMeta {
  const meta: AmortizationMeta = {};
  const head = rows.slice(0, 10).join('\n');
  const grab = (re: RegExp): string | undefined => {
    const m = head.match(re);
    return m ? m[1].trim() : undefined;
  };

  const loanAmt = grab(/Loan\s*Amount\s*[:\t]\s*([\d.,]+)/i);
  if (loanAmt) meta.loanAmountPaisa = toPaisa(parseNum(loanAmt));

  const emi = grab(/EMI\s*[:\t]\s*([\d.,]+)/i);
  if (emi) meta.emiPaisa = toPaisa(parseNum(emi));

  const tenure = grab(/Tenure\s*[:\t]\s*(\d+)\s*Months?/i);
  if (tenure) meta.tenureMonths = parseInt(tenure, 10);

  const roi = grab(/ROI\s*[:\t]\s*([\d.]+)\s*%/i);
  if (roi) meta.annualRate = parseFloat(roi);

  const disb = grab(/Disbursement\s*Date\s*[:\t]\s*([0-9A-Za-z\-\/.]+)/i);
  if (disb) meta.disbursementDate = parseDate(disb);

  const acct = grab(/Loan\s*Account\s*No\s*[:\t]\s*([A-Za-z0-9\-_]+)/i);
  if (acct) meta.loanAccountNo = acct;

  const applicant = grab(/Applicant\s*[:\t]\s*([A-Za-z][A-Za-z\s.]+?)(?:\t|\n|Disbursement|Loan\s*Account)/i);
  if (applicant) meta.applicant = applicant.trim();

  return meta;
}

/**
 * @deprecated Kept for backward compat with anything still calling it. Now a
 * thin shim that splits the flat text by spaces and falls back to the line
 * parser's old behaviour, which is rarely correct. Prefer
 * parseAmortizationPdfRows + extractPdfRows.
 */
export function parseAmortizationPdfText(text: string): AmortizationParseResult {
  return parseAmortizationPdfRows(text.split('\n'));
}
