import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db, capitalGains } from '@/db';

/**
 * Export CSV_112A_and_115AD.csv per ITR-3 official utility format.
 * Pulls LTCG entries from capital_gains for the requested FY.
 *
 * Columns (per ITR-3 utility):
 *  1a Share/Unit acquired (date)
 *  1b Share/Unit Transferred (date)
 *  2  ISIN Code
 *  3  Name of the Share/Unit
 *  4  No. of Shares/Units
 *  5  Sale-price per Share/Unit
 *  6  Full Value of Consideration (= 4 × 5)
 *  7  Cost of acquisition without indexation
 *  8  Cost of acquisition
 *  9  If acquired before 01.02.2018 (Y/N)
 *  10 FMV per share/unit on 31.01.2018
 *  11 Total FMV (= 4 × 10)
 *  12 Expenditure on transfer
 *  13 Total deductions (= 7 + 12)
 *  14 Balance (= 6 - 13)
 */

const HEADER = [
  'Share/Unit acquired(1a)',
  'Share/Unit Transferred(1b)',
  'ISIN Code(2)',
  'Name of the Share/Unit(3)',
  'No. of Shares/Units(4)',
  'Sale-price per Share/Unit(5)',
  'Full Value of Consideration(Total Sale Value)(6) = 4 * 5',
  'Cost of acquisition without indexation(7)',
  'Cost of acquisition(8)',
  'If the long term capital asset was acquired before 01.02.2018(9)',
  'Fair Market Value per share/unit as on 31st January,2018(10)',
  'Total Fair Market Value of capital asset as per section 55(2)(ac)(11) = 4 * 10',
  'Expenditure wholly and exclusively in connection with transfer(12)',
  'Total deductions(13) = 7 + 12',
  'Balance(14) = 6 - 13',
];

function ddmmyyyy(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function csvCell(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const rows = await db
      .select()
      .from(capitalGains)
      .where(and(eq(capitalGains.financialYear, fy), eq(capitalGains.holdingPeriod, 'LTCG')));

    const lines: string[] = [HEADER.map(csvCell).join(',')];
    for (const r of rows) {
      const saleRupees = r.salePrice / 100;
      const costRupees = r.purchasePrice / 100;
      // Without per-unit detail in the existing schema, leave units/per-unit blank
      // so the user can fill in the Excel utility manually. CSV is still importable
      // with totals — Excel will compute consistently if user enters units.
      lines.push(
        [
          ddmmyyyy(r.purchaseDate),
          ddmmyyyy(r.saleDate),
          '', // ISIN
          r.assetName,
          '', // units
          '', // sale price per unit
          saleRupees.toFixed(2),
          costRupees.toFixed(2),
          costRupees.toFixed(2),
          'N',
          '',
          '',
          '0',
          costRupees.toFixed(2),
          (saleRupees - costRupees).toFixed(2),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const csv = lines.join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="CSV_112A_and_115AD_${fy}.csv"`,
      },
    });
  } catch (err) {
    console.error('Failed to export 112A:', err);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
