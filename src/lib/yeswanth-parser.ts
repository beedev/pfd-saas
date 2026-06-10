/**
 * Yeswanth TaxCalc xlsx parser — Sprint 5.1d.
 *
 * Parses the Nithyanand Yeswanth FY 2026-27 (and forward-compatible)
 * tax-calculation spreadsheet into the pfd-saas domain shape. The
 * spreadsheet is the user's authoritative reference; we mirror its
 * structure rather than approximate it.
 *
 * Tabs parsed:
 *
 *   • "IT 2026-27" (or whatever year)
 *     - Earnings (rows 4–22, B=label, D..O=monthly Apr..Mar)
 *     - Bonus / Perks / Others (cols P–T per month)
 *     - Deductions (rows 23–37, B=label, D..O monthly)
 *     - Setup params (V52..W75, value typically in W)
 *     - Housing loan (Q66..T73)
 *     - 80G donations (Q51..T56)
 *
 *   • "Bank int, Tax paid"
 *     - Bank/FD interest (rows 5..30, B=name, C=FD int, D=TDS, E=SB)
 *     - Taxes paid outside salary (rows 38..)
 *
 *   • "Dividends" — rows 5.. (B=date, C=desc, D=amt, E=TDS)
 *
 *   • Capital Gains tabs — equity / property / foreign equity rows
 *
 * Returned structure is preview JSON only — confirm endpoint applies
 * the writes. DO NOT log parsed content (sensitive financial data).
 *
 * Reference: /Users/bharath/Downloads/TaxCalc_2027.xlsx
 *   © 1997-2026, Nithyanand Yeswanth (taxcalc@ynithya.com)
 */

import ExcelJS from 'exceljs';

// ─── Workbook adapter ────────────────────────────────────────────────
//
// The extraction logic below was written against SheetJS's sparse
// cell-map shape (`sheet['B4'].v` = computed raw value). To migrate
// off the vulnerable `xlsx` package without touching the extraction
// logic, we load via exceljs and project the workbook into the same
// lite shape: address → { v } where v matches SheetJS `raw: true`
// semantics (formula cells → cached result, dates → Excel serial
// numbers, rich text → concatenated plain text, errors/empty → absent).

interface CellLite {
  v: string | number | boolean;
}
type SheetLite = Record<string, CellLite>;
interface WorkbookLite {
  SheetNames: string[];
  Sheets: Record<string, SheetLite>;
}

/** JS Date (UTC, as exceljs produces) → Excel 1900-system serial. */
function dateToExcelSerial(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

/** Normalise an exceljs cell value to SheetJS `.v` semantics. */
function cellValueToLite(v: ExcelJS.CellValue): string | number | boolean | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return dateToExcelSerial(v);
  if (typeof v === 'object') {
    // Formula / shared-formula cells carry the cached result.
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) {
      return cellValueToLite((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    }
    if ('richText' in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    }
    if ('error' in v) return undefined;
    if ('text' in v) {
      return cellValueToLite((v as ExcelJS.CellHyperlinkValue).text as ExcelJS.CellValue);
    }
    return undefined;
  }
  return v;
}

/** Project an exceljs workbook into the sparse lite shape. */
function workbookToLite(wb: ExcelJS.Workbook): WorkbookLite {
  const lite: WorkbookLite = { SheetNames: [], Sheets: {} };
  for (const ws of wb.worksheets) {
    const sheet: SheetLite = {};
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        // Merged slave cells mirror the master's value in exceljs;
        // SheetJS stores only the top-left cell. Skip slaves to match.
        if (cell.type === ExcelJS.ValueType.Merge) return;
        const v = cellValueToLite(cell.value);
        if (v === undefined) return;
        sheet[cell.address] = { v };
      });
    });
    lite.SheetNames.push(ws.name);
    lite.Sheets[ws.name] = sheet;
  }
  return lite;
}

export interface YeswanthSalaryComponents {
  basicPaisa: number;
  daPaisa: number;
  hraReceivedPaisa: number;
  ltaPaisa: number;
  conveyancePaisa: number;
  childrenEdAllowancePaisa: number;
  medicalPaisa: number;
  otherAllowancesPaisa: number;
  rentPaidMonthlyPaisa: number;
  /** Salary TDS deducted by the employer (R26 "IT" in the Yeswanth
   *  template — annual sum across D..O). Flows to salary_income.tds_paisa
   *  on confirm. */
  salaryTdsPaisa: number;
}

