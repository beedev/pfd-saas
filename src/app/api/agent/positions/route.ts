/** GET /api/agent/positions — open paper positions, marked to live prices. */
import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { markUserPositions } from '@/lib/agent/engine/mark-sleeve';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    // Mark to live prices on read so holdings show current price + P&L.
    const rows = await markUserPositions(userId);
    rows.sort((a, b) => (b.marketValuePaisa ?? 0) - (a.marketValuePaisa ?? 0));
    return NextResponse.json({ positions: rows });
  } catch (err) {
    console.error('GET agent/positions:', err);
    return NextResponse.json({ error: 'Failed to load positions' }, { status: 500 });
  }
}
