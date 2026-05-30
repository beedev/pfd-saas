/**
 * LIC Premium Paid Statement parser.
 *
 * Parses the annual "Premium Paid Statement" PDF that LIC issues for tax/record
 * purposes. Each PDF has one row per installment; we dedupe by policy number
 * and derive the annual premium from the per-installment amount × frequency.
 *
 * Strategy
 * --------
 * 1. Extract page text via shared pdf-text helper.
 * 2. Walk the token stream looking for the canonical row anchor:
 *    `<policy(8-10 digits)> <name…> <DD/MM/YYYY> <DD/MM/YYYY> <DD/MM/YYYY> 1 <Yly|Hly|Qly> <amount> <gst> <DD/MM/YYYY> ...`
 * 3. Group by policy number, sum installments, take min(start) and max(dueTo).
 *
 * The parser is forgiving: rows that don't match are skipped, not fatal.
 */

import { extractPdfText } from './pdf-text';
import type { LicParsed, LicPaymentMode, LicPolicySummary } from './types';

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const POLICY_RE = /^\d{8,10}$/;
const AMOUNT_RE = /^[\d,]+\.\d{2}$/;

function isoFromDdMmYyyy(s: string): string | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function rupeesToPaisa(amountStr: string): number {
  const cleaned = amountStr.replace(/,/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function modeMultiplier(mode: LicPaymentMode): number {
  switch (mode) {
    case 'Mly': return 12;
    case 'Qly': return 4;
    case 'Hly': return 2;
    case 'Yly': return 1;
    case 'Sly': return 0;
  }
}

function modeStepMonths(mode: LicPaymentMode): number {
  switch (mode) {
    case 'Mly': return 1;
    case 'Qly': return 3;
    case 'Hly': return 6;
    case 'Yly': return 12;
    case 'Sly': return 0;
  }
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface Row {
  policyNumber: string;
  policyHolder: string;
  startDate: string;
  dueFrom: string;
  dueTo: string;
  paymentMode: LicPaymentMode;
  premiumPaisa: number;
  gstPaisa: number;
  receivedDate: string;
}

function parseRows(stream: string, warnings: string[]): Row[] {
  const tokens = stream.split(/\s+/).filter(Boolean);
  const out: Row[] = [];

  for (let i = 0; i < tokens.length; i++) {
    if (!POLICY_RE.test(tokens[i])) continue;
    const policyNumber = tokens[i];

    let firstDateIdx = -1;
    for (let j = i + 1; j < Math.min(i + 8, tokens.length); j++) {
      if (DATE_RE.test(tokens[j])) {
        firstDateIdx = j;
        break;
      }
    }
    if (firstDateIdx < 0) continue;

    const d1 = tokens[firstDateIdx];
    const d2 = tokens[firstDateIdx + 1];
    const d3 = tokens[firstDateIdx + 2];
    if (!d2 || !d3 || !DATE_RE.test(d2) || !DATE_RE.test(d3)) continue;

    const policyHolder = tokens.slice(i + 1, firstDateIdx).join(' ').trim();

    let cursor = firstDateIdx + 3;
    if (tokens[cursor] === '1') cursor++;

    const modeTok = tokens[cursor];
    const validModes: LicPaymentMode[] = ['Yly', 'Hly', 'Qly', 'Mly', 'Sly'];
    if (!validModes.includes(modeTok as LicPaymentMode)) continue;
    cursor++;

    if (!AMOUNT_RE.test(tokens[cursor] ?? '')) continue;
    const premiumPaisa = rupeesToPaisa(tokens[cursor]);
    cursor++;

    let gstPaisa = 0;
    const gstTok = tokens[cursor];
    if (gstTok && /^[\d,]*\.\d{1,2}$/.test(gstTok)) {
      gstPaisa = rupeesToPaisa(gstTok);
      cursor++;
    }

    const receivedTok = tokens[cursor];
    if (!receivedTok || !DATE_RE.test(receivedTok)) continue;

    out.push({
      policyNumber,
      policyHolder,
      startDate: isoFromDdMmYyyy(d1)!,
      dueFrom: isoFromDdMmYyyy(d2)!,
      dueTo: isoFromDdMmYyyy(d3)!,
      paymentMode: modeTok as LicPaymentMode,
      premiumPaisa,
      gstPaisa,
      receivedDate: isoFromDdMmYyyy(receivedTok)!,
    });

    i = cursor;
  }

  if (out.length === 0) {
    warnings.push('No installment rows matched the LIC layout. The PDF format may have changed.');
  }
  return out;
}

function summarise(rows: Row[]): LicPolicySummary[] {
  const byPolicy = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byPolicy.get(r.policyNumber) ?? [];
    list.push(r);
    byPolicy.set(r.policyNumber, list);
  }

  const out: LicPolicySummary[] = [];
  for (const [policyNumber, list] of Array.from(byPolicy.entries())) {
    const sorted = [...list].sort((a, b) => a.dueTo.localeCompare(b.dueTo));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalPaid = sorted.reduce((s, r) => s + r.premiumPaisa, 0);
    const totalGst = sorted.reduce((s, r) => s + r.gstPaisa, 0);
    const mode = first.paymentMode;
    const annual = first.premiumPaisa * modeMultiplier(mode);
    const nextDue = mode === 'Sly'
      ? last.dueTo
      : addMonthsIso(last.dueTo, modeStepMonths(mode));

    out.push({
      policyNumber,
      policyHolder: first.policyHolder,
      startDate: first.startDate,
      paymentMode: mode,
      premiumPerInstallmentPaisa: first.premiumPaisa,
      installmentsInStatement: sorted.length,
      totalPaidPaisa: totalPaid,
      totalGstPaisa: totalGst,
      lastDueTo: last.dueTo,
      nextDueDate: nextDue,
      annualPremiumPaisa: annual,
    });
  }

  out.sort((a, b) => b.annualPremiumPaisa - a.annualPremiumPaisa);
  return out;
}

function extractStatementYear(stream: string): string | null {
  const m = /PREMIUM PAID STATEMENT FOR THE YEAR\s+(\d{4}-\d{4})/i.exec(stream);
  return m ? m[1] : null;
}

function extractPolicyHolderHeader(stream: string): string | null {
  const m = /policies of\s+(.+?)\s+Policy Number/i.exec(stream);
  return m ? m[1].trim() : null;
}

function extractFooterTotals(stream: string): { premium: number; gst: number } {
  let premium = 0;
  let gst = 0;
  const pm = /Total amount received towards\s+premium[^₹]*₹\s*([\d,]+\.\d{2})/i.exec(stream);
  if (pm) premium = rupeesToPaisa(pm[1]);
  const gm = /Total amount received towards Service TAX \/ GST[^₹]*₹\s*([\d,]+\.\d{2})/i.exec(stream);
  if (gm) gst = rupeesToPaisa(gm[1]);
  return { premium, gst };
}

export function detectLic(stream: string): boolean {
  return /Life Insurance Corporation of India/i.test(stream)
    && /PREMIUM PAID STATEMENT/i.test(stream);
}

export async function parseLicPdf(buffer: Buffer): Promise<LicParsed> {
  const stream = await extractPdfText(buffer);
  return parseLicStream(stream);
}

export function parseLicStream(stream: string): LicParsed {
  const warnings: string[] = [];
  const rows = parseRows(stream, warnings);
  const policies = summarise(rows);
  const footer = extractFooterTotals(stream);
  const parsedTotal = rows.reduce((s, r) => s + r.premiumPaisa, 0);

  if (footer.premium > 0 && Math.abs(parsedTotal - footer.premium) > 100) {
    warnings.push(
      `Parsed total ₹${(parsedTotal / 100).toFixed(2)} does not match PDF footer total ₹${(footer.premium / 100).toFixed(2)}. Some rows may have been missed.`
    );
  }

  return {
    type: 'lic',
    statementYear: extractStatementYear(stream),
    policyHolderName: extractPolicyHolderHeader(stream),
    totalPremiumPaisa: footer.premium,
    totalGstPaisa: footer.gst,
    installmentCount: rows.length,
    warnings,
    policies,
  };
}
