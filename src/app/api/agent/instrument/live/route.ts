/**
 * GET /api/agent/instrument/live?symbol= — live last price + (for NSE stocks
 * during market hours) Depth-of-Market. NSE-direct for equities (LTP + order
 * book), Yahoo for indices/futures (LTP + change, ~delayed). Polled, not a true
 * tick stream — our free feeds don't push.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { isMarketOpen } from '@/lib/agent/market-data';
import { getQuote } from '@/lib/services/yahoo-finance';
import { nseSymbolFor, nseEquityDepth } from '@/lib/agent/providers/nse';

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const symbol = (new URL(request.url).searchParams.get('symbol') || '').trim();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  const marketOpen = await isMarketOpen();
  const nseSym = nseSymbolFor(symbol);

  // NSE equity + market open → real LTP + order book.
  if (nseSym && marketOpen) {
    const d = await nseEquityDepth(nseSym);
    if (d) {
      return NextResponse.json({
        symbol, marketOpen, source: 'NSE', asOf: Math.floor(d.ts / 1000),
        ltpPaisa: d.ltpPaisa, changePct: d.changePct,
        depth: { bids: d.bids, asks: d.asks, totalBuyQty: d.totalBuyQty, totalSellQty: d.totalSellQty },
      });
    }
  }

  // Fallback / non-NSE → Yahoo quote (delayed; no order book).
  const q = await getQuote(symbol);
  if (!q) return NextResponse.json({ symbol, marketOpen, ltpPaisa: null, depth: null });
  return NextResponse.json({
    symbol, marketOpen, source: 'YAHOO', asOf: q.regularMarketTime || null,
    ltpPaisa: Math.round(q.regularMarketPrice * 100),
    changePct: Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : null,
    depth: null,
    depthNote: nseSym ? (marketOpen ? 'Order book unavailable (NSE didn’t respond)' : 'Order book only during market hours')
      : 'Order book available only for NSE stocks',
  });
}
