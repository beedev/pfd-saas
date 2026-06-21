/**
 * Form 16 (TRACES) Part-B parser.
 *
 * Strategy: row-anchored extraction. TRACES PDFs emit Part-B tokens out
 * of visual order, so scanning flat text for "the next number after a
 * label" grabs the wrong cell on the lower table. Instead we use the
 * y-grouped row extractor (`extractPdfRows`) — each TRACES line becomes
 * one visual row whose last cell is the rupee figure — and match labels
 * against whole rows.
 *
 * Part A (quarterly TDS) is a different, separate section that is often
 * absent (Part-B-only certificates); the actual TDS deducted comes from
 * Part A or Form 26AS. We make a best-effort flat-text pass for it and
 * otherwise leave it for manual entry.
 *
 * Tenant-agnostic — the SaaS app imports the same logic verbatim.
 */

export function rupeesNumberToPaisa(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const TAN_RE = /\b([A-Z]{4}[0-9]{5}[A-Z])\b/;
// A whole cell that IS a rupee amount (not a section ref like "17(1)").
const AMOUNT_CELL_RE = /^(?:₹|Rs\.?|INR)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/;

/** Parse one tab-cell as a rupee amount → paisa, or null if non-numeric. */
function cellToPaisa(cell: string): number | null {
  const m = cell.trim().match(AMOUNT_CELL_RE);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? rupeesNumberToPaisa(v) : null;
}

/** Quote-stripped, whitespace-collapsed lowercase text for label matching. */
function rowLabel(row: string): string {
  return row
    .replace(/\t/g, ' ')
    .replace(/["'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Find the rupee figure for a labelled TRACES Form 16 line. The figure is
 * the last numeric cell of the label's row; when a long label wraps onto
 * multiple visual rows the figure lands on the row immediately after, so
 * we fall back to that — then stop, to avoid drifting onto a later line.
 */
function amountForLabel(rows: string[], labelRe: RegExp): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (!labelRe.test(rowLabel(rows[i]))) continue;
    const here = rows[i].split('\t');
    for (let c = here.length - 1; c >= 0; c--) {
      const p = cellToPaisa(here[c]);
      if (p != null) return p;
    }
    if (i + 1 < rows.length) {
      for (const cell of rows[i + 1].split('\t')) {
        const p = cellToPaisa(cell);
        if (p != null) return p;
      }
    }
    return null;
  }
  return null;
}

/** Employer name — the row immediately after the "Employer" header row. */
function findEmployerName(rows: string[], flat: string): string | null {
  const idx = rows.findIndex((r) =>
    /name and address of (the )?(employer|deductor)/i.test(r),
  );
  if (idx >= 0 && idx + 1 < rows.length) {
    const name = rows[idx + 1].split('\t')[0].trim();
    if (name.length >= 3 && !/^name and address/i.test(name)) {
      return name.slice(0, 120);
    }
  }
  const m = flat.match(
    /Name (?:and address )?of (?:the )?(?:Employer|Deductor)[^A-Za-z0-9]*([A-Z0-9][^\n]{2,80})/i,
  );
  return m ? m[1].split(/\s+(?:PAN|TAN|Address)/i)[0].trim().slice(0, 120) : null;
}

/** Employer TAN — the TAN-shaped cell after the "TAN of the Deductor" header. */
function findTan(rows: string[], flat: string): string | null {
  const idx = rows.findIndex((r) => /tan of (the )?deductor/i.test(r));
  if (idx >= 0 && idx + 1 < rows.length) {
    for (const cell of rows[idx + 1].split('\t')) {
      const m = cell.trim().match(TAN_RE);
      if (m) return m[1].toUpperCase();
    }
  }
  const any = flat.match(TAN_RE);
  return any ? any[1].toUpperCase() : null;
}

/**
 * Which half of the Form 16 this PDF is:
 *   - 'A' — TRACES Part A: quarterly TDS deducted/deposited.
 *   - 'B' — employer Part B / Annexure-I: salary breakup + tax computation.
 * A complete Form 16 is the two combined; users upload them separately.
 */
export type Form16Part = 'A' | 'B' | 'UNKNOWN';

export function detectForm16Part(rows: string[], flat: string): Form16Part {
  const f = flat.toLowerCase();
  const hasSalaryComputation =
    rows.some((r) => /income chargeable under the head .?salaries/i.test(rowLabel(r))) ||
    /total taxable income/i.test(f);
  const hasQuarterlyTds =
    rows.some((r) => /^q[1-4]\b/i.test(r.trim())) ||
    /summary of amount paid\/credited and tax deducted/i.test(f);

  // Prefer the explicit "PART A/B" banner, then fall back to content.
  if (/\bpart\s*b\b/i.test(f) && hasSalaryComputation) return 'B';
  if (/\bpart\s*a\b/i.test(f) && hasQuarterlyTds) return 'A';
  if (hasSalaryComputation) return 'B';
  if (hasQuarterlyTds) return 'A';
  return 'UNKNOWN';
}

/**
 * Part A quarterly TDS. Each quarter row is
 *   Qn | <receipt> | <amount paid> | <tax deducted> | <tax deposited>
 * so the three numeric cells are [paid, deducted, deposited]; we credit
 * "tax deducted" (the 2nd number). Total is the sum of the quarters,
 * which sidesteps the several ambiguous "Total (Rs.)" rows on the page.
 */
function quarterTdsDeducted(rows: string[], q: number): number | null {
  const re = new RegExp(`^q${q}\\b`, 'i');
  const row = rows.find((r) => re.test(r.trim()));
  if (!row) return null;
  const nums = row
    .split('\t')
    .map(cellToPaisa)
    .filter((p): p is number => p != null);
  return nums.length >= 2 ? nums[1] : null;
}

export interface Form16ParseResult {
  /** Which half this PDF is — drives merge + which fields are authoritative. */
  sourcePart: Form16Part;
  employerName: string | null;
  employerTan: string | null;
  grossSalaryPaisa: number | null;
  /** Line 2(e) — HRA exemption under section 10(13A). */
  hraExemptionPaisa: number | null;
  /** Line 2(i) — total of all section-10 exemptions (HRA + LTA + …). */
  exemptAllowancesPaisa: number | null;
  standardDeductionPaisa: number | null;
  professionalTaxPaisa: number | null;
  /** Line 6 — income chargeable under the head "Salaries". */
  taxableSalaryPaisa: number | null;
  /** Line 12 — total taxable income (after Chapter VI-A). */
  totalTaxableIncomePaisa: number | null;
  /** Line 13 — tax on total income. */
  taxOnTotalIncomePaisa: number | null;
  /** Line 21 — net tax payable. */
  netTaxPayablePaisa: number | null;
  totalTdsPaisa: number | null;
  quarterlyTdsQ1Paisa: number | null;
  quarterlyTdsQ2Paisa: number | null;
  quarterlyTdsQ3Paisa: number | null;
  quarterlyTdsQ4Paisa: number | null;
  notes: string;
}

/**
 * @param rows row-structured extraction (`extractPdfRows`)
 * @param flat flat token stream (`extractPdfText`) — fallback for TAN /
 *             employer name and the Part A quarterly TDS pass.
 */
export function parseForm16(rows: string[], flat: string): Form16ParseResult {
  const notes: string[] = [];

  const sourcePart = detectForm16Part(rows, flat);

  const employerName = findEmployerName(rows, flat);
  if (!employerName) notes.push('Could not locate employer name.');

  const employerTan = findTan(rows, flat);
  if (!employerTan) notes.push('Could not locate employer TAN.');

  const grossSalaryPaisa =
    amountForLabel(rows, /salary as per provisions contained in section 17.?1/) ??
    amountForLabel(rows, /gross salary/);
  const hraExemptionPaisa = amountForLabel(rows, /house rent allowance under section 10.?13a/);
  const exemptAllowancesPaisa = amountForLabel(
    rows,
    /total amount of exemption claimed under section 10/,
  );
  const standardDeductionPaisa = amountForLabel(rows, /standard deduction under section 16.?ia/);
  const professionalTaxPaisa = amountForLabel(rows, /tax on employment under section 16.?iii/);
  const taxableSalaryPaisa = amountForLabel(rows, /income chargeable under the head salaries/);
  const totalTaxableIncomePaisa = amountForLabel(rows, /total taxable income/);
  const taxOnTotalIncomePaisa = amountForLabel(rows, /tax on total income/);
  const netTaxPayablePaisa = amountForLabel(rows, /net tax payable/);

  if (sourcePart === 'B' && taxableSalaryPaisa == null && totalTaxableIncomePaisa == null) {
    notes.push('Salary figures not detected — verify on the edit page.');
  }

  // Part A — quarterly TDS, row-anchored against the TRACES summary table.
  const quarterlyTdsQ1Paisa = quarterTdsDeducted(rows, 1);
  const quarterlyTdsQ2Paisa = quarterTdsDeducted(rows, 2);
  const quarterlyTdsQ3Paisa = quarterTdsDeducted(rows, 3);
  const quarterlyTdsQ4Paisa = quarterTdsDeducted(rows, 4);
  const quarters = [
    quarterlyTdsQ1Paisa,
    quarterlyTdsQ2Paisa,
    quarterlyTdsQ3Paisa,
    quarterlyTdsQ4Paisa,
  ].filter((p): p is number => p != null);
  const totalTdsPaisa = quarters.length ? quarters.reduce((a, b) => a + b, 0) : null;

  if (sourcePart === 'A' && totalTdsPaisa == null) {
    notes.push('Quarterly TDS not detected — verify on the edit page.');
  }
  if (sourcePart === 'B') {
    notes.push('TDS deducted is in Part A / Form 26AS — upload Part A to capture it.');
  }

  return {
    sourcePart,
    employerName,
    employerTan,
    grossSalaryPaisa,
    hraExemptionPaisa,
    exemptAllowancesPaisa,
    standardDeductionPaisa,
    professionalTaxPaisa,
    taxableSalaryPaisa,
    totalTaxableIncomePaisa,
    taxOnTotalIncomePaisa,
    netTaxPayablePaisa,
    totalTdsPaisa,
    quarterlyTdsQ1Paisa,
    quarterlyTdsQ2Paisa,
    quarterlyTdsQ3Paisa,
    quarterlyTdsQ4Paisa,
    notes: notes.join(' '),
  };
}

// ─── Form 16A — non-salary TDS certificate ──────────────────────────
//
// A separate TRACES document from the salary Form 16. The distinguishing
// signal is the form-number token "16A": a salary Form 16 reads
// "FORM NO. 16" with "PART A" as a SEPARATE banner and never contains
// "16A" adjacent — so a loose "16A" match would misclassify Form 16
// Part A. We anchor on "FORM NO. 16A".

/** True if this PDF is a Form 16A (non-salary TDS certificate). */
export function isForm16A(flat: string): boolean {
  return /form\s*no\.?\s*16\s*a\b/i.test(flat);
}

export interface Form16aParseResult {
  certNumber: string | null;
  deductorName: string | null;
  deductorTan: string | null;
  deducteePan: string | null;
  /** TDS section the cert covers — '194JB', '194J', '194A', … */
  section: string | null;
  /** Certificate period, ISO YYYY-MM-DD. */
  periodFrom: string | null;
  periodTo: string | null;
  /** Indian FY (YYYY-YY) derived from the period END — NOT the AY. */
  fy: string | null;
  /** Quarter label(s) present, e.g. 'Q4' or 'Q2,Q3'. */
  quarter: string | null;
  amountPaidPaisa: number | null;
  tdsPaisa: number | null;
  tdsDepositedPaisa: number | null;
  notes: string;
}

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse "DD-Mon-YYYY" or "DD-MM-YYYY" → ISO YYYY-MM-DD. */
function parseCertDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mo = MONTH_ABBR[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Indian FY (YYYY-YY) containing an ISO date (Apr–Mar). */
function fyForIso(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Parse a Form 16A certificate.
 * @param rows `extractPdfRows` output (tab-separated cells per visual row)
 * @param flat `extractPdfText` flat token stream (cert no / fallback)
 */
export function parseForm16A(rows: string[], flat: string): Form16aParseResult {
  const notes: string[] = [];

  const deductorName = findEmployerName(rows, flat);
  const deductorTan = findTan(rows, flat);

  // Certificate number — row-anchored (flat token order is unreliable):
  // on the "Certificate No." row, the cell right after the label. It's an
  // alphanumeric id (e.g. GVQIGWA), not a date.
  let certNumber: string | null = null;
  const certRowIdx = rows.findIndex((r) => /certificate\s*no/i.test(rowLabel(r)));
  if (certRowIdx >= 0) {
    const cells = rows[certRowIdx].split('\t').map((c) => c.trim());
    const labelAt = cells.findIndex((c) => /certificate\s*no/i.test(c));
    for (let i = labelAt + 1; i < cells.length; i++) {
      if (/^[A-Z0-9]{6,12}$/i.test(cells[i]) && !/\d{1,2}-[A-Za-z]{3}-\d{4}/.test(cells[i])) {
        certNumber = cells[i].toUpperCase();
        break;
      }
    }
  }

  // Deductee PAN — last PAN-shaped token on the "PAN of the deductee" row.
  const panRe = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/g;
  let deducteePan: string | null = null;
  const panHdr = rows.findIndex((r) => /pan of (the )?deductee/i.test(r));
  if (panHdr >= 0 && panHdr + 1 < rows.length) {
    const pans = [...rows[panHdr + 1].matchAll(panRe)].map((m) => m[1]);
    if (pans.length) deducteePan = pans[pans.length - 1].toUpperCase();
  }

  // Period — the row carrying TWO "DD-Mon-YYYY" dates (From | To). The
  // "Last updated on" row has only one, so two-on-a-row is unambiguous.
  const alphaDate = /\b(\d{1,2}-(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{4})\b/gi;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  for (const r of rows) {
    const ds = [...r.matchAll(alphaDate)].map((m) => m[1]);
    if (ds.length >= 2) {
      periodFrom = parseCertDate(ds[0]);
      periodTo = parseCertDate(ds[1]);
      break;
    }
  }
  const fy = fyForIso(periodTo) ?? fyForIso(periodFrom);
  if (!fy) notes.push('Certificate period not found — FY unresolved.');

  // Section — first 19x cell in the payment-summary rows.
  const sectionCellRe = /^19[0-9][A-Z]{0,3}$/;
  let section: string | null = null;
  for (const r of rows) {
    for (const c of r.split('\t').map((x) => x.trim())) {
      if (sectionCellRe.test(c)) { section = c.toUpperCase(); break; }
    }
    if (section) break;
  }

  // Amount paid — first "Total (Rs.)" row (payment-summary total), else
  // the sum of the per-payment rows.
  let amountPaidPaisa = amountForLabel(rows, /total \(rs/);
  if (amountPaidPaisa == null) {
    let sum = 0;
    for (const r of rows) {
      const cells = r.split('\t').map((x) => x.trim());
      if (cells.some((c) => sectionCellRe.test(c))) {
        const monies = cells.map(cellToPaisa).filter((p): p is number => p != null);
        if (monies.length) sum += monies[0];
      }
    }
    amountPaidPaisa = sum || null;
  }

  // Tax deducted — sum across the quarter rows ("Q4 | <receipt> | <deducted>
  // | <deposited>"): 1st money = deducted, 2nd = deposited.
  let tdsPaisa = 0;
  let tdsDepositedPaisa = 0;
  const quarters: string[] = [];
  for (const r of rows) {
    const cells = r.split('\t').map((x) => x.trim());
    if (!/^q[1-4]$/i.test(cells[0] || '')) continue;
    const monies = cells.map(cellToPaisa).filter((p): p is number => p != null);
    if (monies.length >= 1) {
      tdsPaisa += monies[0];
      quarters.push(cells[0].toUpperCase());
    }
    if (monies.length >= 2) tdsDepositedPaisa += monies[1];
  }
  if (tdsPaisa === 0) notes.push('TDS amount not detected — verify on the edit page.');

  // certNumber is the de-dup key (and NOT NULL in the schema). When the
  // cert id can't be read, synthesise a stable per-quarter key so a
  // re-upload still updates in place instead of duplicating.
  if (!certNumber) {
    notes.push('Certificate number not found — using a synthesised key.');
  }
  const effectiveCert =
    certNumber || `${deductorTan ?? 'UNKNOWN'}-${fy ?? 'NA'}-${quarters.join('') || 'Q'}`;

  return {
    certNumber: effectiveCert,
    deductorName,
    deductorTan,
    deducteePan,
    section,
    periodFrom,
    periodTo,
    fy,
    quarter: quarters.length ? quarters.join(',') : null,
    amountPaidPaisa,
    tdsPaisa: tdsPaisa || null,
    tdsDepositedPaisa: tdsDepositedPaisa || null,
    notes: notes.join(' '),
  };
}
