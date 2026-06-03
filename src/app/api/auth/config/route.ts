/**
 * GET /api/auth/config
 *
 * Public-ish config flags that client components legitimately need to
 * read at runtime. Exposes only what's already non-secret and already
 * acted on server-side (login page, sidebar) — this endpoint just
 * surfaces the same flag to client components that can't `process.env`.
 *
 * Currently returns:
 *   - accountSwitcherEnabled: bool — DEMO_PERSONAL_SWITCH === 'true'
 *
 * Lives under /api/auth/* so the existing PUBLIC_PREFIXES allowlist in
 * proxy.ts lets it through without a session cookie (it's about HOW
 * to sign in; you can't have a session yet).
 *
 * Why not NEXT_PUBLIC_DEMO_PERSONAL_SWITCH: that var bakes in at build
 * time, but our Docker image is built once and the entrypoint sets the
 * flag at container boot. A runtime read keeps the bundle generic.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    accountSwitcherEnabled: process.env.DEMO_PERSONAL_SWITCH === 'true',
  });
}
