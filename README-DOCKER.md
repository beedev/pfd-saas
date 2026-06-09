# pfd-saas — Self-host with Docker

A single-container preview build for testing/feedback before the SaaS launch.
Bundles postgres 17 + the Next.js app in one image with a single mounted
volume for persistence. No email setup, no external services — just `docker
run`.

---

## Quick install — no clone needed

Only prerequisite: Docker Desktop running.

```bash
curl -fsSL https://raw.githubusercontent.com/beedev/pfd-saas/main/install.sh | bash
```

Pulls the pre-built image from `ghcr.io/beedev/pfd-saas:latest` (built on every push
to main by [the GHCR workflow](./.github/workflows/docker-publish.yml)),
starts the container, waits for `/api/health`, opens your browser. Around **30 seconds
on a warm cache**, ~2 minutes on first run (one-time image pull, ~600 MB, multi-arch).

To upgrade later, re-run the same one-liner — it pulls the latest image and recreates
the container (your data in the named volume survives).

Pin to a specific version:

```bash
IMAGE_TAG=v0.7.0 curl -fsSL https://raw.githubusercontent.com/beedev/pfd-saas/main/install.sh | bash
```

Bind to a different port:

```bash
PORT=8080 curl -fsSL https://raw.githubusercontent.com/beedev/pfd-saas/main/install.sh | bash
```

### Or run docker directly

```bash
docker run -d \
  -v pfd_saas_data:/data \
  -p 3000:3000 \
  -e AUTH_URL=http://localhost:3000 \
  --name pfd-saas \
  ghcr.io/beedev/pfd-saas:latest

open http://localhost:3000
```

---

## Build from source (developers)

If you've cloned the repo and want to build locally instead of pulling
from GHCR:

```bash
./scripts/deploy.sh
```

The script builds the image from the local `Dockerfile`, sets up the persistent
volume, starts the container, polls `/api/health` until ready, then opens your
browser. First build takes ~5–10 minutes; subsequent rebuilds reuse layers.

---

## Two ways to use this

The Docker self-host image ships with a built-in two-account model — no email,
no magic links, no SMTP. The login screen shows two cards and one click signs
you in:

**Try the demo** — pre-loaded BXDEva-style portfolio (~₹2.76 Cr) across every
screen. Stocks, mutual funds, NPS, EPF, real estate, FDs, forex, insurance,
loans, deductions — all populated so you can explore without entering data.

**Use my own data** — empty dashboard. Enter your own salary, investments,
insurance, taxes. Everything you add lives in the Docker volume and survives
container restarts and image upgrades.

Switch between them anytime from the **⇆ Switch** button at the top of the
sidebar. Both accounts persist independently — the demo dataset stays demo,
your personal data stays personal.

