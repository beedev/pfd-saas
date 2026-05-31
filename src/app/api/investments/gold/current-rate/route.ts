import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCurrentGoldRate } from '@/lib/services/ibja';

// GET /api/investments/gold/current-rate — current 24K/22K INR per gram
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rate = await getCurrentGoldRate();
    return NextResponse.json(rate);
  } catch (err) {
    console.error('Failed to fetch current gold rate:', err);
    return NextResponse.json(
      { error: 'Failed to fetch gold rate' },
      { status: 500 }
    );
  }
}
