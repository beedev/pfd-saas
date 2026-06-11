/**
 * Capital-gains statement parser (broker / RTA realised-gains statements).
 *
 * The user wants the SUMMARY (per-statement STCG / LTCG totals), not the
 * individual lots that total up to it. Two PDF families are handled:
 *
 *   • KFINTECH "Capital Gain / Loss – Scheme level" (Nippon, Sundaram, …):
 *     a clean `Total <outflow> <net> <grandfathered> <STCG> <LTG-with-index>
 *     <LTG-without-index>` row — parsed directly. LTG-without-index is the
 *     sec-112A equity figure; LTG-with-index is the indexed (debt) figure.
 *
 *   • CAMS "Investment Gain / (Loss) Statement" (HSBC, …): the PDF's column
 *     layout doesn't survive text extraction (the total lands beside
 *     unrelated values), so we DETECT it, surface the best-effort figure as
 *     LOW confidence, and tell the user to verify — never invent a number.
 *
 * Zerodha tax-P&L is an .xlsx and goes through a separate exceljs path
 * (see zerodha-taxpnl.ts), not this PDF-text parser.
 *
 * Output rows feed computeAggregateCapitalGainsTax (capital-gains-tax.ts).
 */

import type { CgBroker, CgStatementParsed, CgStatementRow } from './types';

/** Header tokens that identify a broker capital-gains / P&L statement. */
const BROKER_SIGNATURES: Array<{ broker: CgBroker; tokens: RegExp[] }> = [
  { broker: 'ZERODHA', tokens: [/zerodha/i, /tradewise (exits|realised)/i, /console\.zerodha/i] },
  { broker: 'GROWW', tokens: [/groww/i, /capital gains? statement/i] },
];

const NUM = String.raw`-?[\d,]+\.\d{2}`;

function toPaisa(s: string): number {
  return Math.round(parseFloat(s.replace(/,/g, '')) * 100);
}

/** FY string from "... 2025 to 31 Mar 2026" / "01-APR-2025 To 31-MAR-2026". */
function detectFy(stream: string): string | null {
  const m = stream.match(/(\d{4})\s*(?:to|To)\s*31[-\s][A-Za-z]{3}[-\s](\d{4})/);
  if (m) return `${m[1]}-${m[2].slice(2)}`;
  const m2 = stream.match(/31[-\s][A-Za-z]{3}[-\s](\d{4})/);
  if (m2) return `${Number(m2[1]) - 1}-${m2[1].slice(2)}`;
  return null;
}

function isKfintech(stream: string): boolean {
  return (
    /Capital Gain.{0,4}Loss.{0,30}Scheme level/i.test(stream) &&
    /Long Term Gain Without Index/i.test(stream)
  );
}

function isCams(stream: string): boolean {
  return /Investment Gain.{0,4}\(Loss\) Statement/i.test(stream) &&
    /Long Term without Indexation/i.test(stream);
}

export function identifyBroker(stream: string): CgBroker {
  if (isKfintech(stream)) return 'KFINTECH';
  if (isCams(stream)) return 'CAMS';
  for (const { broker, tokens } of BROKER_SIGNATURES) {
    if (tokens[0].test(stream) && tokens.slice(1).some((t) => t.test(stream))) return broker;
  }
  return 'UNKNOWN';
}

export function detectCgStatement(stream: string): boolean {
  return identifyBroker(stream) !== 'UNKNOWN';
}

/** Scheme name (+ ISIN if present) from the line after the scheme-level header. */
function schemeName(stream: string): string | null {
  const m = stream.match(/Long Term Gain Without Index\s+(.+?)\s+\d+\s+[\d,]+\.\d{2}/);
  return m ? m[1].trim() : null;
}

