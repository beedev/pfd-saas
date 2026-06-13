/**
 * OpenAI API key configuration (self-host).
 *
 *   GET    → { configured, selfHost }
 *   POST   { key } → validate via OpenAI /v1/models, persist to the volume
 *            secrets file, apply to the running process. → { ok }
 *   DELETE → clear the key (secrets file + env). → { ok }
 *
 * Powers the optional nutrition estimator in the Transformation tracker
 * (estimate-nutrition reads process.env.OPENAI_API_KEY at call time, so a
 * saved key takes effect immediately). Without a key, nutrition estimates are
 * simply skipped — the tracker works fully.
 *
 * Self-host only; the public SaaS manages OPENAI_API_KEY via env. The key is
 * written to /data/.secrets/openai_api_key (auto-loaded by the entrypoint on
 * boot, kept out of DB backups).
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { auth } from '@/auth';
import { isSelfHost } from '@/lib/self-host';

const KEY_FILE = process.env.OPENAI_KEY_FILE ?? '/data/.secrets/openai_api_key';

async function validateKey(key: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function persistKey(key: string): void {
  try {
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, key, { mode: 0o600 });
    chmodSync(KEY_FILE, 0o600);
  } catch (err) {
    console.warn('[openai-key] could not persist to secrets file:', err);
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    selfHost: isSelfHost(),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!isSelfHost()) {
    return NextResponse.json(
      { error: 'On this deployment the OpenAI key is managed via the OPENAI_API_KEY env var.' },
      { status: 403 },
    );
  }

  let key = '';
  try {
    const body = (await req.json()) as { key?: string };
    key = (body.key ?? '').trim();
  } catch {
    /* invalid body handled below */
  }
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return NextResponse.json(
      { error: 'That doesn’t look like an OpenAI key (it starts with sk-…). Copy it from platform.openai.com.' },
      { status: 400 },
    );
  }
  if (!(await validateKey(key))) {
    return NextResponse.json(
      { error: 'OpenAI rejected that key (couldn’t list models). Check it on platform.openai.com → API keys.' },
      { status: 400 },
    );
  }

  process.env.OPENAI_API_KEY = key;
  persistKey(key);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!isSelfHost()) {
    return NextResponse.json({ error: 'Managed via env on this deployment.' }, { status: 403 });
  }
  delete process.env.OPENAI_API_KEY;
  try {
    if (existsSync(KEY_FILE)) rmSync(KEY_FILE);
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}
