import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, incomeTaxPaid } from '@/db';

/**
 * Export CSV_IT.csv — advance tax + self-assessment challans.
 *
 * Columns (per ITR-3 utility):
 *   BSR Code · Date of Deposit (DD/MM/YYYY) · Serial Number of Challan · Amount (Rs)
 *
 * BSR code is bank's branch code in the challan; we don't store it separately,
 * so we expect users to put it in the `referenceNumber` field as
 * "BSR:0000000|SERIAL:00001" or just BSR. We split by '|' if present, else
 * leave the BSR column blank.
 */

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function parseRef(ref: string | null): { bsr: string; serial: string } {
  if (!ref) return { bsr: '', serial: '' };
  // Heuristic: support "BSR:1234567|SERIAL:00001" or "1234567/00001" or "1234567"
  if (ref.includes('|')) {
    const parts = Object.fromEntries(
      ref.split('|').map((s) => {
        const [k, v] = s.split(':');
        return [k.trim().toUpperCase(), (v ?? '').trim()];
      }),
    );
    return { bsr: parts.BSR ?? '', serial: parts.SERIAL ?? '' };
  }
  if (ref.includes('/')) {
    const [bsr, serial] = ref.split('/').map((s) => s.trim());
    return { bsr, serial };
  }
  return { bsr: ref.trim(), serial: '' };
}

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

    const rows = await db
      .select()
      .from(incomeTaxPaid)
      .where(eq(incomeTaxPaid.financialYear, fy));

    const eligible = rows.filter((r) => r.paymentType === 'ADVANCE_TAX' || r.paymentType === 'SELF_ASSESSMENT');

    const lines: string[] = [
      ['BSR Code', 'Date of Deposit (DD/MM/YYYY)', 'Serial Number of Challan', 'Amount (Rs)']
        .map(csvCell)
        .join(','),
    ];
    for (const r of eligible) {
      const { bsr, serial } = parseRef(r.referenceNumber);
      lines.push(
        [bsr, ddmmyyyy(r.paymentDate), serial, (r.amount / 100).toFixed(2)].map(csvCell).join(','),
      );
    }
    const csv = lines.join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="CSV_IT_${fy}.csv"`,
      },
    });
  } catch (err) {
    console.error('Failed to export Schedule IT:', err);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
