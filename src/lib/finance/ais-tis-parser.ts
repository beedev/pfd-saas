/**
 * AIS / TIS parser — Income-Tax department "what they have on you" extractor.
 *
 * These PDFs are downloaded from the compliance portal PAN+DOB-encrypted.
 * We decrypt with a derived password (PAN + DDMMYYYY, both cases) and pull
 * AGGREGATE totals only (the Gap-Check hub compares totals, not line items):
 *
 *   - TIS  → the page-1 Information-Category summary (Salary, Interest,
 *            Dividend, Sale of securities/MF, Business receipts, …). The
 *            "Accepted by Taxpayer / Confirmed by Source" column is the
 *            derived value; we prefer it, falling back to "Processed".
 *   - AIS  → Part B1 tax deducted/collected at source, summed per section
 *            (TDS-192 salary, TDS-194J business, TCS-206CQ …) — the
 *            authoritative "tax already paid" figure TIS doesn't summarise.
 *
 * All money is returned in paisa (integer). Source amounts are whole
 * rupees, so paisa = rupees × 100 exactly.
 */

import {
  extractPdfRows,
  isPdfPasswordError,
} from '@/lib/services/statement-parsers/pdf-text';

export type AisTisKind = 'AIS' | 'TIS';

export interface AisTisCategory {
  key: string; // normalized — maps to a booked dimension in the gap check
  label: string; // as printed in the document
  amountPaisa: number;
  /** Per-source breakdown (e.g. each company's dividend, each bank's interest)
   *  for mental reconciliation. Present for dividend + interest categories. */
  detail?: AisTisDetailItem[];
}

export interface AisTisDetailItem {
  source: string; // payer / bank / company name (PAN stripped)
  amountPaisa: number;
}

export interface AisTisTds {
  code: string; // TDS-192, TDS-194J, TCS-206CQ, …
  label: string;
  grossPaisa: number; // amount paid / credited
  tdsPaisa: number; // tax deducted / collected at source
}

export interface AisTisParseResult {
  kind: AisTisKind;
  fy: string | null;
  pan: string | null;
  categories: AisTisCategory[];
  tds: AisTisTds[];
}