export interface YeswanthSetupParams {
  metroCity?: boolean;
  isSrCitizen?: boolean;
  spouseIsSrCitizen?: boolean;
  parentsAreSrCitizens?: boolean;
  hasPermanentDisability?: boolean;
  disabilitySeverity?: 'REGULAR' | 'SEVERE' | null;
  isFamilyPensioner?: boolean;
  isGovtEmployeeForNps?: boolean;
}

export interface YeswanthHousingLoan {
  rentalIncomeAnnualRupees: number;
  municipalTaxesAnnualRupees: number;
  homeLoanInterestRentedRupees: number;
  homeLoanInterestSelfOccupiedRupees: number;
  loanTakenAfter1Apr1999: boolean;
  section80EeaEligible: boolean;
}

export interface YeswanthDeduction {
  section: string;
  description: string;
  amountRupees: number;
  /** For 80D rows: SELF_FAMILY or PARENTS. */
  eightyDBucket?: 'SELF_FAMILY' | 'PARENTS';
}

export interface YeswanthDividendRow {
  date: string;
  description: string;
  amountRupees: number;
  tdsRupees: number;
}

export interface YeswanthBankInterestRow {
  bankName: string;
  fdInterestRupees: number;
  tdsRupees: number;
  sbInterestRupees: number;
}

export interface YeswanthTaxPaidRow {
  description: string;
  date: string;
  amountRupees: number;
}

export interface YeswanthCapitalGainRow {
  scripName: string;
  purchaseDate: string;
  saleDate: string;
  purchaseRupees: number;
  saleRupees: number;
  longTermFlag: boolean;
}

export interface YeswanthPreview {
  fy: string;
  /** Salary components — monthly Apr..Mar summed × 12 if user enters
   *  per-month; the spreadsheet uses per-month so we sum across all
   *  12 columns to get the annual value. */
  salaryAnnual: YeswanthSalaryComponents;
  setupParams: YeswanthSetupParams;
  housingLoan: YeswanthHousingLoan;
  deductions: YeswanthDeduction[];
  dividends: YeswanthDividendRow[];
  bankInterest: YeswanthBankInterestRow[];
  taxesPaidOutsideSalary: YeswanthTaxPaidRow[];
  capitalGainsEquity: YeswanthCapitalGainRow[];
  capitalGainsForeignEquity: YeswanthCapitalGainRow[];
  capitalGainsPropertyDebt: YeswanthCapitalGainRow[];
}

/** Detect the "IT YYYY-YY" sheet name. */
function detectItSheetName(wb: WorkbookLite): string | null {
  return wb.SheetNames.find((s) => /^IT \d{4}-\d{2}$/.test(s)) ?? null;
}

/** Detect FY from sheet name "IT 2026-27" → "2026-27". */
function detectFy(itSheetName: string): string {
  return itSheetName.replace(/^IT /, '');
}

/** Read a numeric cell, returning 0 for empty/NaN. */
function readNum(sheet: SheetLite, addr: string): number {
  const cell = sheet[addr];
  if (!cell) return 0;
  const v = cell.v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // Some cells are formula results — try .w (formatted text) or 0.
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Read a string cell, returning empty for non-string. */
function readStr(sheet: SheetLite, addr: string): string {
  const cell = sheet[addr];
  if (!cell) return '';
  if (typeof cell.v === 'string') return cell.v;
  if (cell.v == null) return '';
  return String(cell.v);
}

/** Yeswanth template uses Y/N for boolean params. */
function readYN(sheet: SheetLite, addr: string): boolean | undefined {
  const s = readStr(sheet, addr).trim().toUpperCase();
  if (s === 'Y' || s === 'YES') return true;
  if (s === 'N' || s === 'NO') return false;
  return undefined;
}

/** Convert rupees to paisa. */
const toPaisa = (rupees: number) => Math.round(rupees * 100);

/** Sum a range of cells (e.g. D4:O4 = monthly Apr..Mar for row 4). */
function sumRow(sheet: SheetLite, row: number, startCol: string, endCol: string): number {
  const startIdx = colToIdx(startCol);
  const endIdx = colToIdx(endCol);
  let s = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    s += readNum(sheet, idxToCol(i) + row);
  }
  return s;
}

