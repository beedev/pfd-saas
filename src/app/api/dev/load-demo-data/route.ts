/**
 * POST /api/dev/load-demo-data
 *
 * Pre-populates the authenticated user's account with a comprehensive,
 * realistic financial portfolio so testers can explore every screen
 * without registering real data first. Scoped to the calling user — the
 * route never touches another tenant.
 *
 * Sprint 6.1.9a — body of the seed extracted to
 * `src/lib/dev/seed-demo-data.ts` (`seedDemoDataForUser(userId, name)`)
 * so the built-in account switcher can re-use the same seed for the
 * lazy-provisioned Demo account. Behaviour of this endpoint is
 * unchanged: it still requires a session and seeds whoever the session
 * belongs to.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { seedDemoDataForUser } from '@/lib/dev/seed-demo-data';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const { inserted, total } = await seedDemoDataForUser(
      userId,
      session.user.name ?? 'Demo User',
    );

    return NextResponse.json({
      ok: true,
      inserted,
      total,
      note: 'Demo data loaded. Use POST /api/dev/wipe-demo-data to remove.',
    });
  } catch (err) {
    console.error('[load-demo-data] failed:', err);
    return NextResponse.json(
      {
        error: 'load_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
