# Backup & Restore

Sprint 6.3 ships two helper scripts that take logical backups of a running
pfd-saas container and restore them back in. Backups are portable across
hosts and tolerant of same-major Postgres version differences.

## Quick start

Back up:

```bash
./scripts/pfd-backup.sh
# → ./backups/pfd-backup-YYYYMMDD-HHMMSS.tar.gz
```

Restore (interactive — prompts for the typed CONFIRM):

```bash
./scripts/pfd-restore.sh --from ./backups/pfd-backup-20260604-040000.tar.gz
```

Automated restore (no prompt):

```bash
./scripts/pfd-restore.sh --from /path/to/archive.tar.gz --force
```

## What's in a backup

Each archive is a single `tar.gz` containing:

| Entry           | What                                                          |
| --------------- | ------------------------------------------------------------- |
| `db.dump`       | `pg_dump -Fc` (Postgres custom format; already gzip-compressed) |
| `uploads.tar`   | `/data/uploads/` from inside the container (per-user files)   |
| `manifest.json` | Metadata: image id, image repo, pgVersion, sizes, schemaHash  |

A typical archive runs ~50 KB empty and grows with row count / uploads.

## What's NOT in a backup

- **The Docker image itself.** Re-pull or rebuild on the restore host.
- **`/data/.secrets/`** — the postgres password and `AUTH_SECRET` belong to
  the cluster, not the data. A fresh container regenerates them on first
  boot. Restoring a backup into a different cluster will invalidate any
  in-flight sessions (testers must sign in again — fine for the v1
  self-host trust model).
- **`/data/pgdata/`** raw cluster files. We deliberately use `pg_restore`
  instead of swapping the on-disk cluster, which gives us same-major
  Postgres version tolerance.
- **Host script logs.** Capture those yourself (see scheduling below).

## Retention

`pfd-backup.sh` defaults to keeping the 7 most recent archives in
`--out`. Older archives are pruned at the end of each run. Override with
`--keep <n>` (e.g. `--keep 30` for a month of dailies).

Retention is purely a count of files in `$OUT`; the script doesn't
distinguish "the archive I'm about to make" from "ones already there."
If you point the script at a directory that already has 10 archives and
`--keep 7`, the 3 oldest get pruned.

## Scheduled backups (host crontab)

Run nightly at 3 AM, append output to a log:

```cron
0 3 * * * cd /Users/bharath/Desktop/pfd-saas && ./scripts/pfd-backup.sh --out /Users/bharath/Desktop/pfd-saas/backups --no-color >> /Users/bharath/Desktop/pfd-saas/logs/backup.log 2>&1
```

Notes:
- Absolute paths only — `cron` runs with a minimal `PATH`.
- `--no-color` keeps the log file clean of ANSI escape codes.
- Make sure `logs/` exists (`mkdir -p logs`).
- Docker Desktop must be running for the cron job to succeed. On macOS,
  prefer a LaunchAgent if you also want the backup to fire after a
  sleep/wake cycle.

## Off-host backups

The archive lives on the host filesystem, so you can ship it anywhere
you'd ship a regular file. Two illustrative examples:

Rsync to a NAS (after the cron job runs):

```bash
rsync -av --delete /Users/bharath/Desktop/pfd-saas/backups/ nas.local:/volumes/pfd-saas-backups/
```

Push to S3:

```bash
aws s3 cp /Users/bharath/Desktop/pfd-saas/backups/pfd-backup-$(date +%F)-*.tar.gz s3://my-bucket/pfd-saas/
```

A separate retention policy on the off-host store is recommended (S3
lifecycle rules, NAS snapshot rotation, etc.) — the script's `--keep`
only governs the local `--out` dir.

## How restore works

`pfd-restore.sh`:

1. Validates the archive (gzip-tar, 3 expected entries).
2. Compares the backup's `pgVersion` against the running container's
   Postgres major version. **Cross-major mismatches fail by default.**
3. Asks you to type `CONFIRM` at stdin (skip with `--force`).
4. Creates `/data/.maintenance` inside the container and restarts it.
   The entrypoint sees the sentinel and brings Postgres up but holds
   Next.js back. This is what makes the restore safe against a live app.
5. `DROP DATABASE pfd_saas; CREATE DATABASE pfd_saas`.
6. `pg_restore --clean --if-exists --no-owner --no-acl` from `db.dump`.
7. Wipes and re-extracts `uploads.tar` into `/data/uploads/`.
8. Removes the sentinel and restarts the container — entrypoint sees no
   sentinel, runs idempotent drizzle migrations (no-op against a
   restored schema), and launches Next.js.
9. Polls `/api/health` on the published host port (discovered via
   `docker port <name> 3000`) until 200.

The maintenance sentinel is the load-bearing trick: it lets us reuse
the existing container (its config, networking, AUTH_URL, etc.) while
the database is being swapped out underneath.

## CONFIRM gate and `--force`

The interactive prompt prints the container name and waits for the
literal string `CONFIRM` (case-sensitive, no quotes). Anything else
aborts. This is the primary safety against `--from` typos in
production.

`--force` skips the prompt entirely. Use this when:
- Calling from a script (e.g. `smoke-backup.sh`, restore-tests in CI).
- You're restoring into a known-disposable test container.

## Cross-major Postgres upgrades

The backup records `pgVersion` (e.g. `17.10`) in `manifest.json`. On
restore, the script extracts the major part (`17`) and compares it to
the major version of the running container. A mismatch fails with:

```
Postgres major version mismatch: backup=16.4, container=17.10. Re-run
with --force-major to proceed at your own risk.
```

`--force-major` overrides this. `pg_restore` is generally tolerant of
backups taken on the previous major version (read-forward), but it's
**not** safe in the other direction (newer → older). The flag exists for
deliberate upgrades; it is not for automated restore loops.

## Common failure modes

| Symptom                                                | Cause / Fix                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Docker daemon not reachable`                          | Open Docker Desktop. Wait for the whale icon to stop pulsing.                                                                                                                |
| `Container 'pfd-saas' does not exist`                  | The container was removed. Run `./scripts/deploy.sh` to recreate it against the same `pfd_saas_data` volume.                                                                |
| `Container 'pfd-saas' is not running` (backup)         | Start it: `docker start pfd-saas`.                                                                                                                                           |
| `Archive is not a valid gzip tar`                      | Truncated download or partial transfer. Re-fetch.                                                                                                                            |
| `Archive missing expected entries`                     | Not a pfd-saas backup, or made by a future / forked version. Open it with `tar -tzf` and check.                                                                              |
| `Postgres major version mismatch` (restore)            | See Cross-major section above. Use `--force-major` if you understand the implications.                                                                                       |
| `Postgres did not become ready within 60s`             | The cluster is corrupt or the volume has been tampered with. Inspect `docker logs pfd-saas` for the failing `pg_ctl` line.                                                  |
| `App did not become healthy within 60s` (post-restore) | Migrations may be applying against the restored DB. Inspect `docker logs pfd-saas`. The Postgres half of the restore is already done, so re-running the script will be fast. |

## See also

- [README-DOCKER.md](../README-DOCKER.md) — single-container deployment.
- [docs/portability.md](portability.md) — per-user JSON export/import
  (Sprint 6.4). Backups are container-wide; portability is per-user.