function colToIdx(col: string): number {
  let n = 0;
  for (const c of col) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}
function idxToCol(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Parse setup-parameter block (V52..W75). The label is in V, the
 *  user value typically in W or X. */
function parseSetupParams(sheet: SheetLite): YeswanthSetupParams {
  // Yeswanth setup labels live in column V starting row 52. The user
  // value is to the right (typically column W or AB).
  const params: YeswanthSetupParams = {};
  // V52: Metro/Non-metro (M or N) → W52
  const metroChar = readStr(sheet, 'W52').trim().toUpperCase();
  if (metroChar === 'M') params.metroCity = true;
  else if (metroChar === 'N') params.metroCity = false;

  // V60..V64 — sr-citizen / disability flags
  params.isSrCitizen = readYN(sheet, 'W60');
  params.parentsAreSrCitizens = readYN(sheet, 'W61');
  params.spouseIsSrCitizen = readYN(sheet, 'W62');
  params.hasPermanentDisability = readYN(sheet, 'W64');
  const severityYN = readYN(sheet, 'W65');
  if (params.hasPermanentDisability && severityYN === true) {
    params.disabilitySeverity = 'SEVERE';
  } else if (params.hasPermanentDisability) {
    params.disabilitySeverity = 'REGULAR';
  }
  params.isFamilyPensioner = readYN(sheet, 'W71');
  params.isGovtEmployeeForNps = readYN(sheet, 'W72');
  return params;
}

/** Sum a salary-component row across months Apr (D) through Mar (O). */
function annualSum(sheet: SheetLite, row: number): number {
  return sumRow(sheet, row, 'D', 'O');
}

/** Parse the Earnings section (rows 4..22). */
function parseSalary(sheet: SheetLite): YeswanthSalaryComponents {
  // Row map per the FY 2026-27 template (column B label):
  //   R4 = Basic, R5 = DA, R6 = Convey, R7 = HRA, R8 = Ch. Educ
  //   R9 = Medical, R10 = LTA, R11 = Uniform All., R12 = Car allow
  //   R13..R21 = Misc (otherAllowances), R22 = Total
  // Rent paid is in row 27 (B=Rent).
  return {
    basicPaisa: toPaisa(annualSum(sheet, 4)),
    daPaisa: toPaisa(annualSum(sheet, 5)),
    conveyancePaisa: toPaisa(annualSum(sheet, 6)),
    hraReceivedPaisa: toPaisa(annualSum(sheet, 7)),
    childrenEdAllowancePaisa: toPaisa(annualSum(sheet, 8)),
    medicalPaisa: toPaisa(annualSum(sheet, 9)),
    ltaPaisa: toPaisa(annualSum(sheet, 10)),
    otherAllowancesPaisa: toPaisa(
      annualSum(sheet, 11) + // Uniform
      annualSum(sheet, 12) + // Car allow
      annualSum(sheet, 13) + annualSum(sheet, 14) + annualSum(sheet, 15) +
      annualSum(sheet, 16) + annualSum(sheet, 17) + annualSum(sheet, 18) +
      annualSum(sheet, 19) + annualSum(sheet, 20) + annualSum(sheet, 21),
    ),
    // Rent — divided by 12 to get monthly rate (schema stores monthly).
    rentPaidMonthlyPaisa: toPaisa(annualSum(sheet, 27) / 12),
    // R26 "IT" — income tax deducted by the employer from salary across
    // the year. Maps to salary_income.tds_paisa, not to a deduction row.
    salaryTdsPaisa: toPaisa(annualSum(sheet, 26)),
  };
}

/** Housing loan + 80EEA fields (Q65..T73 area). */
function parseHousingLoan(sheet: SheetLite): YeswanthHousingLoan {
  return {
    rentalIncomeAnnualRupees: readNum(sheet, 'T66'),
    municipalTaxesAnnualRupees: readNum(sheet, 'T67'),
    homeLoanInterestRentedRupees: readNum(sheet, 'T68'),
    homeLoanInterestSelfOccupiedRupees: readNum(sheet, 'T69'),
    loanTakenAfter1Apr1999: readYN(sheet, 'T70') ?? true,
    section80EeaEligible: readYN(sheet, 'T71') ?? false,
  };
}

/** Parse the Deductions block (rows 23..37). Each row has label in B
 *  and monthly columns D..O. We map row labels to standard sections. */
function parseDeductions(sheet: SheetLite, fy: string): YeswanthDeduction[] {
  void fy;
  const rows: YeswanthDeduction[] = [];
  // Row labels per template:
  //   R23=Prof tax → 80GG-ish?(no, employer's prof tax under sec 16)
  //   R24=PF, R25=VPF → 80C
  //   R26=IT (income tax paid — handled separately under tax-paid)
  //   R27=Rent → drives HRA, not a deduction
  //   R28=Life Insur → 80C
  //   R29..R37 = Oth Ded — unlabelled user-defined rows
  const PF = toPaisa(annualSum(sheet, 24));
  const VPF = toPaisa(annualSum(sheet, 25));
  const lifeInsur = toPaisa(annualSum(sheet, 28));

  // The user splits Oth Ded into rows 29..37; the section is in
  // column C (or A in some templates) — we read C29 etc.
  // To stay deterministic and avoid mis-categorising user data, we
  // emit them as generic '80C-like' rows with description from B/C.
  // Caller can re-categorise on the preview page.

  if (PF > 0) {
    rows.push({ section: '80C', description: 'PF (provident fund)', amountRupees: PF / 100 });
  }
  if (VPF > 0) {
    rows.push({ section: '80C', description: 'VPF (voluntary PF)', amountRupees: VPF / 100 });
  }
  if (lifeInsur > 0) {
    rows.push({ section: '80C', description: 'Life Insurance premium', amountRupees: lifeInsur / 100 });
  }

  for (let r = 29; r <= 37; r++) {
    const amount = annualSum(sheet, r);
    if (amount === 0) continue;
    // Section code lives in column C; description in column D's label
    // (sometimes blank). We default to '80C' if unknown.
    const section = readStr(sheet, 'C' + r).trim() || '80C';
    const desc = readStr(sheet, 'B' + r).trim() || 'Other deduction';
    rows.push({ section, description: desc, amountRupees: amount });
  }

  return rows;
}

/** Parse the Bank interest tab. Rows 5..30 typically. */
function parseBankInterest(wb: WorkbookLite): YeswanthBankInterestRow[] {
  const sheet = wb.Sheets['Bank int, Tax paid'];
  if (!sheet) return [];
  const rows: YeswanthBankInterestRow[] = [];
  for (let r = 5; r <= 30; r++) {
    const bankName = readStr(sheet, 'A' + r).trim();
    if (!bankName || bankName.toLowerCase().startsWith('total')) continue;
    const fd = readNum(sheet, 'C' + r);
    const tds = readNum(sheet, 'D' + r);
    const sb = readNum(sheet, 'E' + r);
    if (fd === 0 && tds === 0 && sb === 0) continue;
    rows.push({ bankName, fdInterestRupees: fd, tdsRupees: tds, sbInterestRupees: sb });
  }
  return rows;
}

function parseTaxesPaidOutsideSalary(wb: WorkbookLite): YeswanthTaxPaidRow[] {
  const sheet = wb.Sheets['Bank int, Tax paid'];
  if (!sheet) return [];
  const rows: YeswanthTaxPaidRow[] = [];
  for (let r = 38; r <= 80; r++) {
    const desc = readStr(sheet, 'A' + r).trim();
    const dateCell = sheet['B' + r];
    const amt = readNum(sheet, 'C' + r);
    if (!desc && amt === 0) continue;
    if (desc.toLowerCase().startsWith('total')) continue;
    let dateStr = '';
    if (dateCell) {
      if (typeof dateCell.v === 'number') {
        // Excel date serial → ISO. 25569 = 1970-01-01.
        const date = new Date(Math.round((dateCell.v - 25569) * 86400 * 1000));
        if (!isNaN(date.getTime())) dateStr = date.toISOString().slice(0, 10);
      } else if (typeof dateCell.v === 'string') {
        dateStr = dateCell.v;
      }
    }
    rows.push({ description: desc, date: dateStr, amountRupees: amt });
  }
  return rows;
}

function parseDividends(wb: WorkbookLite): YeswanthDividendRow[] {
  const sheet = wb.Sheets['Dividends'];
  if (!sheet) return [];
  const rows: YeswanthDividendRow[] = [];
  for (let r = 5; r <= 333; r++) {
    const dateCell = sheet['B' + r];
    const desc = readStr(sheet, 'C' + r).trim();
    const amt = readNum(sheet, 'D' + r);
    const tds = readNum(sheet, 'E' + r);
    if (!desc && amt === 0 && tds === 0) continue;
    let dateStr = '';
    if (dateCell) {
      if (typeof dateCell.v === 'number') {
        const date = new Date(Math.round((dateCell.v - 25569) * 86400 * 1000));
        if (!isNaN(date.getTime())) dateStr = date.toISOString().slice(0, 10);
      } else if (typeof dateCell.v === 'string') {
        dateStr = dateCell.v;
      }
    }
    rows.push({ date: dateStr, description: desc, amountRupees: amt, tdsRupees: tds });
  }
  return rows;
}

function parseCgEquity(wb: WorkbookLite, sheetName: string): YeswanthCapitalGainRow[] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const rows: YeswanthCapitalGainRow[] = [];
  for (let r = 7; r <= 540; r++) {
    const name = readStr(sheet, 'A' + r).trim();
    const purchasePrice = readNum(sheet, 'C' + r);
    const salePrice = readNum(sheet, 'F' + r);
    if (!name && purchasePrice === 0 && salePrice === 0) continue;
    const purchaseDateCell = sheet['E' + r];
    const saleDateCell = sheet['H' + r];
    const ltFlag = (readStr(sheet, 'J' + r).trim().toUpperCase() === 'LT') ||
                   (readStr(sheet, 'K' + r).trim().toUpperCase() === 'LT');
    rows.push({
      scripName: name,
      purchaseDate: serialToISO(purchaseDateCell) ?? '',
      saleDate: serialToISO(saleDateCell) ?? '',
      purchaseRupees: purchasePrice,
      saleRupees: salePrice,
      longTermFlag: ltFlag,
    });
  }
  return rows;
}

