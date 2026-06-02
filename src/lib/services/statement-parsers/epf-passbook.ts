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

/**
 * Detection signals — relaxed in Sprint 5.6.1 after the first real
 * passbook upload (TBTAM…2025.pdf) showed that EPFO's actual member
 * passbook does NOT print "Employees' Provident Fund Organisation"
 * in extractable text. The header reads bilingually as
 *   `lnL; iklcqd / Member Passbook` + `bZih,Q iklcqd / EPF Passbook`
 * and "EPFO" only appears in the disclaimer footer.
 *
 * We now require ANY 2 of 4 broader signals. False-positive risk is
 * low — a random PDF would need to coincidentally carry an "EPF
 * Passbook" header AND a 12-digit UAN, etc.
 */
const SIGNAL_REGEXES: RegExp[] = [
  // Bilingual passbook header (most reliable on real samples).
  /\bEPF\s*Passbook\b|\bMember\s*Passbook\b/i,
  // Disclaimer footer — EPFO-specific phrase. Survives layout changes.
  /\bEPFO\b|Provident\s*Fund\s*Organisation/i,
  // UAN section with the 12-digit number on the same/next line.
  /\bUAN\b[^\d]{0,40}\d{12}/i,
  // Member ID alphanumeric pattern — 2-7 letter prefix, 15-25 digits.
  // Examples seen: TBTAM00601460000000117, MHBAN001234500…
  /\b[A-Z]{2,7}\d{15,25}\b/,
];

export function detectEpfPassbook(stream: string): boolean {
  const hits = SIGNAL_REGEXES.filter((re) => re.test(stream)).length;
  return hits >= 2;
}

/* ─── field-level extractors ────────────────────────────────────────── */

/**
 * Pull a 12-digit UAN. EPFO UANs are always 12 digits.
 * The real bilingual passbook prints the Hindi transliteration first
 * (`;w , u`) then the English "UAN" label, then the number — so the
 * "UAN" anchor still works, just with a longer gap to the 12 digits.
 */
function extractUan(text: string): string | null {
  const m = text.match(/\bUAN\b[^\d]{0,60}(\d{12})/i);
  if (m) return m[1];
  // Some passbooks print "Universal Account No. : 1234..." instead.
  const m2 = text.match(/Universal\s*Account\s*N(?:o|umber)\.?\s*:?\s*(\d{12})/i);
  return m2 ? m2[1] : null;
}

/**
 * Member ID — alphanumeric, prefix(2-7 letters) + digits(15-25).
 * Real samples seen: TBTAM00601460000000117 (5-letter prefix).
 * EPFO's official spec is office-code(2-7) + establishment(7) +
 * extension(3) + account(7-10). Widened in Sprint 5.6.1.
 *
 * Falls back to searching the entire stream when the "Member ID"
 * label isn't directly adjacent — the real passbook puts the label
 * and value in different table cells separated by other tokens.
 */
function extractMemberId(text: string): string | null {
  // Preferred: label-anchored match.
  const m = text.match(/\bMember\s*ID(?:\/Name)?\b[^A-Z0-9]{0,30}([A-Z]{2,7}\d{15,25})/i);
  if (m) return m[1];
  // Fallback: any standalone Member-ID-shaped token in the document.
  // Constrained shape (uppercase prefix + long digit tail) makes false
  // positives unlikely. Pick the FIRST one in document order — that's
  // the header occurrence; later occurrences are page footers.
  const m2 = text.match(/\b([A-Z]{2,7}\d{15,25})\b/);
  return m2 ? m2[1] : null;
}

