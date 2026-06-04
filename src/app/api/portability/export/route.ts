/**
 * Sprint 6.4b — GET /api/portability/export
 *
 * Streams a single JSON file containing every row owned by the calling
 * user across the 72 user-scoped tables. Auth-tables, govt reference
 * data, and cron state are intentionally excluded (see
 * `src/lib/portability/constants.ts`).
 *
 * Companion: POST /api/portability/import (preview) and
 * POST /api/portability/import/confirm (commit) — together they form
 * the user-controlled escape hatch for moving data between containers
 * or recovering after demo exploration.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { buildExport } from '@/lib/portability/export';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const payload = await buildExport(userId);
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const filename = `pfd-export-${userId.slice(0, 8)}-${ts}.json`;
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[portability/export] failed:', err);
    return NextResponse.json(
      {
        error: 'export_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
