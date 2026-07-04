/** POST /api/agent/workbench/author — NL description → DSL spec + English explain-back (preview, no save). */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { authorStrategy } from '@/lib/agent/workbench/nl-author';

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const nl = typeof body.nl === 'string' ? body.nl.trim() : '';
    if (nl.length < 8) return NextResponse.json({ error: 'Describe the strategy in a sentence' }, { status: 400 });
    const result = await authorStrategy(nl, { universe: body.universe, horizon: body.horizon });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'author failed' }, { status: 500 });
  }
}
