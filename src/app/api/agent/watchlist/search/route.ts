/**
 * GET /api/agent/watchlist/search?q=&class= — instrument search.
 *   STOCK/FUTURE → Yahoo symbol search; MF → AMFI name search.
 * Returns normalized candidates the UI can add directly to the watchlist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchSymbol } from '@/lib/services/yahoo-finance';
import { searchByName } from '@/lib/services/amfi';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const cls = (url.searchParams.get('class') || 'STOCK').toUpperCase();
    if (q.length < 2) return NextResponse.json({ results: [] });

    if (cls === 'MF') {
      const funds = await searchByName(q, 15);
      return NextResponse.json({
        results: funds.map((f) => ({
          assetClass: 'MF',
          schemeCode: f.schemeCode,
          isin: f.isin,
          name: f.schemeName,
          lastNav: f.nav,
        })),
      });
    }

    // STOCK / FUTURE — Yahoo symbol search.
    const hits = await searchSymbol(q);
    return NextResponse.json({
      results: hits.map((h) => ({
        assetClass: cls === 'FUTURE' ? 'FUTURE' : 'STOCK',
        symbol: h.symbol,
        name: h.longname || h.shortname || h.symbol,
        exchange: h.exchDisp,
        type: h.typeDisp,
      })),
    });
  } catch (err) {
    console.error('GET agent/watchlist/search:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
