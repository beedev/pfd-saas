/**
 * Mutual Fund SIP / CAS (Consolidated Account Statement) parser.
 *
 * Stub awaiting a sample PDF (CAMS, Karvy, MF Central). When the user uploads
 * one, fill this in. The detect heuristic and shape are pre-wired so the
 * generic wizard can route an MF PDF to this parser without changes elsewhere.
 */

import { extractPdfText } from './pdf-text';
import type { MfSipParsed } from './types';

export function detectMfSip(stream: string): boolean {
  return /Consolidated Account Statement/i.test(stream)
    || /CAMS/i.test(stream)
    || /KFin Technologies/i.test(stream)
    || /Mutual Fund/i.test(stream);
}

export async function parseMfSipPdf(buffer: Buffer): Promise<MfSipParsed> {
  const stream = await extractPdfText(buffer);
  return parseMfSipStream(stream);
}

export function parseMfSipStream(_stream: string): MfSipParsed {
  return {
    type: 'mf-sip',
    asOfDate: null,
    panLast4: null,
    totalInvestedPaisa: 0,
    totalCurrentPaisa: null,
    schemes: [],
    warnings: [
      'MF SIP / CAS parser is not implemented yet. Upload a sample CAS PDF and the parser will be filled in.',
    ],
  };
}
