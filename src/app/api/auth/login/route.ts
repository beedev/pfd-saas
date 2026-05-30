import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    const expected = process.env.FINANCE_PASSWORD || 'bharath2026';
    if (password !== expected) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Create HMAC session token
    const secret = process.env.FINANCE_SECRET || 'personal-finance-dashboard-secret-key-2026';
    const token = crypto.createHmac('sha256', secret).update(password).digest('hex');

    const response = NextResponse.json({ success: true });
    response.cookies.set('finance-session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
