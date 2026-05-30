import { NextRequest, NextResponse } from 'next/server';

// Paths that don't require authentication
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/investments/sips/auto-execute', '/api/investments/stocks/refresh-prices', '/api/investments/mutual-funds/refresh-navs', '/api/investments/gold/refresh-rates', '/api/daily-digest', '/api/alerts/check'];
const PUBLIC_PREFIXES = ['/_next/', '/favicon.ico'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Check session cookie
  const session = request.cookies.get('finance-session')?.value;
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Validate session: we can't run HMAC in Edge middleware easily,
  // so we check the cookie is non-empty and matches expected length (64 hex chars for SHA-256 HMAC)
  if (!/^[a-f0-9]{64}$/.test(session)) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('finance-session');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
