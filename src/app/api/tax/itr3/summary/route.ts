import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { computeItr3Summary } from '@/lib/finance/itr3-summary';

/**
 * One-shot summary endpoint for the ITR-3 hub. Returns totals & per-section
 * data for the requested FY so the UI can render a checklist + cheat-sheet.
 *
 * Thin auth + param wrapper — all computation lives in
 * src/lib/finance/itr3-summary.ts (mirroring the ITR-1/2/4 siblings).
 */

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const summary = await computeItr3Summary(session.user.id, fy);
    return NextResponse.json(summary);
  } catch (err) {
    console.error('Failed to build ITR-3 summary:', err);
    return NextResponse.json({ error: 'Failed to build summary' }, { status: 500 });
  }
}
