/** GET /api/agent/instrument/ohlc?symbol=&range= — daily OHLC bars for candles. */
import { NextRequest, NextResponse } from 'next/server';
import { getDailyOHLC } from '@/lib/services/yahoo-finance';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

const RANGES = new Set(['3mo', '6mo', '1y', '2y', '5y']);

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim();
  const range = (url.searchParams.get('range') || '1y').trim();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  const bars = await getDailyOHLC(symbol, RANGES.has(range) ? range : '1y');
  return NextResponse.json({ symbol, range, bars });
}
