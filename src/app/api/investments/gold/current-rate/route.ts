import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getCurrentGoldRate } from '@/lib/services/ibja';

// GET /api/investments/gold/current-rate — current 24K/22K INR per gram
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
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
