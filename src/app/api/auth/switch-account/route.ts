/**
 * POST /api/auth/switch-account?to=demo|personal
 *
 * Sprint 6.1.9b — Click-to-sign-in endpoint for the Docker self-host's
 * built-in two-account switcher. Replaces the magic-link round-trip
 * with a single round-trip:
 *
 *   1. Validate the target ('demo' or 'personal').
 *   2. Lazily provision the well-known account if missing
 *      (ensureAccountExists handles user + user_preferences inserts;
 *      demo also gets the BXDEva seed when its portfolio is empty).
 *   3. Mint a fresh Auth.js-compatible session row.
 *   4. Set the same `authjs.session-token` cookie NextAuth would set,
 *      so downstream `auth()` calls accept it unchanged.
 *
 * The route is gated by the DEMO_PERSONAL_SWITCH env flag — when the
 * flag is unset or != 'true', the route 404s. Production SaaS
 * deployments leave the flag off and continue to use the magic-link
 * flow.
 *
 * Two return modes:
 *
 *   - HTML form post (Accept includes 'text/html') → 303 redirect to /
 *     so the cards on /login can `<form method="POST" action="...">`
 *     and navigate naturally on success, no JS required.
 *
 *   - JSON request (any other Accept) → { ok, account, isNew }
 *     so client-side switch buttons can fetch() and reload.
 *
 * Public path — listed in proxy.ts under PUBLIC_PREFIXES via
 * '/api/auth/' so an unauthenticated visitor can hit it (you can't
 * switch INTO a session you don't yet have).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';

import { db, sessions } from '@/db';
import { ensureAccountExists, type SwitcherTarget } from '@/lib/dev/account-switcher';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d, matches Auth.js default

export async function POST(req: NextRequest) {
  // Env-flag gate. Production SaaS path uses magic links, not this.
  if (process.env.DEMO_PERSONAL_SWITCH !== 'true') {
    return NextResponse.json({ error: 'switcher_disabled' }, { status: 404 });
  }

  const to = req.nextUrl.searchParams.get('to');
  if (to !== 'demo' && to !== 'personal') {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = to as SwitcherTarget;

  let result;
  try {
    result = await ensureAccountExists(target);
  } catch (err) {
    console.error('[switch-account] ensureAccountExists failed:', err);
    return NextResponse.json(
      {
        error: 'provision_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
  const { userId, isNew } = result;

  // Mint a fresh Auth.js-shaped session row.
  // The Drizzle adapter writes sessionToken + userId + expires.
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  try {
    await db.insert(sessions).values({ sessionToken, userId, expires });
  } catch (err) {
    console.error('[switch-account] session insert failed:', err);
    return NextResponse.json(
      { error: 'session_create_failed' },
      { status: 500 },
    );
  }

  // Set the same cookie NextAuth uses. Mirrors Auth.js's defaults so
  // every downstream `auth()` reader picks it up without modification.
  const cookieStore = await cookies();
  cookieStore.set('authjs.session-token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires,
  });

  // Form posts (HTML) get a 303 redirect to '/'. Fetch-based callers
  // get JSON. We sniff the Accept header; text/html means the browser
  // is navigating, JSON means script.
  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL('/', req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true, account: target, isNew });
}
