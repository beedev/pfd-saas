/**
 * GET /api/health — liveness + readiness probe.
 *
 * Returns 200 + { ok: true, db: "up", uptimeMs: N } when the app can
 * reach its database. Returns 503 + { ok: false, db: "down" } if the
 * SELECT 1 round-trip fails.
 *
 * Used by:
 *   - The Docker HEALTHCHECK directive (Sprint 6.1b) — Docker marks the
 *     container "healthy" once this responds 200.
 *   - External load balancers / monitors when pfd-saas is deployed
 *     behind a proxy.
 *
 * No auth — intentionally public so an external monitor can probe
 * without credentials. Returns no sensitive information beyond
 * "yes I'm responding + my DB works".
 */

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

// Module-load timestamp — gives a coarse uptime reading for the Node
// process. Reset on every container restart.
const startedAt = Date.now();

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      ok: true,
      db: 'up',
      uptimeMs: Date.now() - startedAt,
    });
  } catch (err) {
    // Log the real failure server-side; the public probe response stays
    // generic so internal details (connection strings, hosts) never leak.
    console.error('[health] DB check failed:', err);
    return NextResponse.json(
      {
        ok: false,
        db: 'down',
        error: 'db unavailable',
      },
      { status: 503 },
    );
  }
}
