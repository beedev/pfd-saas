import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { db, taxDeductions, taxDocuments } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

const INR = (paisa: number) => (paisa / 100).toFixed(2);

function normalizeSection(s: string | null): string {
  if (!s) return 'UNKNOWN';
  if (s.startsWith('SECTION_')) return s.replace('SECTION_', '');
  return s;
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type DeductionRow = typeof taxDeductions.$inferSelect;

function generateSummaryCsv(deductions: DeductionRow[]): string {
  const rows = deductions;
  const header = [
    'Section',
    'SubType',
    'Description',
    'Recipient',
    'Amount (INR)',
    'Payment Date',
    'Payment Method',
    'PAN',
    '80G Cert#',
    'Qualifying %',
    'FY',
    'Notes',
  ].join(',');
  const body = rows.map((r) =>
    [
      normalizeSection(r.section),
      r.subType ?? '',
      r.description,
      r.recipientName ?? '',
      INR(r.amountPaisa || r.deductibleAmount || 0),
      r.paymentDate ?? r.incurredDate,
      r.paymentMethod ?? '',
      r.recipientPan ?? '',
      r.recipient80gNumber ?? '',
      r.qualifyingPercent ?? '',
      r.financialYear,
      r.notes ?? '',
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header, ...body].join('\n');
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || getCurrentFinancialYear();

  try {
    const [deductions, docs] = await Promise.all([
      db.select().from(taxDeductions).where(eq(taxDeductions.financialYear, fy)),
      db.select().from(taxDocuments).where(eq(taxDocuments.financialYear, fy)),
    ]);

    const zip = new JSZip();

    // Summary CSV
    zip.file('summary.csv', generateSummaryCsv(deductions));

    // README
    zip.file(
      'README.txt',
      `Tax Filing Pack — FY ${fy}\n` +
        `Generated: ${new Date().toISOString()}\n` +
        `Total deductions: ${deductions.length}\n` +
        `Documents included: ${docs.length}\n`
    );

    // Organise docs into folders by section (or category if no deduction link)
    for (const doc of docs) {
      const abs = path.resolve(process.cwd(), doc.filePath);
      if (!fs.existsSync(abs)) continue;
      const buf = await fs.promises.readFile(abs);

      let folder = 'misc';
      if (doc.deductionId) {
        const ded = deductions.find((d) => d.id === doc.deductionId);
        if (ded) folder = normalizeSection(ded.section);
      } else if (doc.category) {
        folder = doc.category;
      }
      zip.file(`${folder}/${doc.fileName || `document-${doc.id}`}`, buf);
    }

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    const bytes = new Uint8Array(content);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fy}-tax-pack.zip"`,
        'Content-Length': String(content.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate pack';
    console.error('[tax/filing-pack]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
