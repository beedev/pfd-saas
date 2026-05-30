/**
 * Chit fund "Account Copy" parser.
 *
 * Targets the standard ledger format mandated by Chit Funds Act 1982 / Form
 * XIV (Tamil Nadu Chit Funds Rules 1984), used by Dhanalakshmi Srinivasan
 * Chit Funds and most other registered foremen. Header anchors are
 * deterministic — `Chit Reference :`, `Group Value :`, etc. — so we extract
 * via simple labelled-value regexes off the concatenated PDF text.
 *
 * Scope (v1): metadata + summary state only.
 *   - Foreman, scheme, ticket, registration, dates, group size
 *   - installmentsPaid, totalPaid, totalDividends, balance, nextDueDate
 * Skipped (v1): individual installment rows. The chit_funds table tracks
 * paid/dividends as running totals, so users get full state from one upload.
 * Per-installment history can be added later via /investments/chit-funds/[id].
 */

import { extractPdfText } from './pdf-text';
import type { ChitParsed } from './types';

/* ─── helpers ─────────────────────────────────────────────────────────── */

function isoFromDdMmYyyy(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function rupeesToPaisa(amountStr: string): number {
  const cleaned = amountStr.replace(/,/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Block extractor for Form XIV chit statements.
 *
 * The PDF emits text in two-column blocks: a list of labels followed by a
 * list of values in the same order. We anchor on the full label sequence,
 * then capture the values that follow.
 */

/* ─── header extraction ───────────────────────────────────────────────── */

function extractForemanName(stream: string): string {
  // First all-caps run ending in "CHIT FUNDS [PVT] [LTD]"
  const m = /\b([A-Z][A-Z &.'-]+?CHIT FUNDS(?:\s+PVT)?(?:\s+LTD)?)\b/i.exec(stream);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  return 'Unknown Foreman';
}

function extractBranch(stream: string): string | null {
  // "DHANALAKSHMI ... CHIT FUNDS PVT LTD MOGAPPAIR Branch :" — branch token
  // appears immediately *before* the literal "Branch :" in the token stream.
  const m = /CHIT FUNDS(?:\s+PVT)?(?:\s+LTD)?\s+([A-Z0-9 .,'-]+?)\s+Branch\s*:/i.exec(stream);
  return m ? m[1].trim() : null;
}

function extractSubscriberName(stream: string): string | null {
  // "Name : Agent Name : : : : : : : : : : : : BHARATHWAJAN D S/O DEVANATHAN G ..."
  // Subscriber name is the first ALL-CAPS token sequence after the colon block.
  const m = /Agent Name\s*:(?:\s*:)+\s+([A-Z][A-Z .]+?)\s+(?:S\/O|D\/O|W\/O|PLOT)/i.exec(stream);
  return m ? m[1].trim() : null;
}

function extractMetaBlock1(stream: string) {
  // "Chit Reference Group Value No Of Installments Bye Law No Bye Law Date Commencement Closing Date <values>"
  // Values: <chit-ref> <group-value> <inst-count> <bye-law-no> <bye-law-date> <commencement> <closing-date>
  // chit-ref can be "MG80404 / 34" — capture greedily up to the first amount.
  const re = new RegExp(
    'Chit Reference\\s+Group Value\\s+No Of Installments\\s+Bye Law No\\s+Bye Law Date\\s+Commencement\\s+Closing Date\\s+' +
      '(.+?)\\s+([\\d,]+\\.\\d{2})\\s+(\\d+)\\s+(\\S+)\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(\\d{2}\\/\\d{2}\\/\\d{4})',
    'i'
  );
  const m = re.exec(stream);
  if (!m) return null;
  return {
    chitReferenceRaw: m[1].trim(),
    groupValuePaisa: rupeesToPaisa(m[2]),
    noOfInstallments: Number(m[3]),
    byeLawNo: m[4],
    commencementDate: isoFromDdMmYyyy(m[6])!,
    closingDate: isoFromDdMmYyyy(m[7])!,
  };
}

function extractMetaBlock2(stream: string) {
  // "L.P.Date Enrol Date Paid Up To Position 31/03/2024 11/03/2026 25 NPS"
  const re = /L\.P\.Date\s+Enrol Date\s+Paid Up To\s+Position\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\S+)/i;
  const m = re.exec(stream);
  if (!m) return null;
  return {
    lpDate: isoFromDdMmYyyy(m[1]),
    enrolDate: isoFromDdMmYyyy(m[2]),
    paidUpTo: Number(m[3]),
    position: m[4],
  };
}

function extractMoneyBlock(stream: string) {
  // "Amt To be Paid Paid Amount Balance Amt : : : 539,737.00 517,189.00 22,548.00"
  // (sometimes interleaved with cell number tokens — be flexible about whitespace.)
  const re = /Amt To be Paid\s+Paid Amount\s+Balance Amt\s*(?::\s*)+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i;
  const m = re.exec(stream);
  if (!m) return null;
  return {
    amtToBePaidPaisa: rupeesToPaisa(m[1]),
    paidAmountPaisa: rupeesToPaisa(m[2]),
    balanceAmtPaisa: rupeesToPaisa(m[3]),
  };
}

function parseChitReference(raw: string): { scheme: string; ticket: string | null } {
  // "MG80404 / 34" → { scheme: "MG80404", ticket: "34" }
  const m = /^([A-Z0-9]+)\s*\/\s*(\d+)$/i.exec(raw.replace(/\s+/g, ' '));
  if (m) return { scheme: m[1], ticket: m[2] };
  return { scheme: raw.replace(/\s+/g, ''), ticket: null };
}

function extractReportDate(stream: string): string | null {
  const m = /Report Date\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(stream);
  return m ? isoFromDdMmYyyy(m[1]) : null;
}

function extractNextDueFromFooter(stream: string): string | null {
  // Footer block (column-major): "Month Dividend Net Due Installment No 26 APR 2026 2,225.00 22,775.00"
  // The installment number, month, year appear together.
  const re = /Installment No\s+(\d+)\s+([A-Z]{3})\s+(\d{4})/i;
  const m = re.exec(stream);
  if (!m) return null;
  const monthMap: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const mm = monthMap[m[2].toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-01`;
}

/* ─── detection ───────────────────────────────────────────────────────── */

export function detectChit(stream: string): boolean {
  return /CHIT FUNDS/i.test(stream)
    && /Chit Funds Act 1982/i.test(stream);
}

/* ─── public ──────────────────────────────────────────────────────────── */

export async function parseChitPdf(buffer: Buffer): Promise<ChitParsed> {
  const stream = await extractPdfText(buffer);
  return parseChitStream(stream);
}

export function parseChitStream(stream: string): ChitParsed {
  const warnings: string[] = [];

  const foremanName = extractForemanName(stream);
  const branch = extractBranch(stream);
  const subscriberName = extractSubscriberName(stream);

  const block1 = extractMetaBlock1(stream);
  const block2 = extractMetaBlock2(stream);
  const money = extractMoneyBlock(stream);

  const { scheme, ticket } = block1
    ? parseChitReference(block1.chitReferenceRaw)
    : { scheme: 'UNKNOWN', ticket: null };

  const groupValuePaisa = block1?.groupValuePaisa ?? 0;
  const durationMonths = block1?.noOfInstallments ?? 0;
  const groupSize = durationMonths;
  const monthlyInstallmentPaisa =
    durationMonths > 0 ? Math.round(groupValuePaisa / durationMonths) : 0;

  const registrationNumber = block1?.byeLawNo ?? null;
  const startDate = block1?.commencementDate ?? '';
  const expectedEndDate = block1?.closingDate ?? '';

  const installmentsPaid = block2?.paidUpTo ?? 0;
  const totalPaidPaisa = money?.paidAmountPaisa ?? 0;
  const amtToBePaidPaisa = money?.amtToBePaidPaisa ?? 0;
  const balanceAmtPaisa = money?.balanceAmtPaisa ?? 0;

  // Dividend = nominal_due − actually_paid (in nominal pre-future-installments terms)
  // For paid installments: nominal = paid_count × monthly, paid = totalPaid.
  // The difference is the dividend that already reduced the net outgo.
  const nominalPaid = monthlyInstallmentPaisa * installmentsPaid;
  const totalDividendsPaisa = Math.max(0, nominalPaid - totalPaidPaisa);
  // Net contribution = gross notional (cash + dividend benefit) = nominalPaid.
  const netContributionPaisa = totalPaidPaisa + totalDividendsPaisa;

  const position = (block2?.position ?? 'NPS').toUpperCase();
  const status: 'ACTIVE' | 'WON' = position === 'NPS' ? 'ACTIVE' : 'WON';

  const nextDueDate = extractNextDueFromFooter(stream);
  const reportDate = extractReportDate(stream);

  // Sanity warnings
  if (!startDate) warnings.push('Could not extract Commencement date');
  if (!expectedEndDate) warnings.push('Could not extract Closing date');
  if (groupValuePaisa === 0) warnings.push('Could not extract Group Value');
  if (durationMonths === 0) warnings.push('Could not extract No Of Installments');
  if (amtToBePaidPaisa > 0) {
    const reconcile = amtToBePaidPaisa - totalPaidPaisa - balanceAmtPaisa;
    if (Math.abs(reconcile) > 100) {
      warnings.push(
        `Footer totals do not reconcile (Amt to be paid − paid − balance = ₹${(reconcile / 100).toFixed(2)})`
      );
    }
  }

  return {
    type: 'chit',
    foremanName,
    branch,
    subscriberName,
    schemeName: scheme,
    ticketNumber: ticket,
    registrationNumber,
    isRegistered: !!registrationNumber,
    chitValuePaisa: groupValuePaisa,
    monthlyInstallmentPaisa,
    durationMonths,
    groupSize,
    startDate,
    expectedEndDate,
    installmentsPaid,
    totalPaidPaisa,
    totalDividendsPaisa,
    netContributionPaisa,
    status,
    nextDueDate,
    reportDate,
    warnings,
  };
}
