/**
 * POST /api/desktop/backup — dump the desktop's embedded PGlite to a timestamped
 * .sql file in PFD_BACKUP_DIR and prune to the most recent N. The Electron
 * launcher calls this on a schedule (and the dumps are re-importable via
 * /api/desktop/import-db, same format as a prod backup).
 *
 * Desktop-only (needs the in-process pglite handle) + bearer-authed with the
 * same CRON_SECRET the launcher already holds.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pglite } from '@/db';
import { pgDump } from '@electric-sql/pglite-tools';

export const runtime = 'nodejs';
export const maxDuration = 600;

const KEEP = 14; // retain the most recent 14 self-backups

export async function POST(req: NextRequest) {
  if (!pglite) {
    return NextResponse.json({ error: 'desktop only' }, { status: 400 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dir = process.env.PFD_BACKUP_DIR;
  if (!dir) {
    return NextResponse.json({ error: 'PFD_BACKUP_DIR not set' }, { status: 400 });
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    const blob = await pgDump({ pg: pglite });
    // gzip so 14 retained backups stay small (~6MB each vs ~40MB plain).
    const buf = zlib.gzipSync(Buffer.from(await blob.arrayBuffer()));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `artha-${stamp}.sql.gz`);
    fs.writeFileSync(file, buf);

    // Prune oldest, keep the most recent KEEP.
    const all = fs.readdirSync(dir).filter((f) => /^artha-.*\.sql\.gz$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - KEEP))) {
      fs.rmSync(path.join(dir, f), { force: true });
    }

    return NextResponse.json({ ok: true, file, bytes: buf.length });
  } catch (err) {
    console.error('[backup] failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'backup failed' }, { status: 500 });
  }
}
