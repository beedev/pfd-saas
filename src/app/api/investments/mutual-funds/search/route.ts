import { NextRequest, NextResponse } from 'next/server';
import { searchByName } from '@/lib/services/amfi';
import { auth } from '@/auth';

// GET /api/investments/mutual-funds/search?q=hdfc — search AMFI scheme catalog
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const q = request.nextUrl.searchParams.get('q') || '';
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(Number(limitParam) || 20, 100) : 20;

    if (!q.trim()) {
      return NextResponse.json({ funds: [] });
    }
    const funds = await searchByName(q, limit);
    return NextResponse.json({ funds });
  } catch (error) {
    console.error('AMFI search error:', error);
    return NextResponse.json({ error: 'Failed to search AMFI' }, { status: 500 });
  }
}
