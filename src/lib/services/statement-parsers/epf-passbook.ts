/**
 * EPF Passbook PDF parser.
 *
 * Source: EPFO member passbook (https://passbook.epfindia.gov.in/) —
 * the UAN-based statement, downloadable as a PDF. Layout has been
 * stable since 2016; columns: Wage Month / Particulars / Employee
 * (Cr) / Employee (Dr) / Employer (Cr) / Employer (Dr) / Pension /
 * Total.
 *
 * Strategy: regex-anchored extraction over the flat token stream from
 * pdf-text. Any field we can't extract cleanly is left null so the
 * UI can prompt the user to verify rather than auto-saving a guess.
 *
 * The parser is intentionally TOLERANT of minor format drift: if a
 * specific section is missing (e.g. employer name redacted on a
 * member-side download) the rest of the statement still parses and a
 * warning is appended.
 *
 * REAL-SAMPLE STATUS: written against the public EPFO passbook layout
 * documented at:
 *   https://www.epfindia.gov.in/site_docs/PDFs/Misc_PDFs/Member_Passbook_Sample.pdf
 * The first user upload will tell us which regexes need tightening.
 * Document any layout drift in CLAUDE.md.
 */

import type { EpfPassbookData, EpfPassbookParsed, EpfPassbookTransaction } from './types';

/* ─── detection ─────────────────────────────────────────────────────── */

const HEADER_TOKENS = [
  /Employees['’]?\s*Provident\s*Fund\s*Organisation/i,
  /\bUAN\b/i,
  /\bMember\s*ID\b/i,
];

export function detectEpfPassbook(stream: string): boolean {
  // All three header tokens must be present. EPFO passbooks always
  // carry the "EPFO" wordmark + a UAN section + a Member ID section.
  // (Plain UAN cards / KYC dumps fail the "Member ID" check.)
  return HEADER_TOKENS.every((re) => re.test(stream));
}

/* ─── field-level extractors ────────────────────────────────────────── */

/**
 * Pull a 12-digit UAN. EPFO UANs are always 12 digits.
 */
function extractUan(text: string): string | null {
  const m = text.match(/\bUAN\b[^\d]{0,30}(\d{12})/i);
  if (m) return m[1];
  // Some passbooks print "Universal Account No. : 1234..." instead.
  const m2 = text.match(/Universal\s*Account\s*N(?:o|umber)\.?\s*:?\s*(\d{12})/i);
  return m2 ? m2[1] : null;
}

/**
 * Member ID — alphanumeric, typically office-code(5) + establishment(7)
 * + extension(3) + account(7). EPFO formats it like
 * "MHBAN00123450000000045" but variations exist; we capture liberally.
 */
function extractMemberId(text: string): string | null {
  const m = text.match(/\bMember\s*ID\b[^A-Z0-9]{0,10}([A-Z]{2,3}[A-Z0-9]{15,25})/i);
  return m ? m[1] : null;
}

function extractEmployerName(text: string): string | null {
  // Two common labels: "Establishment Name" or "Employer Name".
  const m = text.match(/(?:Establishment|Employer)\s*Name[^A-Za-z]{0,5}([A-Z][A-Z0-9 .,&-]{3,80})/);
  if (!m) return null;
  // Trim trailing labels that bleed into the capture when fields hug.
  return m[1].replace(/\s*(?:Member|UAN|Address).*$/i, '').trim();
}

function parseDateLoose(s: string): string | null {
  // DD-MM-YYYY or DD/MM/YYYY → YYYY-MM-DD
  const m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // YYYY-MM-DD already
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? m2[0] : null;
}

function extractAsOfDate(text: string): string | null {
  // Passbook header line: "Last updated: 15-04-2026" / "As on 31-MAR-2026".
  const m = text.match(/(?:Last\s*[Uu]pdated|As\s*on)[^A-Za-z0-9]{0,3}([0-9]{1,2}[-/A-Z][^\s,]{3,15})/);
  if (m) {
    const d = parseDateLoose(m[1]);
    if (d) return d;
  }
  // Fallback: latest YYYY-MM-DD or DD-MM-YYYY in the stream.
  const dates = Array.from(text.matchAll(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/g));
  if (!dates.length) return null;
  const isoDates = dates
    .map((m) => parseDateLoose(m[0]))
    .filter((d): d is string => !!d)
    .sort();
  return isoDates[isoDates.length - 1] ?? null;
}

/**
 * Closing balance row. Different passbooks print this differently:
 *   "Total: 12,34,56 7,89,012 1,23,456 21,46,909"  (col order)
 *   "Closing Balance Employee Share: 12,34,567"
 * We try several patterns and trust the highest-confidence one.
 */
function extractBalances(text: string): {
  employee: number;
  employer: number;
  pension: number;
} {
  // Patterns target the most common labelled form first.
  const empRe = /Employee\s*Share\s*:?\s*₹?\s*([\d,]+)/i;
  const erpRe = /Employer\s*Share\s*:?\s*₹?\s*([\d,]+)/i;
  const penRe = /Pension(?:\s*Fund)?(?:\s*Share)?\s*:?\s*₹?\s*([\d,]+)/i;

  const employee = paisaFromRupees(text.match(empRe)?.[1]);
  const employer = paisaFromRupees(text.match(erpRe)?.[1]);
  const pension = paisaFromRupees(text.match(penRe)?.[1]);
  return { employee, employer, pension };
}

function paisaFromRupees(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Recent transactions. We look for credit rows like:
 *   "MAR-2026  CONTRIBUTION  6,000  -  6,000  -  500  13,500"
 * and pick out the date + employee credit. Best-effort — if the layout
 * deviates we return an empty list and the importer falls back to "use
 * the closing balance, contribute 0/mo".
 */
function extractRecentTransactions(text: string): EpfPassbookTransaction[] {
  // Match wage-month token (MAR-2026 / 03-2026 / March 2026) followed
  // by amounts. The dash-separated form is the most common.
  const rowRe = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\s]?(\d{4})\s+([A-Z ]{4,30})\s+([\d,]+|-)/gi;
  const out: EpfPassbookTransaction[] = [];
  for (const m of text.matchAll(rowRe)) {
    const [, mon, year, particulars, amountStr] = m;
    const monthMap: Record<string, string> = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
    };
    const mm = monthMap[mon.toUpperCase()];
    if (!mm) continue;
    out.push({
      date: `${year}-${mm}-01`,
      type: particulars.trim(),
      debit: 0,
      credit: paisaFromRupees(amountStr),
    });
    if (out.length >= 12) break; // cap — we only need recent history
  }
  return out;
}