/** CAMS scheme name — the fund line carrying an ISIN. */
function schemeNameCams(stream: string): string | null {
  const m = stream.match(/\b([A-Z][\w '&().\-/]{8,89})\s*,?\s*ISIN[:\s]+([A-Z0-9]{12})/);
  return m ? `${m[1].trim()} (${m[2]})` : null;
}

function rowsFromTotals(
  stcgPaisa: number,
  ltgWithIndexPaisa: number,
  ltgWithoutIndexPaisa: number,
  saleDate: string | null,
  scrip: string | null,
): CgStatementRow[] {
  const rows: CgStatementRow[] = [];
  // STCG (equity 111A here; non-zero only).
  if (stcgPaisa !== 0) {
    rows.push({ assetType: 'EQUITY_MF', holdingPeriod: 'STCG', saleDate, capitalGainPaisa: stcgPaisa, scrip });
  }
  // Equity LTCG (sec 112A) — the "without indexation" column.
  if (ltgWithoutIndexPaisa !== 0) {
    rows.push({ assetType: 'EQUITY_MF', holdingPeriod: 'LTCG', saleDate, capitalGainPaisa: ltgWithoutIndexPaisa, scrip });
  }
  // Indexed (debt) LTCG — the "with indexation" column.
  if (ltgWithIndexPaisa !== 0) {
    rows.push({ assetType: 'DEBT_MF', holdingPeriod: 'LTCG', saleDate, capitalGainPaisa: ltgWithIndexPaisa, scrip });
  }
  return rows;
}

export function parseCgStatementStream(stream: string): CgStatementParsed {
  const broker = identifyBroker(stream);
  const fy = detectFy(stream);
  const saleDate = fy ? `${Number(fy.slice(0, 4)) + 1}-03-31` : null;
  const warnings: string[] = [];

  if (broker === 'KFINTECH') {
    // The grand "Total" row: outflow, net, grandfathered, STCG, LTG-with-index,
    // LTG-without-index. The last three are the gain figures (correct order;
    // the per-scheme row's column order is mangled by extraction, the Total
    // isn't).
    const re = new RegExp(`Total\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})`);
    const m = stream.match(re);
    if (!m) {
      return {
        type: 'cg-statement', broker, fy, rows: [],
        totalLtcgPaisa: 0, totalStcgPaisa: 0,
        warnings: ['Recognised a KFINTECH capital-gains statement but could not read its Total row — verify and add via /tax/ltcg-stcg.'],
      };
    }
    const stcg = toPaisa(m[4]);
    const ltgWith = toPaisa(m[5]);
    const ltgWithout = toPaisa(m[6]);
    const rows = rowsFromTotals(stcg, ltgWith, ltgWithout, saleDate, schemeName(stream));
    return {
      type: 'cg-statement', broker, fy, rows,
      totalStcgPaisa: stcg,
      totalLtcgPaisa: ltgWith + ltgWithout,
      warnings,
    };
  }

  if (broker === 'CAMS') {
    // CAMS (Investrak) per-scheme totals: text extraction reorders the
    // columns, but the per-scheme summary block is a stable template —
    //   "Paid Out : <idcw> <LT-without-index> Reinvested <amount> <units>
    //    Total <Short-Term> <LT-with-index>"
    // The gain (LT-without-index = equity 112A) sits right after the IDCW
    // "Paid Out" figure; Short-Term + LT-with-index follow "Total". One
    // match per scheme — summed for multi-scheme statements.
    const re = new RegExp(
      `Paid Out\\s*:\\s*${NUM}\\s+(${NUM})\\s+Reinvested[^A-Za-z]*?Total\\s+(${NUM})\\s+(${NUM})`,
      'g',
    );
    let stcg = 0;
    let ltgWithout = 0;
    let ltgWith = 0;
    let matched = 0;
    for (const m of stream.matchAll(re)) {
      matched++;
      ltgWithout += toPaisa(m[1]);
      stcg += toPaisa(m[2]);
      ltgWith += toPaisa(m[3]);
    }
    if (matched === 0) {
      return {
        type: 'cg-statement', broker, fy, rows: [],
        totalLtcgPaisa: 0, totalStcgPaisa: 0,
        warnings: [
          'Recognised a CAMS Investment Gain/(Loss) statement but could not read its scheme totals — please verify and add via /tax/ltcg-stcg.',
        ],
      };
    }
    const rows = rowsFromTotals(stcg, ltgWith, ltgWithout, saleDate, schemeNameCams(stream));
    return {
      type: 'cg-statement', broker, fy, rows,
      totalStcgPaisa: stcg,
      totalLtcgPaisa: ltgWith + ltgWithout,
      warnings: [
        `Parsed ${matched} scheme total(s) from a CAMS statement using the standard Investrak template — please confirm the figures against the PDF before filing.`,
      ],
    };
  }

  return {
    type: 'cg-statement', broker, fy, rows: [],
    totalLtcgPaisa: 0, totalStcgPaisa: 0,
    warnings: [
      `Recognised a ${broker === 'UNKNOWN' ? 'capital-gains' : broker} statement, but no row extractor matched. Add gains via /tax/ltcg-stcg.`,
    ],
  };
}
