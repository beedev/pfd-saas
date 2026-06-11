#!/usr/bin/env node
/**
 * Monthly backup of the vaspar-pfd container — run by a LaunchAgent.
 *
 * Self-contained (node → docker only, no bash-script-in-Desktop) so macOS
 * gives it the lenient TCC treatment node enjoys under launchd. Writes a
 * pg_dump (-Fc) + an uploads tarball to ~/pfd-backups and prunes to the
 * last N. Logs go to ~/Library/Logs/pfd (NOT ~/Desktop, which launchd's
 * TCC blocks — exit 78).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOCKER = '/usr/local/bin/docker';
const CONTAINER = 'vaspar-pfd';
const OUT = join(process.env.HOME, 'pfd-backups');
const KEEP = 12; // ~1 year of monthly backups

function pad(n) { return String(n).padStart(2, '0'); }
const d = new Date();
// DDMMYYYY — human-obvious date stamp in the filename.
const ts = `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}`;
const log = (m) => console.log(`[${d.toISOString()}] ${m}`);

function docker(args) {
  return execFileSync(DOCKER, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  mkdirSync(OUT, { recursive: true });

  // 1. DB dump (custom format, version-tolerant) inside the container, copy out.
  docker(['exec', CONTAINER, 'sh', '-c',
    'PGPASSWORD=$(cat /data/.secrets/postgres_password) su-exec postgres pg_dump -Fc -h 127.0.0.1 -U pfd_saas -d pfd_saas -f /tmp/backup.dump']);
  const dumpFile = `vaspar-pfd-db-backup-${ts}.dump`;
  docker(['cp', `${CONTAINER}:/tmp/backup.dump`, join(OUT, dumpFile)]);
  docker(['exec', CONTAINER, 'rm', '-f', '/tmp/backup.dump']);

  // Prune — keep the last KEEP DB dumps. (Uploads are re-downloadable
  // PDFs, not backed up; the parsed data that matters lives in the DB.)
  const files = readdirSync(OUT)
    .filter((f) => f.startsWith('vaspar-pfd-db-backup') && f.endsWith('.dump'))
    .map((f) => ({ f, t: statSync(join(OUT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of files.slice(KEEP)) unlinkSync(join(OUT, old.f));

  log(`backup OK → ${join(OUT, dumpFile)}`);
} catch (err) {
  log(`backup FAILED: ${err.message}`);
  process.exit(1);
}
