import { NextRequest, NextResponse } from 'next/server';
import { eq, and, isNotNull } from 'drizzle-orm';
import { db, tdsCredits } from '@/db';
import { auth } from '@/auth';

/**
 * Export CSV_TDS2.csv — non-salary TDS where deductor has TAN.
 * Reduced columns: TAN, Section, FY, Income, TDS deducted, Claimed in own hands.
 * The user can fill the rest of the columns in the ITR-3 utility manually.
 */

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const rows = await db
      .select()
      .from(tdsCredits)
      .where(and(eq(tdsCredits.userId, session.user.id), eq(tdsCredits.financialYear, fy), isNotNull(tdsCredits.deductorTan)));

    // ITR-3 TDS2 has many columns; we populate just the essentials and leave
    // the rest blank for the user to fill in Excel.
    const HEADER = [
      'TDS Credit related to self/ other person as per rule 37BA(2) (Col 2)',
      'PAN of other person (Col 3i)',
      'Aadhaar of other person (Col 3ii)',
      'Tax Deduction Account No.[TAN] of the Employer (Col 4)',
      'Section under which TDS is deducted',
      'Financial year in which TDS deducted - UTBF (Col 5)',
      'TDS b/f - UTBF (Col 6)',
      'Deducted in own hands  - TCFY (Col 7)',
      'Income - Deducted in hands of any other person as per rule 37BA(2) (if applicable)  - TCFY (Col 8)',
      'TDS - Deducted in hands of any other person as per rule 37BA(2) (if applicable)  - TCFY (Col 8a)',
      'claimed in own hands - TC (Col 9)',
      'Income - CHS - TC (Col 10a)',
      'TDS - CHS - TC (Col 10b)',
      'PAN - CHS - TC (Col 10c)',
      'Aadhar No - CHS - TC (Col 10d)',
      'Gross amount  - CRO (Col 11)',
      'Head of income - CRO (Col 12)',
      'TDS Credit being carried forward (13)',
    ];

    const lines: string[] = [HEADER.map(csvCell).join(',')];
    for (const r of rows) {
      const headOfIncome =
        r.category === 'CONSULTING' ? 'Profits and gains of business or profession' :
        r.category === 'INTEREST' ? 'Income from other sources' :
        r.category === 'RENT' ? 'Income from house property' :
        'Income from other sources';
      const incomeRupees = (r.incomePaisa / 100).toFixed(2);
      const tdsRupees = (r.tdsPaisa / 100).toFixed(2);

      lines.push(
        [
          'Self', '', '',                  // 2, 3i, 3ii
          r.deductorTan ?? '',              // 4
          r.section,                         // section
          fy,                                // 5
          '0',                               // 6 b/f
          tdsRupees,                         // 7 deducted own hands
          '', '',                            // 8, 8a (other-person)
          tdsRupees,                         // 9 claimed own hands
          '', '', '', '',                    // 10a..10d CHS
          incomeRupees,                      // 11 gross
          headOfIncome,                      // 12 head
          '0',                               // 13 carry forward
        ]
          .map(csvCell)
          .join(','),
      );
    }

    return new NextResponse(lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="CSV_TDS2_${fy}.csv"`,
      },
    });
  } catch (err) {
    console.error('Failed to export TDS2:', err);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
