import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, salaryIncome } from '@/db';

/**
 * Export CSV_TDS1.csv — TDS from salary employers (Form 16).
 * Columns (per ITR-3 utility):
 *   TAN of Employer · Name of Employer · Income chargeable under Salaries · Total tax deducted
 */

function csvCell(v: string | number): string {
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

    const rows = await db.select().from(salaryIncome).where(eq(salaryIncome.financialYear, fy));

    const lines: string[] = [
      ['TAN of Employer', 'Name of Employer', 'Income chargeable under Salaries', 'Total tax deducted']
        .map(csvCell)
        .join(','),
    ];
    for (const r of rows) {
      lines.push(
        [
          r.employerTan,
          r.employerName,
          (r.taxableSalaryPaisa / 100).toFixed(2),
          ((r.tdsPaisa ?? 0) / 100).toFixed(2),
        ]
          .map(csvCell)
          .join(','),
      );
    }

    return new NextResponse(lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="CSV_TDS1_${fy}.csv"`,
      },
    });
  } catch (err) {
    console.error('Failed to export TDS1:', err);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