For multi-user production deployments, set `-e DEMO_PERSONAL_SWITCH=false`
to disable the switcher and fall back to the email magic-link flow (see
[Configuration](#configuration)).

---

## First-run experience

1. Browse to <http://localhost:3000>. You'll see two cards: **Try the demo**
   and **Use my own data**.
2. Click one — you're signed in immediately. No email, no waiting.
3. From the sidebar, hit **⇆ Switch to <other>** to flip accounts at any
   time. The demo seed lazily provisions on first click, so the very first
   "Open Demo" takes a few extra seconds; subsequent switches are instant.
4. Both accounts live in the Docker volume. They survive container
   restarts and image rebuilds (the IDs are stable constants in the code).

---

## Data safety for personal use

If you're using pfd-saas with your real financial data, three things matter:

1. **Back up the volume.** All your data lives in the `pfd_data` Docker volume.
   The simplest backup is a `pg_dump`:

   ```bash
   docker exec pfd-saas pg_dump -U pfd_saas pfd_saas > pfd-saas-$(date +%Y-%m-%d).sql
   ```

   Run weekly (or after big updates). Restore via `psql` (see [Restore](#restore)).

2. **Keep port 3000 local.** The default `-p 3000:3000` binds to all interfaces.
   If your machine is on a shared LAN or has a public IP, switch to
   `-p 127.0.0.1:3000:3000` so only your machine can reach it. (See the
   [Security caveat for self-host](#security-caveat-for-self-host) section
   below.)

3. **Wipe sample data doesn't touch real data.** The wipe button filters on
   `notes LIKE 'DEMO-SEED:%'` — anything you entered manually is untouched.

---

## Security caveat for self-host

The default Docker mode replaces real authentication with click-to-sign-in.
That's appropriate for **localhost-only personal use** — the trust boundary
is the machine itself. Do **not** expose port 3000 to the open internet under
`DEMO_PERSONAL_SWITCH=true`: anyone who can reach the port can sign in as
either account with one click.

If you need to share the instance over a network:

- **Single user, remote access** — put it behind Tailscale, a VPN, or
  Cloudflare Access. The switcher is fine inside a trusted overlay network.
- **Multiple users** — disable the switcher entirely:
  ```bash
  docker run ... -e DEMO_PERSONAL_SWITCH=false -e EMAIL_SERVER=... pfd-saas:latest
  ```
  This restores the email magic-link flow (requires `EMAIL_SERVER` to actually
  send anywhere — see [Configuration](#configuration)).

---

## Configuration

All env vars are optional. Set with `-e KEY=value` on `docker run`.

| Env var | Default | Effect |
|---|---|---|
| `AUTH_URL` | `http://localhost:3000` | Public URL of your instance. Set this when running behind a proxy or on a non-default port — Auth.js uses it to build callback URLs. |
| `DEMO_PERSONAL_SWITCH` | `true` (Docker self-host) | When `true`, the login page shows the two-card Demo/Personal chooser and the sidebar exposes a Switch button. When `false`, falls back to the email magic-link flow. Set `false` for multi-user / production deployments. |
| `FEEDBACK_URL` | `mailto:bharath.devanathan@htcinc.com?subject=pfd-saas%20feedback` | Where the sidebar "Send feedback" link points. Override with a GitHub issues URL or your own intake form. |
| `MAGIC_LINK_DISPLAY` | `ui` | Only consulted when `DEMO_PERSONAL_SWITCH=false`. `ui` — surface the magic link in the browser (default, no SMTP needed). `email` — send via SMTP (requires `EMAIL_SERVER`). `both` — do both. |
| `EMAIL_SERVER` | unset | SMTP URL, e.g. `smtps://user:pass@smtp.gmail.com:465`. Required when `MAGIC_LINK_DISPLAY=email`. |
| `EMAIL_FROM` | `noreply@pfd-saas.local` | From-address used in outbound magic-link emails. |
| `TELEGRAM_BOT_TOKEN` | unset | Optional. When set, the `/daily-digest` and `/alerts` features can push messages to Telegram. Without it the features still render — they just don't send. |

The internal postgres password and `AUTH_SECRET` are generated on first boot
and persisted in `/data/.secrets/`. You never see them; you never need them.

---

## Backups & restore

Use `./scripts/pfd-backup.sh` and `./scripts/pfd-restore.sh`. See
[docs/backup-restore.md](docs/backup-restore.md) for retention,
scheduling, off-host recipes, and cross-major Postgres notes.

**Volume snapshot (stop-the-world alternative):**

For a simple full-volume copy that doesn't require the container to be
running (or a `pg_restore`-compatible target), stop everything and
`tar` the volume directly:

```bash
docker stop pfd-saas
docker run --rm \
  -v pfd_data:/data \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/pfd-snapshot-$(date +%F).tar.gz -C /data .
docker start pfd-saas
```

Restore is the reverse: stop, remove the container, recreate the
volume, untar back into it, then re-run the Quick Start `docker run`.
This is simplest but has no cross-major Postgres tolerance and locks
the app for the duration.

---

## Updates

Pull the new image and recreate the container with the same volume. Drizzle
migrations run automatically on startup; the journal in `drizzle/meta/` tracks
which migrations have been applied, so re-running is safe.

```bash
docker pull pfd-saas:latest
docker stop pfd-saas && docker rm pfd-saas
docker run -d -v pfd_data:/data -p 3000:3000 --name pfd-saas pfd-saas:latest
```

Your data, secrets, and sessions all survive.

---

## Logs

```bash
docker logs pfd-saas              # tail-style
docker logs -f pfd-saas           # follow
docker logs --tail 100 pfd-saas   # last 100 lines
```

Postgres and the Next.js app share stdout. The entrypoint prefixes its own
lines with `[entrypoint]`; postgres lines look like `LOG:  database system
ready…`; Next.js logs are unprefixed.

When you sign in, the magic link also appears in the logs — handy if your
browser tab refresh interrupted the polling sequence:

```
[auth] 🔑  MAGIC LINK (mode: ui)
       to:  you@example.com
       url: http://localhost:3000/api/auth/callback/nodemailer?...
```

---

## Stop / start / remove

```bash
docker stop pfd-saas       # graceful shutdown (postgres flushes + closes)
docker start pfd-saas      # restart (data survives)
docker rm -f pfd-saas      # remove container; volume + data survive
docker volume rm pfd_data  # nuclear: delete the data volume too
```

---

## Where data lives

Inside the container, everything persistent is under `/data`:

| Path | Contents |
|---|---|
| `/data/pgdata/` | Postgres cluster files |
| `/data/uploads/` | User-uploaded PDFs, statements |
| `/data/.secrets/postgres_password` | Internal DB role secret (mode 600) |
| `/data/.secrets/auth_secret` | Next-auth session signing key (mode 600) |
| `/data/pgsocket/` | Unix domain socket — never leaves the container |

The host sees all of this through the named volume `pfd_data`. Back up the
volume = back up everything.

---

## Troubleshooting

**Port 3000 already in use.** Bind a different host port:
`-p 9999:3000` — internal port stays 3000, the URL becomes
`http://localhost:9999` (and set `-e AUTH_URL=http://localhost:9999`).

**Stock prices show 0.** The container reaches Yahoo Finance from inside.
Confirm outbound HTTPS works: `docker exec pfd-saas wget -O- https://query1.finance.yahoo.com 2>&1 | head -5`.

**MF NAVs show stale.** AMFI's NAVAll.txt is fetched on demand; the cache
TTL is 30 min. Wait or restart the container.

**Magic link doesn't appear.** Only relevant when running with
`DEMO_PERSONAL_SWITCH=false`. Open `docker logs pfd-saas` — the URL is always
logged. The in-browser polling tries for 10 s, then falls back to the inbox
message; the link itself is valid for 5 min either way.

**"Open Demo" takes 10–20 s the first time.** Expected — the BXDEva seed runs
once and inserts ~150 rows across 23 tables inside a single transaction.
Subsequent switches are instant.

**Container marks itself unhealthy.** Healthcheck probes
`http://127.0.0.1:3000/api/health` every 30 s. If unhealthy, check
`docker logs pfd-saas` for postgres start failures or app crashes. The DB
connection failing is the usual culprit; resolution is almost always a
container restart.

---

## Security note

This image is built for **personal/local self-host**. By default
(`DEMO_PERSONAL_SWITCH=true`), authentication is click-to-sign-in — anyone
reaching port 3000 can claim either account with one POST. That's the right
tradeoff for single-user localhost; it's not safe to expose to the open
internet.

See [Security caveat for self-host](#security-caveat-for-self-host) above for
the full breakdown. For multi-tenant production, set
`-e DEMO_PERSONAL_SWITCH=false -e EMAIL_SERVER=...` to switch to the real
email magic-link flow.

---

## Sending feedback

This is a preview build. Reports welcome — click **Send feedback** in the
sidebar (the link goes wherever the deployer set `FEEDBACK_URL`), or email
the maintainer directly.
