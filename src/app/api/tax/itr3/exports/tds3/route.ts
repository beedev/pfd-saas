import { NextRequest, NextResponse } from 'next/server';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { db, tdsCredits } from '@/db';

/**
 * Export CSV_TDS3.csv — TDS where deductor uses PAN/Aadhaar (e.g. property purchase u/s 194-IA).
 */

function csvCell(v: string | number): string {
  const s = String(v ?? '');
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
      .from(tdsCredits)
      .where(
        and(eq(tdsCredits.financialYear, fy), isNotNull(tdsCredits.deductorPan), isNull(tdsCredits.deductorTan)),
      );

    const HEADER = [
      'TDS credit in the name of  (Col 2)',
      'PAN Of Other Person (If TDS Credit related to other person) (Col 3i)',
      'Aadhaar No. Of Other Person (If TDS credit related to other person) (Col 3ii)',
      'PAN of the buyer/ tenant/ deductor (Col 4a)',
      'Aadhaar of the buyer/ tenant/ deductor (Column 4b)',
      'Section under which TDS is deducted',
      'Fin. year in which deducted - UTBF (Col 5)',
      'TDS b/f - UTBF (Col 6)',
      'Deducted in own hands - TCFY (Col 7)',
      'Income - Deducted in hands of any other person as per rule 37BA(2) - TCFY (Col 8a)',
      'TDS - Deducted in hands of any other person as per rule 37BA(2) - TCFY (Col 8b)',
      'Claimed in own hands - TC (Col 9)',
      'Income - CHS - TC (Col 10a)',
      'TDS - CHS - TC (Col 10b)',
      'PAN - CHS - TC (Col 10c)',
      'Aadhar No - CHS - TC (Col 10d)',
      'Gross Amount - CRO (Col 11)',
      'Head of Income - CRO (Col 12)',
      'TDS credit being carried forward (Col 13)',
    ];

    const lines: string[] = [HEADER.map(csvCell).join(',')];
    for (const r of rows) {
      const incomeRupees = (r.incomePaisa / 100).toFixed(2);
      const tdsRupees = (r.tdsPaisa / 100).toFixed(2);
      const headOfIncome =
        r.category === 'CONSULTING' ? 'Profits and gains of business or profession' :
        r.category === 'INTEREST' ? 'Income from other sources' :
        r.category === 'RENT' ? 'Income from house property' :
        r.category === 'PROPERTY' ? 'Capital Gains' :
        'Income from other sources';

      lines.push(
        [
          'Self', '', '',
          r.deductorPan ?? '', '',
          r.section,
          fy,
          '0',
          tdsRupees,
          '', '',
          tdsRupees,
          '', '', '', '',
          incomeRupees,
          headOfIncome,
          '0',
        ]
          .map(csvCell)
          .join(','),
      );
    }

    return new NextResponse(lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="CSV_TDS3_${fy}.csv"`,
      },
    });
  } catch (err) {
    console.error('Failed to export TDS3:', err);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
