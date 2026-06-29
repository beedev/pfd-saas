/** GET /api/agent/instrument/ohlc?symbol=&range= — daily OHLC bars for candles. */
import { NextRequest, NextResponse } from 'next/server';
import { getDailyOHLC, getIntradayBars } from '@/lib/services/yahoo-finance';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

const RANGES = new Set(['3mo', '6mo', '1y', '2y', '5y']);
const INTRADAY = new Set(['1m', '5m', '15m']);

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim();
  const range = (url.searchParams.get('range') || '1y').trim();
  const interval = (url.searchParams.get('interval') || '').trim();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  // Intraday: today's bars keyed by epoch-seconds time (for live candles).
  if (INTRADAY.has(interval)) {
    const raw = await getIntradayBars(symbol, interval);
    const bars = raw.map((b) => ({ time: b.epoch, open: b.open, high: b.high, low: b.low, close: b.close }));
    return NextResponse.json({ symbol, interval, bars });
  }

  const bars = await getDailyOHLC(symbol, RANGES.has(range) ? range : '1y');
  return NextResponse.json({ symbol, range, bars });
}
