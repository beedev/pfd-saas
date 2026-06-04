/**
 * Sprint 6.4d — POST /api/portability/import/confirm
 *
 * Second step of the import flow. Reads the on-disk JSON the preview
 * step wrote, wipes every user-scoped row inside one transaction, and
 * re-inserts from the payload. See `src/lib/portability/import-commit.ts`
 * for the algorithm.
 *
 * Body: `{ importId: string }` — the id returned by the preview POST.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { commitImport } from '@/lib/portability/import-commit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { importId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const importId = body.importId;
  if (typeof importId !== 'string' || importId.length === 0) {
    return NextResponse.json({ error: 'importId is required.' }, { status: 400 });
  }

  try {
    const result = await commitImport(userId, importId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[portability/import/confirm] failed:', err);
    return NextResponse.json(
      {
        error: 'import_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