function serialToISO(cell: CellLite | undefined): string | null {
  if (!cell) return null;
  if (typeof cell.v === 'number') {
    const date = new Date(Math.round((cell.v - 25569) * 86400 * 1000));
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }
  if (typeof cell.v === 'string' && cell.v) return cell.v;
  return null;
}

/**
 * Main entry — parses xlsx buffer into preview JSON. Throws if the
 * file isn't a recognised Yeswanth TaxCalc workbook.
 */
export async function parseYeswanthTaxCalc(buffer: Buffer): Promise<YeswanthPreview> {
  const ewb = new ExcelJS.Workbook();
  try {
    // exceljs's .d.ts types the param as its own ArrayBuffer-flavoured
    // Buffer; Node Buffers are accepted at runtime.
    await ewb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new Error('Could not read the file as an xlsx workbook (corrupt or unsupported format).');
  }
  const wb = workbookToLite(ewb);
  const itSheetName = detectItSheetName(wb);
  if (!itSheetName) {
    throw new Error(
      'Not a recognised Yeswanth TaxCalc workbook (no "IT YYYY-YY" sheet found).',
    );
  }
  const sheet = wb.Sheets[itSheetName];
  const fy = detectFy(itSheetName);

  return {
    fy,
    salaryAnnual: parseSalary(sheet),
    setupParams: parseSetupParams(sheet),
    housingLoan: parseHousingLoan(sheet),
    deductions: parseDeductions(sheet, fy),
    dividends: parseDividends(wb),
    bankInterest: parseBankInterest(wb),
    taxesPaidOutsideSalary: parseTaxesPaidOutsideSalary(wb),
    capitalGainsEquity: parseCgEquity(wb, 'Capital Gains - Equity'),
    capitalGainsForeignEquity: parseCgEquity(wb, 'Cap Gains - Foreign Eq'),
    capitalGainsPropertyDebt: parseCgEquity(wb, 'Cap Gains - Property&Debt'),
  };
}