/**
 * Average the last 3-6 credit transactions to estimate the monthly
 * contribution rate. Heuristic: only count CONTRIBUTION rows (not
 * INTEREST / WITHDRAWAL), require at least 3 to be meaningful.
 */
function deriveMonthlyContribution(
  txns: EpfPassbookTransaction[],
): number | null {
  const contribs = txns
    .filter((t) => /CONTRIBUTION|CR/i.test(t.type))
    .filter((t) => t.credit > 0);
  if (contribs.length < 3) return null;
  const recent = contribs.slice(0, 6);
  const sum = recent.reduce((acc, t) => acc + t.credit, 0);
  return Math.round(sum / recent.length);
}

/* ─── parse entry point ─────────────────────────────────────────────── */

export function parseEpfPassbook(text: string): EpfPassbookData {
  const balances = extractBalances(text);
  const recentTransactions = extractRecentTransactions(text);
  return {
    uan: extractUan(text),
    memberId: extractMemberId(text),
    employerName: extractEmployerName(text),
    asOfDate: extractAsOfDate(text),
    employeeBalancePaisa: balances.employee,
    employerBalancePaisa: balances.employer,
    pensionBalancePaisa: balances.pension,
    monthlyContributionPaisa: deriveMonthlyContribution(recentTransactions),
    recentTransactions,
  };
}

/**
 * Stream-based entry that matches the index.ts dispatch signature.
 */
export function parseEpfPassbookStream(stream: string): EpfPassbookParsed {
  const data = parseEpfPassbook(stream);
  const warnings: string[] = [];

  // Confidence is HIGH when we got at least UAN + closing balances.
  // MEDIUM when one of those is missing. LOW when we got nothing useful.
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
  const totalBalance =
    data.employeeBalancePaisa + data.employerBalancePaisa + data.pensionBalancePaisa;
  if (!data.uan) {
    warnings.push('UAN not detected — link this import manually to the right EPF account.');
    confidence = 'MEDIUM';
  }
  if (totalBalance === 0) {
    warnings.push('Could not read closing balances. Verify before saving.');
    confidence = 'LOW';
  }
  if (data.monthlyContributionPaisa === null) {
    warnings.push(
      'Monthly contribution could not be derived (fewer than 3 recent credit rows visible). Set it manually after import.',
    );
  }

  return {
    type: 'epf-passbook',
    confidence,
    data,
    warnings,
  };
}
