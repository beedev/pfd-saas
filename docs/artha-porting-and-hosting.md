# Artha — Porting & Hosting Reference

*Captured 2026-07-05. Reference for moving the always-on forward-test to a stable
host without losing data. Suggestions, not yet executed — we start on the Mac.*

Artha runs as the **single self-contained `vaspar-pfd` Docker container** (embedded
Postgres + Next standalone + in-container scheduler). The plan: **start the 1.0
forward-test on the Apple-Silicon Mac now**, and **port to a permanent always-on
host** (old Intel iMac / Pi / cloud) once confidence grows. Nothing is lost in the
move — the whole study lives in the database.

---

## 1. The database *is* the study — everything ports with it

All persistent state is in the **`vaspar-pfd-data` Docker volume**:
- **Postgres DB** — every table: daily picks, trades, positions, **daily equity
  snapshots**, RS watchlist, delivery history, run-health, users, sessions, sleeves.
- **Secrets** — `/data/.secrets`: postgres password, `AUTH_SECRET`, `CRON_SECRET`,
  `TELEGRAM_BOT_TOKEN`. Auto-loaded by `docker-entrypoint.sh`.
- **Uploads** — `/data/uploads`.

Port the DB (+ secrets + uploads) → the new host is an exact continuation; the
equity curve resumes from the same day, no gap.

---

## 2. How to port

### Same architecture (→ another Apple Silicon Mac, or an arm64 Pi)
Copy the whole volume — simplest; the container wakes up thinking nothing changed:
```bash
# on the SOURCE host:
docker run --rm -v vaspar-pfd-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/vaspar-vol.tgz -C /data .
# transfer vaspar-vol.tgz to the target, then on the TARGET:
docker volume create vaspar-pfd-data
docker run --rm -v vaspar-pfd-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/vaspar-vol.tgz -C /data
```

### Cross architecture (this Mac = Apple Silicon/arm64 → Intel iMac = amd64)
A raw Postgres data-dir copy across CPU arches is **not** guaranteed. Use the
**logical dump** (arch-independent, the officially-safe path), and copy the
secrets/uploads files separately:
```bash
# on the SOURCE (Mac): dump the DB (this is the portable format)
PW=$(docker exec vaspar-pfd cat /data/.secrets/postgres_password)
docker exec -e PGPASSWORD="$PW" vaspar-pfd pg_dump -h127.0.0.1 -U pfd_saas -d pfd_saas -Fc > artha.dump
# also grab secrets + uploads:
docker cp vaspar-pfd:/data/.secrets ./secrets-backup
docker cp vaspar-pfd:/data/uploads ./uploads-backup
# on the TARGET (iMac): build the amd64 image, start the container once so initdb
# runs, then restore INTO it and drop the target's fresh secrets in favour of the
# source's (so auth/telegram keep working). Restore:
cat artha.dump | docker exec -i -e PGPASSWORD="$PW" vaspar-pfd \
  pg_restore -h127.0.0.1 -U pfd_saas -d pfd_saas --clean --if-exists
```
> Copying the **source secrets** over the target's keeps sessions/Telegram valid.
> If you skip that, the entrypoint generates fresh secrets → users must re-login and
> the Telegram token must be re-set.

We already `pg_dump` routinely (monthly LaunchAgent + manual). Latest manual backup:
`~/artha-backups/vaspar-pfd-pre-v1-flatten-20260705.dump`. That dump format *is* the
portable format — porting is a well-worn path, not a leap.

---

## 3. Host options (tradeoffs)

| Host | Verdict | Notes |
|---|---|---|
| **This Mac (Apple Silicon)** | Fine to start | On before 9am 100% of the time → morning run covered (on-time or catch-up before the 9:15 open); daytime use covers the 16:10 snapshot. Only a *full day off* (travel) is a real gap — and it's recorded. |
| **Old Intel iMac (Linux)** ⭐ | Recommended permanent home | Free, powerful, **real disk (no SD wear)**, residential IP. Build the image for **amd64** (Intel). Caveats: higher power draw (~50-100W), aging hardware → lean on backups. Disable sleep, Docker-on-boot. |
| **Raspberry Pi 5 (8GB)** | Good | arm64 → clean **volume copy**. **Put the data volume on a USB SSD** (SD cards die from Postgres writes). Residential IP, ~5-10W. |
| **Cloud VPS** | Works, but | Always-on, but a **datacenter IP is more likely bot-blocked by NSE/Yahoo**. *Test the bhavcopy + Yahoo fetch from its IP before committing.* Attach a persistent volume. |

**Key insight:** for an NSE-scraping workload, a **home box (iMac/Pi) with a
residential IP is safer than cloud** — it sidesteps the one real risk (datacenter
IPs getting blocked by NSE/Yahoo bot-protection).

---

## 4. Operational notes

- **Never-sleep on the permanent host.** Linux: `systemctl mask sleep.target
  suspend.target hibernate.target`. macOS (if kept on Mac): `sudo pmset -c sleep 0`
  (+ `disablesleep 1` for lid-closed clamshell). Keep it plugged in.
- **Docker on boot** + `--restart unless-stopped` → survives reboots/power loss.
- **Timezone is handled** — the cron computes IST *inside Postgres*
  (`AT TIME ZONE 'Asia/Kolkata'`), so it fires correctly regardless of the host's
  local timezone.
- **Verify data-source egress once** on any new host: run a bhavcopy + Yahoo fetch
  and confirm they succeed (they will from a residential IP).
- **Remote access:** add **Tailscale** to reach the dashboard + get signals from
  anywhere.

---

## 5. Missed-day tolerance (why the Mac is realistic to start)

This is a **2-3-month-hold momentum** system — not scalping — so daily precision
isn't the edge:
- The cron **catches up**: a job whose 07:35 time passed while asleep fires when the
  machine is next on (before the 9:15 open = fine).
- A genuine miss (machine off a *full* day) costs: a few skipped entries (names
  re-surface next day), one missing equity-curve dot, maybe a delayed paper exit —
  all minor over ~125 trading days.
- **The heartbeat records every miss** (run-health log) → gaps are visible, never
  silent. The study stays honest.

---

## 6. Backups during the study

- Bump the backup cadence to **weekly `pg_dump`** during the 6-month run (a bad host
  day should never cost more than a week).
- Backups live in `~/artha-backups/` (Mac) / wherever the permanent host stores them.
- Restore = `pg_restore` the last dump → back in minutes.

---

## 7. Standard deploy command (reference)

```bash
docker build -t vaspar-pfd:latest .            # (build amd64 on/for Intel hosts)
docker rm -f vaspar-pfd
docker run -d --name vaspar-pfd --restart unless-stopped -p 9999:3000 \
  -v vaspar-pfd-data:/data -e AUTH_URL=http://<host>:9999 -e DEMO_PERSONAL_SWITCH=true \
  vaspar-pfd:latest
```
Secrets auto-load from the volume; no `-e` secrets needed once the volume exists.
