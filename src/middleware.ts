/**
 * Auth.js v5 middleware — Edge runtime.
 *
 * Imports the Edge-safe config only (no DrizzleAdapter, no fs).
 * The session-token cookie is verified at the edge by Auth.js using
 * AUTH_SECRET; full DB-backed validation happens later in route
 * handlers via auth() from src/auth.ts.
 *
 * Note: Next.js 16 has started renaming `middleware.ts` to `proxy.ts`.
 * Both work for now; switch in Sprint 2 once the rename is final.
 */

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import authConfig from '@/auth.config';

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set([
  '/login',
  '/login/check-email',
]);

const PUBLIC_PREFIXES = [
  '/_next/',
  '/api/auth/',
  '/favicon.ico',
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!req.auth) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
