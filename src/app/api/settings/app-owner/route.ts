/**
 * Instance owner name (self-host).
 *
 *   GET    → { owner, appName, selfHost }
 *   POST   { owner } → persist to the volume + apply live. → { ok, appName }
 *   DELETE → clear (back to plain "Artha"). → { ok, appName }
 *
 * Drives the "<Owner>'s Artha" branding without needing the APP_OWNER env var:
 * the name is written to /data/.secrets/app_owner (auto-loaded into APP_OWNER
 * by the entrypoint on boot) and applied to process.env immediately so the
 * sidebar/title update on the next render. A deploy-time APP_OWNER env still
 * works and takes precedence at boot.
 *
 * Self-host only; the public SaaS keeps a fixed brand.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { auth } from '@/auth';
import { isSelfHost } from '@/lib/self-host';
import { appName } from '@/lib/brand';

const OWNER_FILE = process.env.APP_OWNER_FILE ?? '/data/.secrets/app_owner';

// A person/space name: starts with a letter, then letters/spaces/.'- up to 40.
const OWNER_RE = /^\p{L}[\p{L} .'’-]{0,39}$/u;

function persist(owner: string): void {
  try {
    mkdirSync(dirname(OWNER_FILE), { recursive: true });
    writeFileSync(OWNER_FILE, owner, { mode: 0o600 });
    chmodSync(OWNER_FILE, 0o600);
  } catch (err) {
    console.warn('[app-owner] could not persist to secrets file:', err);
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  return NextResponse.json({
    owner: process.env.APP_OWNER ?? '',
    appName: appName(),
    selfHost: isSelfHost(),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!isSelfHost()) {
    return NextResponse.json({ error: 'Branding is fixed on this deployment.' }, { status: 403 });
  }

  let owner = '';
  try {
    const body = (await req.json()) as { owner?: string };
    owner = (body.owner ?? '').trim();
  } catch {
    /* handled below */
  }
  if (!OWNER_RE.test(owner)) {
    return NextResponse.json(
      { error: 'Enter a name of 1–40 letters (spaces, . ’ - allowed).' },
      { status: 400 },
    );
  }

  process.env.APP_OWNER = owner; // live for this process
  persist(owner);
  return NextResponse.json({ ok: true, appName: appName() });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (!isSelfHost()) {
    return NextResponse.json({ error: 'Branding is fixed on this deployment.' }, { status: 403 });
  }
  delete process.env.APP_OWNER;
  try {
    if (existsSync(OWNER_FILE)) rmSync(OWNER_FILE);
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true, appName: appName() });
}
