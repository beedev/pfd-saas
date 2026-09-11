# Artha — Desktop app (macOS)

Artha is a self-contained personal-finance app. Everything runs on your own Mac —
the database is embedded, so there's no server to set up and no cloud account. Your
data never leaves the machine.

> **Apple Silicon (M-series) only.** This build does not run on Intel Macs.

---

## Install

You have the disk image **`Artha-<version>-arm64.dmg`**. Open it (double-click), and
you'll see **Artha**, an **Applications** shortcut, and **`Install Artha.command`**.

### Simplest (most reliable): drag to Applications

1. Drag **Artha** onto the **Applications** shortcut.
2. First launch only: **right-click** Artha in Applications → **Open** → **Open**.
   (Needed once because the app isn't signed with an Apple Developer ID.)
3. To bring in your data, use **Import from backup** (below). For always-on, see the
   Always-on section.

### Or use the installer (does the above + offers always-on)

1. Double-click **`Install Artha.command`**.
   - If macOS says it's from an unidentified developer: **right-click** it → **Open**
     → **Open**.
   - **If double-clicking does nothing or shows an error** (this happens when the
     file lost its "executable" flag during transfer): open **Terminal**
     (Applications → Utilities), type `sh ` (with a trailing space), then **drag the
     `Install Artha.command` file into the Terminal window** and press **Return**.
2. It copies Artha to Applications, removes the security block, and asks whether you
   want **always-on**. Then it launches Artha.

---

## First run — load your data

The app starts empty. To bring in your data:

1. Pick an account on the login screen.
2. In the sidebar, choose **Import from backup**.
3. Select your database backup — a PostgreSQL dump, either `.sql` or `.sql.gz`
   (for example, produced with
   `pg_dump "$DATABASE_URL" --no-owner --no-privileges --inserts`).
4. After import you'll be asked to sign in again — that's expected.

---

## Always-on (optional)

By default Artha runs only when you open it. If you want it to **start at login and
keep running** (so scheduled tasks and the analyst keep working), enable **always-on**:

- The installer asks you — answer **y**.
- Behaviour: it starts when you log in, and if it ever crashes it restarts itself.
  A normal **Quit (⌘Q)** still quits it and it stays quit until you reopen it.
- Closing the **window** does *not* stop Artha — it keeps running in the background.
  Click its Dock icon to bring the window back.

**Turn it off later:**

```bash
launchctl unload ~/Library/LaunchAgents/com.bharath.artha.plist
```

**Turn it back on:**

```bash
launchctl load ~/Library/LaunchAgents/com.bharath.artha.plist
```

---

## Backups

Artha backs up its own database automatically to **`~/Documents/Artha Backups`**
(roughly twice a day; the most recent 14 are kept). Each file is a compressed,
restorable dump — you can re-import any of them with **Import from backup** above, or
copy them somewhere safe.

---

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.bharath.artha.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.bharath.artha.plist
rm -rf /Applications/Artha.app
```

Your data and backups are kept unless you also remove them:

```bash
rm -rf ~/Library/Application\ Support/pfd-saas   # the live database
rm -rf ~/Documents/Artha\ Backups                # the backups (optional)
```

---

## Troubleshooting

- **"Artha is damaged and can't be opened."** macOS quarantine. Run:
  `xattr -dr com.apple.quarantine /Applications/Artha.app` — then open it.
- **Nothing opens / blank window.** Check the logs:
  `~/Library/Logs/Artha-out.log` and `~/Library/Logs/Artha-err.log`.
- **It won't stay closed.** If always-on is on, a crash restarts it. To stop it
  entirely, unload the LaunchAgent (see above), then Quit.
