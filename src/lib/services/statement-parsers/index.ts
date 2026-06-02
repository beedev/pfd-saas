/**
 * Statement parser registry + dispatch.
 *
 * Public surface:
 *   - detectDocType(stream)        — sniff the doc type from extracted text
 *   - parseStatement(buffer, hint) — extract text once, dispatch to the
 *                                    matching parser, return ParsedStatement
 *
 * Adding a new format = create a parser file with `detect*` + `parse*Stream`,
 * register it in DETECTORS + PARSERS below.
 */

import { extractPdfText } from './pdf-text';
import type { DocType, ParsedStatement } from './types';
import { detectLic, parseLicStream } from './lic';
import { detectChit, parseChitStream } from './chit-dsc';
import { detectMfSip, parseMfSipStream } from './mf-sip';
import { detectEpfPassbook, parseEpfPassbookStream } from './epf-passbook';
import { detectNpsSot, parseNpsSotStream } from './nps-sot';

export type { DocType, ParsedStatement } from './types';
export type {
  LicParsed,
  LicPolicySummary,
  LicPaymentMode,
  ChitParsed,
  MfSipParsed,
  MfSipRow,
  EpfPassbookParsed,
  EpfPassbookData,
  NpsSotParsed,
  NpsSotData,
} from './types';

// Detection order matters when two detectors might fire on the same
// document. EPF + NPS detectors use very specific header tokens so
// false positives are unlikely; keeping them after the originals just
// preserves test stability.
const DETECTORS: Array<{ type: Exclude<DocType, 'unknown'>; detect: (s: string) => boolean }> = [
  { type: 'lic', detect: detectLic },
  { type: 'chit', detect: detectChit },
  { type: 'mf-sip', detect: detectMfSip },
  { type: 'epf-passbook', detect: detectEpfPassbook },
  { type: 'nps-sot', detect: detectNpsSot },
];

export function detectDocType(stream: string): DocType {
  for (const { type, detect } of DETECTORS) {
    if (detect(stream)) return type;
  }
  return 'unknown';
}

const PARSERS: Record<Exclude<DocType, 'unknown'>, (s: string) => ParsedStatement> = {
  lic: parseLicStream,
  chit: parseChitStream,
  'mf-sip': parseMfSipStream,
  'epf-passbook': parseEpfPassbookStream,
  'nps-sot': parseNpsSotStream,
};

export interface ParseResult {
  detectedType: DocType;
  resolvedType: DocType;
  parsed: ParsedStatement;
  rawTextLength: number;
}

/**
 * Parse a PDF buffer.
 *   - extracts text once via pdfjs
 *   - detects type (or honours hint if provided)
 *   - dispatches to the matching parser
 *   - returns both detected and resolved type so the UI can highlight overrides
 */
export async function parseStatement(
  buffer: Buffer,
  hint?: DocType
): Promise<ParseResult> {
  const stream = await extractPdfText(buffer);
  const detected = detectDocType(stream);
  const resolved: DocType =
    hint && hint !== 'unknown' ? hint : detected;

  if (resolved === 'unknown') {
    return {
      detectedType: detected,
      resolvedType: 'unknown',
      rawTextLength: stream.length,
      parsed: {
        type: 'unknown',
        warnings: [
          'Could not detect document type. Supported: LIC Premium Statement, Chit Fund Account Copy, Mutual Fund CAS, EPF Passbook, NPS Statement of Transactions.',
        ],
      },
    };
  }

  const parse = PARSERS[resolved];
  return {
    detectedType: detected,
    resolvedType: resolved,
    parsed: parse(stream),
    rawTextLength: stream.length,
  };
}