function extractEmployerName(text: string): string | null {
  // Two common labels: "Establishment Name" or "Employer Name".
  // Real passbook prints "Establishment ID/Name <id> / <NAME>" — the
  // name follows the Member-ID-shaped token and a " / " separator.
  const m = text.match(/(?:Establishment\s*(?:ID\/Name|Name)|Employer\s*Name)[^A-Z0-9]{0,30}(?:[A-Z]{2,7}\d{10,25}\s*\/\s*)?([A-Z][A-Z0-9 .,&()-]{3,80})/i);
  if (!m) return null;
  // Trim trailing labels that bleed into the capture when fields hug.
  // The bilingual passbook in particular bleeds Hindi-script tokens
  // like "lnL;" (Member), "tUe" (DoB), ";w" (UAN) into the capture.
  // Match without requiring the trailing punctuation.
  return m[1].replace(/\s*(?:Member|UAN|Address|lnL|tUe|;w|frfFk|vkbZMh).*$/i, '').trim();
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
 * Closing balance row. The real EPFO passbook prints a single row
 * with three numbers in column order — employee / employer / pension:
 *
 *   "Closing Balance as on 31/03/2026   39,06,462   42,53,644   2,46,402"
 *
 * Sprint 5.6.1: switched from OB/Share-labelled patterns to this
 * column-order pattern because that's what the real passbook layout
 * actually emits. The OB row earlier in the document still gets
 * extracted as a fallback when no closing row is present (e.g.
 * mid-year statement variants).
 */
function extractBalances(text: string): {
  employee: number;
  employer: number;
  pension: number;
} {
  // Primary: "Closing Balance as on DD/MM/YYYY <emp> <empr> <pension>"
  // The three balance numbers appear in column order. Rupees use Indian
  // comma grouping (lakh/crore) so commas are part of the number.
  const closingRe = /Closing\s*Balance(?:\s*as\s*on)?\s*\d{1,2}[-/]\d{1,2}[-/]\d{4}\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i;
  const m = text.match(closingRe);
  if (m) {
    return {
      employee: paisaFromRupees(m[1]),
      employer: paisaFromRupees(m[2]),
      pension: paisaFromRupees(m[3]),
    };
  }

  // Fallback 1: opening-balance row in the same column-order shape.
  // "OB Int. Updated upto DD/MM/YYYY  <emp>  <empr>  <pension>"
  const obRe = /OB\s*(?:Int\.\s*)?Updated\s*upto\s*\d{1,2}[-/]\d{1,2}[-/]\d{4}\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i;
  const ob = text.match(obRe);
  if (ob) {
    return {
      employee: paisaFromRupees(ob[1]),
      employer: paisaFromRupees(ob[2]),
      pension: paisaFromRupees(ob[3]),
    };
  }

  // Fallback 2: labelled Share patterns (older passbook variants).
  const empRe = /Employee\s*Share\s*:?\s*₹?\s*([\d,]+)/i;
  const erpRe = /Employer\s*Share\s*:?\s*₹?\s*([\d,]+)/i;
  const penRe = /Pension(?:\s*Fund)?(?:\s*Share)?\s*:?\s*₹?\s*([\d,]+)/i;

  return {
    employee: paisaFromRupees(text.match(empRe)?.[1]),
    employer: paisaFromRupees(text.match(erpRe)?.[1]),
    pension: paisaFromRupees(text.match(penRe)?.[1]),
  };
}

function paisaFromRupees(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Recent transactions. Real EPFO passbook row format (Sprint 5.6.1
 * after verifying against actual sample):
 *
 *   Mar-2025  11-04-2025  CR  Cont. For Due-Month 042025
 *     1,60,000  15,000  19,200  17,950  1,250
 *
 * Columns are: wage_month, transaction_date, type (CR), particulars,
 * wages_epf, wages_eps, employee_contribution, employer_contribution,
 * pension_contribution. We capture the employee_contribution column —
 * that's the value the user "spends" each month into EPF.
 */
function extractRecentTransactions(text: string): EpfPassbookTransaction[] {
  // Anchor on "Cont. For Due-Month <MMYYYY>" which is the most
  // distinctive shape in each row — survives layout drift.
  // After that anchor: wages_epf, wages_eps, then employee contribution.
  const rowRe = /Cont\.\s*For\s*Due-Month\s+(\d{2})(\d{4})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/gi;
  const out: EpfPassbookTransaction[] = [];
  for (const m of text.matchAll(rowRe)) {
    const [, monthStr, year, , , employeeContribStr] = m;
    out.push({
      date: `${year}-${monthStr}-01`,
      type: 'Cont.',
      debit: 0,
      credit: paisaFromRupees(employeeContribStr),
    });
    if (out.length >= 12) break; // cap — we only need recent history
  }
  // Fallback: older labelled-month format ("MAR-2026  CONTRIBUTION  ...")
  if (out.length === 0) {
    const oldRe = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\s]?(\d{4})\s+([A-Z ]{4,30})\s+([\d,]+|-)/gi;
    const monthMap: Record<string, string> = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
    };
    for (const m of text.matchAll(oldRe)) {
      const [, mon, year, particulars, amountStr] = m;
      const mm = monthMap[mon.toUpperCase()];
      if (!mm) continue;
      out.push({
        date: `${year}-${mm}-01`,
        type: particulars.trim(),
        debit: 0,
        credit: paisaFromRupees(amountStr),
      });
      if (out.length >= 12) break;
    }
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
  // Real passbook rows are tagged 'Cont.' (Sprint 5.6.1); older
  // formats used 'CONTRIBUTION' or 'CR'. Accept any of those.
  const contribs = txns
    .filter((t) => /Cont\.|CONTRIBUTION|CR/i.test(t.type))
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
