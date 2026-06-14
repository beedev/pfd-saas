/**
 * Edge proxy — session-cookie presence check only.
 *
 * Next.js 16 renamed the middleware file convention to `proxy.ts`. Same
 * API, same default export, same matcher config — only the filename
 * differs.
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
 */

import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set([
  '/login',
  '/login/check-email',
  // Sprint 6.1d — health probe. No auth so Docker HEALTHCHECK and
  // external monitors can hit it without credentials. Returns only
  // { ok, db, uptimeMs } — no tenant data.
  '/api/health',
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
  '/help/', // static user-guide HTML — no user data, readable without login
  '/api/auth/',
  '/api/cron/', // cron endpoints gate on Authorization: Bearer <CRON_SECRET>
  '/api/telegram/tick', // assistant heartbeat — Bearer <CRON_SECRET>, not session
  // Telegram bot posts here on /start; auth happens via the
  // X-Telegram-Bot-Api-Secret-Token header inside the route, not via
  // session cookie.
  '/api/integrations/telegram/webhook',
  '/favicon.ico',
];

// Auth.js v5 cookie names. The `__Secure-` prefix is added automatically
// when the cookie is set over HTTPS, so we accept either.
const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Dev-only auth bypass — paired with the synthetic-session handler
  // in src/auth.ts. ALL THREE conditions required:
  //   1. NODE_ENV !== 'production'
  //   2. DEV_AUTH_BYPASS === 'true'  (off by default)
  //   3. Request carries x-dev-as-user: <user_id>
  // Anything else falls through to the cookie check. The bypass is
  // intended for scripts/smoke-test-*.mjs; never enable in prod env.
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_AUTH_BYPASS === 'true' &&
    req.headers.get('x-dev-as-user')
  ) {
    return NextResponse.next();
  }

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
