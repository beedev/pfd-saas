/**
 * POST /api/dev/wipe-demo-data
 *
 * Removes every row inserted by /api/dev/load-demo-data for the
 * authenticated user. Scoped strictly to the calling tenant: deletes
 * only rows where notes LIKE 'DEMO-SEED:%' AND user_id matches.
 *
 * Sprint 6.1.6 — surfaced from Settings as "Wipe demo data" (red
 * button with confirm). The wipe is idempotent — running it on a user
 * with no demo data is a no-op.
 *
 * Real data inserted by the user is never touched. The marker prefix
 * guarantees we only remove our own seed.
 */

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { auth } from '@/auth';

const TABLES_WITH_DEMO_MARKER = [
  'holdings',
  'mutual_funds',
  'salary_income',
  'tax_deductions',
  'insurance_policies',
  'liabilities',
];

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const deleted: Record<string, number> = {};
    for (const table of TABLES_WITH_DEMO_MARKER) {
      // Drizzle's sql template doesn't interpolate identifiers safely,
      // so we whitelist the table name above and concatenate. The list
      // is hardcoded — no user input ever reaches this point.
      const result = await db.execute(
        sql.raw(`DELETE FROM ${table} WHERE user_id = '${userId.replace(/'/g, "''")}' AND notes LIKE 'DEMO-SEED:%'`),
      );
      // postgres-js returns { count: N } on DELETE
      deleted[table] = (result as { count?: number }).count ?? 0;
    }

    const total = Object.values(deleted).reduce((s, n) => s + n, 0);

    return NextResponse.json({
      ok: true,
      deleted,
      total,
    });
  } catch (err) {
    console.error('[wipe-demo-data] failed:', err);
    return NextResponse.json(
      {
        error: 'wipe_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
