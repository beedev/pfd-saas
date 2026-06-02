/**
 * NPS Statement of Transactions PDF parser.
 *
 * Source: Protean (NSDL e-Governance) CRA "Statement of Transactions"
 * for an NPS subscriber. Layout is standardised by PFRDA:
 *
 *   Header:    PRAN, Subscriber Name, Tier (I / II)
 *   Section:   Scheme-wise NAV statement (Equity / Corp Debt / Govt
 *              Sec / Alternative) with units + NAV + amount.
 *   Section:   Transaction details — date, particulars, contribution
 *              amount, NAV applied, units credited.
 *
 * KFin CRA's variant uses different column ordering but the same
 * section labels; this parser targets Protean first and falls back to
 * generic regex anchors so KFin docs parse at lower confidence.
 *
 * REAL-SAMPLE STATUS: written against the public Protean SoT layout
 * documented at:
 *   https://npscra.nsdl.co.in/download/Sample%20SOT.pdf
 * The first user upload will tell us which regexes need tightening.
 */

import type { NpsSotData, NpsSotParsed, NpsRecentContribution } from './types';

/* ─── detection ─────────────────────────────────────────────────────── */

const HEADER_TOKENS = [
  /Statement\s*of\s*Transactions?/i,
  /\bPRAN\b/i,
  /Tier\s*[I12]/i,
];

export function detectNpsSot(stream: string): boolean {
  return HEADER_TOKENS.every((re) => re.test(stream));
}

/* ─── field extractors ──────────────────────────────────────────────── */

/** PRAN is 12 digits. */
function extractPran(text: string): string | null {
  const m = text.match(/\bPRAN\b[^\d]{0,30}(\d{12})/i);
  return m ? m[1] : null;
}

