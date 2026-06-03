# pfd-saas — Self-host with Docker

A single-container preview build for testing/feedback before the SaaS launch.
Bundles postgres 17 + the Next.js app in one image with a single mounted
volume for persistence. No email setup, no external services — just `docker
run`.

---

## Quick start

```bash
docker run -d \
  -v pfd_data:/data \
  -p 3000:3000 \
  --name pfd-saas \
  pfd-saas:latest

open http://localhost:3000
```

That's it. First boot takes ~15 s while postgres initialises and migrations
run; subsequent restarts come up in 3-5 s.

---

## First-run experience

1. Browse to <http://localhost:3000>. The login screen asks for an email
   address. **No SMTP server is required** — any email works.
2. Submit. You land on a "Preparing your sign-in…" page.
3. Within ~1 second the page swaps to a big "Sign in as you@example.com →"
   button. Click it.
4. You're in. The dashboard is empty.
5. An amber banner reads *"Welcome to pfd-saas! Your dashboard is empty.
   [Load demo data]"*. Click the button.
6. The page reloads with a realistic ₹24L-salary portfolio: salary,
   deductions, stocks, MF, insurance, home loan. Explore freely.
7. When done, **Settings → Wipe demo data** removes everything.

If you'd rather use a real email and skip the in-UI link surface, set
`MAGIC_LINK_DISPLAY=email` and `EMAIL_SERVER=...` (see Configuration).

---

## Configuration

All env vars are optional. Set with `-e KEY=value` on `docker run`.

| Env var | Default | Effect |
|---|---|---|
| `AUTH_URL` | `http://localhost:3000` | Public URL of your instance. Set this when running behind a proxy or on a non-default port — Auth.js uses it to build callback URLs. |
| `FEEDBACK_URL` | `mailto:bharath.devanathan@htcinc.com?subject=pfd-saas%20feedback` | Where the sidebar "Send feedback" link points. Override with a GitHub issues URL or your own intake form. |
| `MAGIC_LINK_DISPLAY` | `ui` | `ui` — surface the magic link in the browser (default, no SMTP needed). `email` — send via SMTP (requires `EMAIL_SERVER`). `both` — do both. |
| `EMAIL_SERVER` | unset | SMTP URL, e.g. `smtps://user:pass@smtp.gmail.com:465`. Required when `MAGIC_LINK_DISPLAY=email`. |
| `EMAIL_FROM` | `noreply@pfd-saas.local` | From-address used in outbound magic-link emails. |
| `TELEGRAM_BOT_TOKEN` | unset | Optional. When set, the `/daily-digest` and `/alerts` features can push messages to Telegram. Without it the features still render — they just don't send. |

The internal postgres password and `AUTH_SECRET` are generated on first boot
and persisted in `/data/.secrets/`. You never see them; you never need them.

---

## Backups

The whole instance is one volume. Two recipes:

**Volume snapshot (simplest):**

```bash
docker run --rm \
  -v pfd_data:/data \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/pfd-snapshot-$(date +%F).tar.gz -C /data .
```

**Logical pg_dump (smaller, portable):**

```bash
docker exec pfd-saas \
  sh -c 'PGPASSWORD=$(cat /data/.secrets/postgres_password) \
         pg_dump -h 127.0.0.1 -U pfd_saas -d pfd_saas' \
  > pfd-saas-$(date +%F).sql
```

---

## Restore

**From a volume snapshot:**

```bash
docker stop pfd-saas && docker rm pfd-saas
docker volume rm pfd_data
docker volume create pfd_data
docker run --rm \
  -v pfd_data:/data \
  -v "$PWD":/backup \
  alpine \
  tar xzf /backup/pfd-snapshot-YYYY-MM-DD.tar.gz -C /data
# then re-run the Quick Start docker run
```

**From a pg_dump:**

Start a fresh container, wait for migrations to complete, then:

```bash
docker exec -i pfd-saas \
  sh -c 'PGPASSWORD=$(cat /data/.secrets/postgres_password) \
         psql -h 127.0.0.1 -U pfd_saas -d pfd_saas' \
  < pfd-saas-YYYY-MM-DD.sql
```

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

**Magic link doesn't appear.** Open `docker logs pfd-saas` — the URL is
always logged. The in-browser polling tries for 10 s, then falls back to
the inbox message; the link itself is valid for 5 min either way.

**Container marks itself unhealthy.** Healthcheck probes
`http://127.0.0.1:3000/api/health` every 30 s. If unhealthy, check
`docker logs pfd-saas` for postgres start failures or app crashes. The DB
connection failing is the usual culprit; resolution is almost always a
container restart.

---

## Security note

This image is built for **personal/local self-host**. The in-UI magic-link
delivery means anyone who can reach `/api/auth/pending-link` AND knows the
target email can claim that session. That's exactly the right tradeoff for
single-user localhost. **Do not expose port 3000 directly to the internet**
without putting a real auth layer (Cloudflare Access, Tailscale, an nginx
basic-auth, etc.) in front. For multi-tenant production, switch to
`MAGIC_LINK_DISPLAY=email` and configure a real SMTP server.

---

## Sending feedback

This is a preview build. Reports welcome — click **Send feedback** in the
sidebar (the link goes wherever the deployer set `FEEDBACK_URL`), or email
the maintainer directly.
