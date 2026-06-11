/**
 * Capital-gains contract-note / realised-P&L statement parser.
 *
 * Detection identifies the broker from header tokens. The per-broker row
 * extractor is wired in when a real sample statement is available (the
 * exact column layout differs per broker and can't be guessed safely for
 * financial data — same convention as the mf-sip CAS parser). Until then
 * the parser returns the recognised broker + an actionable warning rather
 * than fabricating rows.
 *
 * Output `rows` map 1:1 onto the aggregate-LTCG engine inputs
 * (lib/finance/capital-gains-tax → computeAggregateCapitalGainsTax).
 */

import type { CgBroker, CgStatementParsed } from './types';

/** Header tokens that identify a broker capital-gains / P&L statement. */
const BROKER_SIGNATURES: Array<{ broker: CgBroker; tokens: RegExp[] }> = [
  { broker: 'ZERODHA', tokens: [/zerodha/i, /tradewise (exits|realised)/i, /console\.zerodha/i] },
  { broker: 'GROWW', tokens: [/groww/i, /capital gains? statement/i] },
  { broker: 'CAMS', tokens: [/\bcams\b/i, /capital gain(s)? statement/i] },
  { broker: 'KFINTECH', tokens: [/kfintech|karvy/i, /capital gain/i] },
];

/** True if the text looks like a broker capital-gains / realised-P&L statement. */
export function detectCgStatement(stream: string): boolean {
  return identifyBroker(stream) !== 'UNKNOWN';
}

function identifyBroker(stream: string): CgBroker {
  for (const { broker, tokens } of BROKER_SIGNATURES) {
    // Require the broker name AND a capital-gains/P&L context token so a
    // stray "zerodha" mention elsewhere doesn't misfire.
    if (tokens[0].test(stream) && tokens.slice(1).some((t) => t.test(stream))) {
      return broker;
    }
  }
  return 'UNKNOWN';
}

export function parseCgStatementStream(stream: string): CgStatementParsed {
  const broker = identifyBroker(stream);
  // Framework slot: the per-broker row extractor lands here once a sample
  // statement is on hand. Returning recognised-but-unparsed keeps the
  // import flow honest (no invented gains) and tells the user what to do.
  return {
    type: 'cg-statement',
    broker,
    fy: null,
    rows: [],
    totalLtcgPaisa: 0,
    totalStcgPaisa: 0,
    warnings: [
      `Recognised a ${broker === 'UNKNOWN' ? 'capital-gains' : broker} statement, but the row extractor for this format isn't wired yet. ` +
        'Share a sample of this exact statement to enable automatic capital-gains import; until then add gains via /tax/ltcg-stcg.',
    ],
  };
}
