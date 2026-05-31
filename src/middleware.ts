/**
 * Edge middleware — session-cookie presence check only.
 *
 * Auth.js v5 with `session: { strategy: 'database' }` cannot run in
 * Edge: its adapter (postgres-js) needs Node APIs, and wrapping with
 * Auth.js' `auth()` here threw `MissingAdapter` on every request and
 * fell through silently — no redirect.
 *
 * The contract at the edge is intentionally cheap: "does a session
 * cookie exist?" Full validation (cookie → session row → user) happens
 * in route handlers via `auth()` from src/auth.ts, which has the
 * adapter. An attacker with a random ≥16-char cookie can reach a page
 * but every server-side query will reject them.
 *
 * Next.js 16 has begun renaming middleware.ts → proxy.ts; the rename
 * is logged in the dev output already. Sprint 2 swaps the filename.
 */

import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set([
  '/login',
  '/login/check-email',
  // PWA assets. Must be reachable pre-auth — the manifest is loaded by
  // every page (including /login); the service worker fails registration
  // if the script fetch hits even one redirect. None of these expose
  // tenant data.
  '/sw.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/offline.html',
]);

const PUBLIC_PREFIXES = [
  '/_next/',
  '/api/auth/',
  '/favicon.ico',
];

// Auth.js v5 cookie names. The `__Secure-` prefix is added automatically
// when the cookie is set over HTTPS, so we accept either.
const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Length floor: Auth.js session tokens are 32+ chars. Reject anything
  // obviously not-a-token to make casual cookie tampering loud.
  const hasSessionCookie = SESSION_COOKIE_NAMES.some(
    (name) => (req.cookies.get(name)?.value?.length ?? 0) >= 16,
  );

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
