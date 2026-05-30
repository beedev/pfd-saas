import { NextRequest, NextResponse } from 'next/server';
import { getQuotes } from '@/lib/services/yahoo-finance';

// GET /api/investments/quotes?symbols=RELIANCE.NS&symbols=INFY.NS
// or     /api/investments/quotes?symbols=RELIANCE.NS,INFY.NS
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.getAll('symbols');
  const symbols = raw
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  if (!symbols.length) {
    return NextResponse.json({ error: 'No symbols provided' }, { status: 400 });
  }

  try {
    const quotes = await getQuotes(symbols);
    return NextResponse.json({ quotes });
  } catch (err) {
    console.error('Quotes API error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch quotes' },
      { status: 500 }
    );
  }
}
