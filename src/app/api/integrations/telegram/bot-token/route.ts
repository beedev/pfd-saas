/**
 * Telegram bot-token configuration (self-host).
 *
 *   GET    → { configured, selfHost, botUsername }
 *   POST   { token } → validate via getMe, persist to the volume secrets file,
 *            apply to the running process immediately. → { ok, botUsername }
 *   DELETE → clear the token (secrets file + env). → { ok }
 *
 * Self-host only (TELEGRAM_CONNECT_MODE=getupdates). The public SaaS uses one
 * app-wide env token set at deploy time and must NOT let end users change it,
 * so POST/DELETE 403 outside self-host mode.
 *
 * The token is written to /data/.secrets/telegram_bot_token — the same file the
 * container entrypoint auto-loads into env on boot — so it survives restarts
 * and stays out of DB backups.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { auth } from '@/auth';
import { getBotUsername, resetBotUsernameCache } from '@/lib/services/telegram';

const TOKEN_FILE = process.env.TELEGRAM_TOKEN_FILE ?? '/data/.secrets/telegram_bot_token';

function isSelfHost(): boolean {
  return (process.env.TELEGRAM_CONNECT_MODE ?? 'webhook').toLowerCase() === 'getupdates';
}

async function validateToken(token: string): Promise<{ ok: boolean; username?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = (await res.json()) as { ok: boolean; result?: { username?: string } };
    if (j.ok && j.result?.username) return { ok: true, username: j.result.username };
  } catch {
    /* network error → invalid */
  }
  return { ok: false };
}

function persistToken(token: string): void {
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true });
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    chmodSync(TOKEN_FILE, 0o600);
  } catch (err) {
    // Non-fatal: dev has no /data volume. The token is still applied to
    // process.env for this run; it just won't persist across restarts.
    console.warn('[telegram/bot-token] could not persist to secrets file:', err);
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const botUsername = configured ? await getBotUsername() : null;
  return NextResponse.json({ configured, selfHost: isSelfHost(), botUsername });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!isSelfHost()) {
    return NextResponse.json(
      { error: 'On this deployment the bot token is managed via the TELEGRAM_BOT_TOKEN env var.' },
      { status: 403 },
    );
  }

  let token = '';
  try {
    const body = (await req.json()) as { token?: string };
    token = (body.token ?? '').trim();
  } catch {
    /* invalid body handled below */
  }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return NextResponse.json(
      { error: 'That doesn’t look like a bot token (expected like 123456789:ABC…). Copy it from BotFather.' },
      { status: 400 },
    );
  }

  const v = await validateToken(token);
  if (!v.ok) {
    return NextResponse.json(
      { error: 'Telegram rejected that token (getMe failed). Double-check it from BotFather.' },
      { status: 400 },
    );
  }

  process.env.TELEGRAM_BOT_TOKEN = token;
  resetBotUsernameCache();
  persistToken(token);

  return NextResponse.json({ ok: true, botUsername: v.username });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!isSelfHost()) {
    return NextResponse.json({ error: 'Managed via env on this deployment.' }, { status: 403 });
  }
  delete process.env.TELEGRAM_BOT_TOKEN;
  resetBotUsernameCache();
  try {
    if (existsSync(TOKEN_FILE)) rmSync(TOKEN_FILE);
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}
