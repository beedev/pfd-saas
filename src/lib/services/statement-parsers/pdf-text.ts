/**
 * Shared server-side PDF text extraction for statement parsers.
 *
 * Uses pdfjs-dist legacy ESM build with worker disabled — works in Node and
 * in Next.js Route Handlers (runtime: 'nodejs') without bundler gymnastics.
 *
 * Two extractors:
 *   - extractPdfText  — flat token stream joined by spaces. Cheap, works for
 *                       parsers that scan for keywords.
 *   - extractPdfRows  — items grouped by y-coordinate and ordered left-to-right
 *                       within each row. Preserves the table structure that
 *                       columnar PDFs (amortization schedules, statements)
 *                       depend on. Tokens within a row are tab-separated.
 */

interface PdfTextItem {
  str?: string;
  transform?: number[];
}

type PdfGetDocumentArg = Parameters<
  typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument
>[0];

async function loadDoc(buffer: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  return pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    disableWorker: true,
  } as PdfGetDocumentArg).promise;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const doc = await loadDoc(buffer);
  const tokens: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items as PdfTextItem[]) {
      const str = item.str;
      if (str && str.trim()) tokens.push(str.trim());
    }
  }
  await doc.destroy();
  return tokens.join(' ');
}

/**
 * Extract rows preserving table structure. Items sharing a y-coordinate
 * (rounded) become one row, ordered left-to-right by x. Rows are returned in
 * reading order (top-to-bottom across pages).
 *
 * Each row is a tab-separated string of cell values — split on `\t` to get
 * positional columns.
 */
export async function extractPdfRows(buffer: Buffer): Promise<string[]> {
  const doc = await loadDoc(buffer);
  const allRows: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const byY = new Map<number, Array<{ x: number; s: string }>>();
    for (const item of content.items as PdfTextItem[]) {
      const s = (item.str ?? '').trim();
      if (!s || !item.transform) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, s });
    }
    const rows = [...byY.entries()]
      .sort((a, b) => b[0] - a[0]) // top-to-bottom = descending y
      .map(([, items]) =>
        items.sort((a, b) => a.x - b.x).map((i) => i.s).join('\t'),
      );
    allRows.push(...rows);
  }
  await doc.destroy();
  return allRows;
}