function extractSubscriberName(text: string): string | null {
  // Common label: "Subscriber Name" or "Name of Subscriber".
  const m = text.match(
    /(?:Subscriber\s*Name|Name\s*of\s*[Ss]ubscriber)[^A-Za-z]{0,5}([A-Z][A-Za-z .,'-]{2,80})/,
  );
  if (!m) return null;
  return m[1].replace(/\s*(?:PRAN|Tier|Date).*$/i, '').trim();
}

function extractTier(text: string): 'TIER1' | 'TIER2' | null {
  // Look for explicit "Tier I" / "Tier-I" / "Tier 1" tokens.
  if (/Tier\s*[-\s]?\s*II\b|Tier\s*[-\s]?\s*2\b/.test(text)) return 'TIER2';
  if (/Tier\s*[-\s]?\s*I\b|Tier\s*[-\s]?\s*1\b/.test(text)) return 'TIER1';
  return null;
}

function extractAsOfDate(text: string): string | null {
  const m = text.match(/(?:As\s*on|Statement\s*Period\s*Ending|Report\s*Date)[^A-Za-z0-9]{0,3}([0-9]{1,2}[-/A-Za-z][^\s,]{3,15})/);
  if (m) {
    const d = parseDateLoose(m[1]);
    if (d) return d;
  }
  // Fallback to the latest date that appears.
  const dates = Array.from(text.matchAll(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/g));
  if (!dates.length) return null;
  const isoDates = dates
    .map((m) => parseDateLoose(m[0]))
    .filter((d): d is string => !!d)
    .sort();
  return isoDates[isoDates.length - 1] ?? null;
}

function parseDateLoose(s: string): string | null {
  const m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? m2[0] : null;
}

function paisaFromRupees(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Asset-class breakdown. Each scheme line typically reads:
 *   "Scheme E (Equity)         12.345  500.50  6,125.45"
 *   "Scheme C (Corp Debt)      ...."
 *   "Scheme G (Govt Sec)       ...."
 *   "Scheme A (Alternative)    ...."
 *
 * We map E to equity, C + G to debt (combined — most savers don't
 * split these in their own dashboards), A to alternative.
 */
function extractAssetClassBreakdown(text: string): {
  equity: number;
  debt: number;
  alternative: number;
  total: number;
} {
  let equity = 0;
  let debt = 0;
  let alternative = 0;

  // Scheme E (Equity)
  const eM = text.match(/Scheme\s*E\b[^\n]{0,80}?(?:Equity)?[^\n]{0,80}?([\d,]+\.\d{2})\s*$/m);
  if (eM) equity = paisaFromRupees(eM[1]);
  else {
    // Fallback — find amount on the same line as "Equity"
    const fallback = text.match(/Equity[^\n]{0,80}?([\d,]+\.\d{2})/i);
    if (fallback) equity = paisaFromRupees(fallback[1]);
  }

  // Scheme C (Corporate Debt) + Scheme G (Government Securities) → "debt"
  const cM = text.match(/Scheme\s*C\b[^\n]{0,80}?(?:Corp(?:orate)?\s*Debt|Bond)?[^\n]{0,80}?([\d,]+\.\d{2})\s*$/m);
  if (cM) debt += paisaFromRupees(cM[1]);
  const gM = text.match(/Scheme\s*G\b[^\n]{0,80}?(?:Govt|Government|Gilt)?[^\n]{0,80}?([\d,]+\.\d{2})\s*$/m);
  if (gM) debt += paisaFromRupees(gM[1]);

  // Scheme A (Alternative)
  const aM = text.match(/Scheme\s*A\b[^\n]{0,80}?(?:Alternative)?[^\n]{0,80}?([\d,]+\.\d{2})\s*$/m);
  if (aM) alternative = paisaFromRupees(aM[1]);

  const total = equity + debt + alternative;
  return { equity, debt, alternative, total };
}

/**
 * Total amount the subscriber has contributed (lifetime). Usually
 * appears on a "Total Contribution" line.
 */
function extractTotalContributed(text: string): number {
  const m = text.match(/Total\s*Contribution[^\d]{0,30}([\d,]+\.\d{2}|[\d,]+)/i);
  return m ? paisaFromRupees(m[1]) : 0;
}

function extractRecentContributions(text: string): NpsRecentContribution[] {
  // Match table rows that look like a date + description + amount.
  // Protean SoT has lines like:
  //   "01-04-2025  Self Contribution        5,000.00  21.4523  233.0210"
  const rowRe = /(\d{2}[-/]\d{2}[-/]\d{4})\s+([A-Z][A-Za-z ]{4,40})\s+([\d,]+\.\d{2})/g;
  const out: NpsRecentContribution[] = [];
  for (const m of text.matchAll(rowRe)) {
    const iso = parseDateLoose(m[1]);
    if (!iso) continue;
    const amount = paisaFromRupees(m[3]);
    if (amount <= 0) continue;
    out.push({ date: iso, amountPaisa: amount, description: m[2].trim() });
    if (out.length >= 12) break;
  }
  return out;
}

function deriveMonthlyContribution(
  contribs: NpsRecentContribution[],
): number | null {
  // Filter to "real" contribution rows (skip dividend reinvestment etc).
  const real = contribs.filter((c) => /CONTRIBUTION|SELF|EMPLOYER|VOLUNTARY/i.test(c.description));
  if (real.length < 3) return null;
  const recent = real.slice(0, 6);
  const sum = recent.reduce((acc, c) => acc + c.amountPaisa, 0);
  // Recent contributions may NOT all be monthly — some employers
  // deposit quarterly. We compute a coarse "average per month" by
  // checking date span. If the span is ≥ 90 days for 6 rows, this
  // looks quarterly and we normalise.
  if (recent.length >= 2) {
    const first = new Date(recent[recent.length - 1].date).getTime();
    const last = new Date(recent[0].date).getTime();
    const months = Math.max(1, (last - first) / (30.4375 * 24 * 60 * 60 * 1000));
    return Math.round(sum / months);
  }
  return Math.round(sum / recent.length);
}

/* ─── parse entry point ─────────────────────────────────────────────── */

export function parseNpsSot(text: string): NpsSotData {
  const breakdown = extractAssetClassBreakdown(text);
  const recentContributions = extractRecentContributions(text);
  return {
    pran: extractPran(text),
    subscriberName: extractSubscriberName(text),
    tier: extractTier(text),
    asOfDate: extractAsOfDate(text),
    equityFundValuePaisa: breakdown.equity,
    debtFundValuePaisa: breakdown.debt,
    alternativeFundValuePaisa: breakdown.alternative,
    totalValuePaisa: breakdown.total,
    totalContributedPaisa: extractTotalContributed(text),
    monthlyContributionPaisa: deriveMonthlyContribution(recentContributions),
    recentContributions,
  };
}

export function parseNpsSotStream(stream: string): NpsSotParsed {
  const data = parseNpsSot(stream);
  const warnings: string[] = [];

  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
  if (!data.pran) {
    warnings.push('PRAN not detected — link this import manually to the right NPS account.');
    confidence = 'MEDIUM';
  }
  if (data.totalValuePaisa === 0) {
    warnings.push('Asset-class breakdown could not be parsed. Verify before saving.');
    confidence = 'LOW';
  }
  if (data.tier === null) {
    warnings.push('Could not detect Tier I/II from the statement. Pick manually before saving.');
  }
  if (data.monthlyContributionPaisa === null) {
    warnings.push(
      'Monthly contribution could not be derived (fewer than 3 recent contribution rows). Set it manually after import.',
    );
  }

  return {
    type: 'nps-sot',
    confidence,
    data,
    warnings,
  };
}
