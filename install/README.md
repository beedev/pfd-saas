# Artha — install on a new machine

**Artha** is your personal command centre for money, taxes, GST, and personal
growth — all in INR, on your own machine. It runs as a **single Docker
container** (database + app + scheduler bundled), with everything saved in one
Docker volume. No accounts, no cloud, no email setup.

> Distributed as the Docker image `ghcr.io/beedev/pfd-saas:latest`
> (`pfd-saas` is the internal codename; the product is **Artha**).

Everything you need is in this folder:

| File | What it is |
|------|------------|
| `README.md` | This guide |
| `artha.sh` | Control script — **macOS / Linux** |
| `artha.bat` | Control script — **Windows** |

---

## Step 1 — Install Docker

You only need Docker. Pick your OS:

- **macOS** — install **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>
  (or `brew install --cask docker`). Open Docker Desktop once so the engine is running.
- **Windows** — install **Docker Desktop** (it sets up WSL2 for you):
  <https://www.docker.com/products/docker-desktop/>. Run the scripts below from
  **WSL** or **Git Bash**.
- **Linux** — `curl -fsSL https://get.docker.com | sh`, then
  `sudo usermod -aG docker $USER` and log out/in.

Check it works:

```bash
docker --version      # prints a version
docker info           # no error = the engine is running
```

---

## Step 2 — Install Artha

From this folder, run the script for your OS:

**macOS / Linux** (Terminal):
```bash
chmod +x artha.sh          # once, to make the script runnable
./artha.sh install
```

**Windows** (double-click `artha.bat`, or in Command Prompt):
```bat
artha.bat install
```

> In every command below, **macOS/Linux** use `./artha.sh <command>` and
> **Windows** use `artha.bat <command>` — they do the same thing.

It will:
1. Check Docker is running.
2. Ask for your name (optional — shows as “*Your name*’s Artha”).
3. Pull the image (first time is a one-off ~600 MB download).
4. Start Artha and wait until it’s healthy.

When it finishes you’ll see:

```
✅ Artha is running → http://localhost:9999
```

> Want a different port, or to preset your name without the prompt? Set an env
> var first — `ARTHA_PORT=8080 ARTHA_OWNER=Bharath ./artha.sh install`
> (macOS/Linux), or `set ARTHA_PORT=8080` then `artha.bat install` (Windows).

---

## Step 3 — First run (in the browser)

1. Open **http://localhost:9999**.
2. Choose **“Use my own data” (Personal)** — that’s your real, private dashboard.
   (The **Demo** card is a throwaway sample you can explore first.)
3. Go to **Settings → Personalize** and enter your name → the app becomes
   **“*Your name*’s Artha”** in the sidebar and browser tab.

That’s it — Artha is ready. Add investments, taxes, etc. whenever you like.
There’s a full in-app guide at **http://localhost:9999/help** (or the
**Help & Guide** link at the bottom of the sidebar).

---

## Step 4 — Telegram notifications (optional, ~2 min)

Get your **daily digest** and **alerts** delivered to Telegram.

1. In Telegram, open **[@BotFather](https://t.me/BotFather)** and send `/newbot`.
   Give it a name and a username ending in `bot`. BotFather replies with a
   **token** like `8123456789:AAH…`.
   > Use a **new, dedicated** bot — don’t reuse a bot that’s wired to something
   > else, or pairing won’t work.
2. In Artha, go to **Settings → Telegram notifications**, paste the **token**, and **Save**.
3. Click **Connect Telegram**, tap the link (or send `/start <code>` to your bot),
   and press **Start**. The bot replies **“✅ Connected to Artha.”**

Done — the morning digest and your alerts now arrive in that chat. Set up alert
rules under **Alerts** in the sidebar.

---

## Step 5 — AI nutrition estimates (optional)

Only if you use the **Transformation tracker** and want meals auto-estimated for
calories/protein:

1. Get an API key at **<https://platform.openai.com/api-keys>** (pay-as-you-go;
   the model used is very cheap — pennies/month).
2. In Artha, **Settings → AI nutrition estimates**, paste the `sk-…` key, **Save**.

Without a key the tracker still works — only the automatic nutrition number is skipped.

---

## Step 6 — Optional modules

Off by default to keep the sidebar focused. Turn on what you need under
**Settings → Optional modules**:

- **Transformation tracker** — daily habits, weight, meals, journal (100-day reset).
- **GST / business billing** — sales/purchase invoices, GSTR-1/3B, customers, vendors.

---

## Everyday use

```bash
./artha.sh status      # is it running?
./artha.sh stop        # stop (your data is kept)
./artha.sh start       # start again
./artha.sh logs        # watch the logs (Ctrl-C to exit)
```

Artha also **auto-starts** when Docker starts (e.g. after a reboot).

## Update to the latest version

```bash
./artha.sh update      # pulls the newest image, recreates the container
```

**Your data is safe across updates.** It lives in the `artha-data` volume, which
the update keeps. The new version applies any schema changes (migrations) forward
over your existing data. As a safety net, **every update auto-snapshots the
database first** (kept in the volume under `/data/backups/`, last 7) — so a bad
update can be rolled back:

```bash
./artha.sh backups                 # list snapshots
./artha.sh restore <dump-file>     # roll back (type RESTORE to confirm)
```

## Back up your data

```bash
./artha.sh backup      # writes a DB dump to ~/artha-backups/
```

You can also export everything from inside the app: **Settings → Data
portability → Download JSON**. Keep a copy of either before big changes.

## Uninstall

```bash
./artha.sh uninstall              # removes the app; KEEPS your data
docker volume rm artha-data       # only if you also want to delete your data (irreversible)
```

---

## Troubleshooting

- **“Docker is not running”** — open Docker Desktop (macOS/Windows) or
  `sudo systemctl start docker` (Linux), then retry.
- **Port 9999 already in use** — pick another: `ARTHA_PORT=8080 ./artha.sh install`
  (macOS/Linux) or `set ARTHA_PORT=8080` then `artha.bat install` (Windows).
- **Browser can’t reach it** — give it a few seconds after install; check
  `./artha.sh status` shows “Up”, and `./artha.sh logs` for errors.
- **Telegram says nothing arrives** — make sure you used a **new** BotFather bot,
  saved its token in Settings, and pressed **Start** in the chat.

## Notes

- **Your data lives only on this machine**, inside the Docker volume `artha-data`
  (database, uploaded files, and your settings/secrets). Nothing is sent anywhere
  except the market-data/news/Telegram calls Artha makes on your behalf.
- Artha binds to **localhost** by default (this machine only). To reach it from
  other devices you’d put it behind a reverse proxy with HTTPS and set
  `AUTH_URL` accordingly — beyond this quick-start.
- Currency and tax rules are **India-first** (INR, GST, ITR).
