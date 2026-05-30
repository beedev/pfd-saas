import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL('/login', request.url);
  const response = NextResponse.redirect(url);
  response.cookies.set('finance-session', '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('finance-session', '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return response;
}
