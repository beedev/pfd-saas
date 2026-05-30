/**
 * LEGACY single-password auth — to be replaced by Auth.js magic-link in the
 * next commit. Kept here so the existing middleware doesn't 500 during the
 * migration. Reads ADMIN_PASSWORD env var (no default). Fails if unset.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      return NextResponse.json(
        { error: 'Server misconfigured: ADMIN_PASSWORD not set' },
        { status: 500 },
      );
    }
    if (password !== expected) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: 'Server misconfigured: SESSION_SECRET not set' },
        { status: 500 },
      );
    }
    const token = crypto.createHmac('sha256', secret).update(password).digest('hex');
    const response = NextResponse.json({ success: true });
    response.cookies.set('finance-session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