/** Indian-formatted rupee string ("23,41,326") → paisa, or null if not a number. */
function rupeesToPaisa(s: string): number | null {
  const t = s.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

/** TIS Information-Category label → normalized key the gap check understands. */
const CATEGORY_KEYS: Record<string, string> = {
  'salary': 'salary',
  'interest from savings bank': 'interest_savings',
  'interest from deposit': 'interest_deposit',
  'dividend': 'dividend',
  'sale of securities and units of mutual fund': 'sale_securities_mf',
  'business receipts': 'business_receipts',
  'gst turnover': 'gst_turnover',
  'gst purchases': 'gst_purchases',
  'miscellaneous payment': 'misc_payment',
  'outward foreign remittance/purchase of foreign currency': 'foreign_remittance',
  'purchase of securities and units of mutual funds': 'purchase_securities_mf',
  'rent received': 'rent_received',
};

function normKey(label: string): string {
  const k = label.toLowerCase().trim();
  return (
    CATEGORY_KEYS[k] ??
    k.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  );
}

function parseFy(text: string): string | null {
  const m = text.match(/\b(20\d{2})-(\d{2})\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function parsePan(text: string): string | null {
  const m = text.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  return m ? m[1] : null;
}

/**
 * TIS page-1 Information-Category summary. Rows look like:
 *   "5\tSale of securities and units of mutual fund\t18,81,848\t18,81,848"
 * We read only the first summary block (bounded by the "information details
 * under each information category…" footer) so the per-source annexure on
 * later pages can't double-count.
 */
function parseTisCategories(rows: string[]): AisTisCategory[] {
  const out: AisTisCategory[] = [];
  const seen = new Set<string>();
  let inSummary = false;
  let started = false;
  for (const row of rows) {
    if (/information details under each/i.test(row)) break; // footer → end of page-1 summary
    if (/INFORMATION CATEGORY/i.test(row)) {
      if (started) break; // a second header = the per-source annexure → stop
      inSummary = true;
      continue;
    }
    if (!inSummary) continue;
    const cells = row.split('\t').map((c) => c.trim());
    if (cells.length >= 4 && /^\d+$/.test(cells[0])) {
      const label = cells[1];
      const confirmed = rupeesToPaisa(cells[3]);
      const processed = rupeesToPaisa(cells[2]);
      const amt = confirmed ?? processed;
      const key = normKey(label);
      if (label && amt != null && !seen.has(key)) {
        seen.add(key);
        started = true;
        out.push({ key, label, amountPaisa: amt });
      }
    }
  }
  return out;
}

/**
 * AIS Part B1 — sum tax deducted/collected per section. Section header rows
 * carry the code ("TDS-192") + a gross AMOUNT; the quarter rows beneath carry
 * "…\tamountPaid\tTDS_DEDUCTED\tTDS_DEPOSITED\tStatus" — we sum column-4.
 */
function parseAisTds(rows: string[]): AisTisTds[] {
  const map = new Map<string, AisTisTds>();
  let cur: string | null = null;
  for (const row of rows) {
    const cells = row.split('\t').map((c) => c.trim());
    const codeCell = cells.find((c) => /^(TDS|TCS)-\w+/.test(c));
    if (codeCell) {
      const code = codeCell.match(/^(?:TDS|TCS)-\w+/)![0];
      const idx = cells.indexOf(codeCell);
      const label = cells[idx + 1] ?? code;
      const gross = rupeesToPaisa(cells[cells.length - 1]) ?? 0;
      cur = code;
      if (!map.has(code)) map.set(code, { code, label, grossPaisa: gross, tdsPaisa: 0 });
      continue;
    }
    // Quarter data row under the current section.
    if (cur && cells.length >= 6 && /^\d+$/.test(cells[0]) && /^Q\d/.test(cells[1] ?? '')) {
      const tdsDed = rupeesToPaisa(cells[4]);
      if (tdsDed != null) map.get(cur)!.tdsPaisa += tdsDed;
    }
  }
  return [...map.values()];
}

/**
 * Candidate decryption passwords from the user's tax identity. The portal
 * format is PAN + DDMMYYYY; case has varied in the wild (observed lowercase),
 * so we try both. A manually-entered password (fallback UI) wins.
 */
export function derivePasswords(
  pan: string | null | undefined,
  dob: string | null | undefined,
  manual?: string | null,
): string[] {
  const out: string[] = [];
  if (manual && manual.trim()) out.push(manual.trim());
  const ddmmyyyy = dobToDdmmyyyy(dob);
  const p = (pan ?? '').replace(/\s+/g, '');
  if (p && ddmmyyyy) {
    out.push(p.toLowerCase() + ddmmyyyy, p.toUpperCase() + ddmmyyyy);
  }
  return [...new Set(out)];
}

/** Accepts "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY" → "DDMMYYYY". */
export function dobToDdmmyyyy(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const s = dob.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/); // DD/MM/YYYY
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return null;
}

/**
 * Parse an AIS or TIS PDF buffer. Tries each candidate password until one
 * decrypts; throws an error tagged `code: 'PDF_PASSWORD'` if none work.
 */
export async function parseAisTis(
  buffer: Buffer,
  passwords: string[],
): Promise<AisTisParseResult> {
  let rows: string[] | null = null;
  let passwordFailed = false;
  for (const pw of passwords.length ? passwords : ['']) {
    try {
      rows = await extractPdfRows(buffer, pw || undefined);
      break;
    } catch (e) {
      if (isPdfPasswordError(e)) {
        passwordFailed = true;
        continue;
      }
      throw e;
    }
  }
  if (rows == null) {
    const e = new Error(
      passwordFailed
        ? "Couldn't unlock the PDF — check the password (usually PAN + date of birth, DDMMYYYY)."
        : 'Could not read the PDF.',
    );
    (e as Error & { code?: string }).code = 'PDF_PASSWORD';
    throw e;
  }

  const text = rows.join(' ');
  const kind: AisTisKind = /Annual Information Statement/i.test(text) ? 'AIS' : 'TIS';
  const categories = kind === 'TIS' ? parseTisCategories(rows) : [];

  // Attach per-source detail (each company's dividend, each bank's interest)
  // from the annexure to the matching page-1 category, so the gap check can
  // show a reconcilable breakdown rather than a single opaque total.
  const details = parseSourceDetails(rows);
  for (const cat of categories) {
    if (details[cat.key]?.length) cat.detail = details[cat.key];
  }

  return {
    kind,
    fy: parseFy(text),
    pan: parsePan(text),
    categories,
    tds: kind === 'AIS' ? parseAisTds(rows) : [],
  };
}

/**
 * Per-source breakdown for dividend + interest, from the SFT detail lines in
 * the TIS annexure / AIS Part-B2. Each such line names the payer (with its PAN
 * in parentheses) and repeats the amount reported/processed/confirmed — we take
 * the last (confirmed) figure. Keyed to the same category keys parseTisCategories emits.
 */
function parseSourceDetails(rows: string[]): Record<string, AisTisDetailItem[]> {
  const out: Record<string, AisTisDetailItem[]> = {};
  for (const row of rows) {
    const cells = row.split('\t').map((c) => c.trim());
    const joined = cells.join(' ');

    let key: string | null = null;
    if (/SFT-015|Dividend income/i.test(joined)) key = 'dividend';
    else if (/SFT-016/i.test(joined) && /Saving/i.test(joined)) key = 'interest_savings';
    else if (/SFT-016/i.test(joined) && /(Term|Deposit)/i.test(joined)) key = 'interest_deposit';
    else if (/SFT-016/i.test(joined)) key = 'interest_savings';
    if (!key) continue;

    // Source = the cell shaped "NAME (PAN/ID)"; amount = last rupee cell on the row.
    const sourceCell = cells.find((c) => /\([A-Z0-9.]{4,}\)/.test(c) && /[A-Za-z]{3,}/.test(c));
    if (!sourceCell) continue;
    let amountPaisa: number | null = null;
    for (const c of cells) {
      const p = rupeesToPaisa(c);
      if (p != null) amountPaisa = p;
    }
    if (amountPaisa == null || amountPaisa <= 0) continue;

    const source = sourceCell.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
    (out[key] ??= []).push({ source, amountPaisa });
  }
  return out;
}
