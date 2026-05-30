#!/usr/bin/env bash
# install.sh — one-shot bootstrap for a fresh machine (or after wiping LaunchAgents).
#
# Run from the repo root:
#   ./scripts/install.sh
#
# What it does:
#   1. npm install + npm run build
#   2. Generates LaunchAgent plists with the current $HOME and project path
#   3. Loads each plist with launchctl bootstrap
#   4. Installs the daily-digest cron line if not already there
#   5. Reminds you to populate .env.local
#
# Idempotent — safe to re-run.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
UID_NUMBER="$(id -u)"

cd "$PROJECT_DIR"

echo "→ project: $PROJECT_DIR"
echo "→ launchd: $LAUNCHD_DIR"

# 1. Dependencies + build
if [ ! -d node_modules ]; then
  echo "→ npm install"
  npm install
fi
echo "→ npm run build"
npm run build >/dev/null 2>&1 || { echo "✗ Build failed — fix errors before continuing"; exit 1; }

# 2. .env.local check
if [ ! -f .env.local ]; then
  cat <<EOF

⚠  .env.local is missing. Create it before starting the service:

    cat > .env.local <<'ENV'
    FINANCE_PASSWORD=<set a strong password>
    FINANCE_SECRET=<32+ random chars for HMAC>
    TELEGRAM_BOT_TOKEN=<bot token from @BotFather>
    TELEGRAM_CHAT_ID=<your chat id>
    OPENAI_API_KEY=<sk-...>
    ENV

Then re-run this script.
EOF
fi

mkdir -p "$LAUNCHD_DIR" "$PROJECT_DIR/logs"

# 3. Write LaunchAgent plists with current paths interpolated.
write_plist() {
  local LABEL="$1"
  local PLIST="$2"
  local PATH_TO_PLIST="$LAUNCHD_DIR/$LABEL.plist"
  echo "→ writing $PATH_TO_PLIST"
  printf '%s' "$PLIST" > "$PATH_TO_PLIST"
}

# Service on port 9999 (always running, restarts on failure).
# Secrets come from .env.local (app) + .env (LLM keys) — both are loaded
# automatically by `next start`. NEVER inline secrets here.
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
write_plist "com.bharath.finance-dashboard" "$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.bharath.finance-dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>node_modules/.bin/next</string>
        <string>start</string>
        <string>-p</string>
        <string>9999</string>
    </array>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$PROJECT_DIR/logs/service.log</string>
    <key>StandardErrorPath</key><string>$PROJECT_DIR/logs/service-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>NODE_ENV</key><string>production</string>
    </dict>
</dict>
</plist>
EOF
)"

# Rolling DB backup, daily 8 AM
write_plist "com.bharath.finance-backup" "$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.bharath.finance-backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$PROJECT_DIR/scripts/backup-db.sh</string>
    </array>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>$PROJECT_DIR/logs/backup-launchd.log</string>
    <key>StandardErrorPath</key><string>$PROJECT_DIR/logs/backup-launchd-error.log</string>
</dict>
</plist>
EOF
)"

# Daily digest (refresh prices + send to Telegram), 8:30 AM
write_plist "com.bharath.daily-digest" "$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.bharath.daily-digest</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$PROJECT_DIR/scripts/daily-digest-telegram.sh</string>
    </array>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>30</integer></dict>
    <key>StandardOutPath</key><string>$PROJECT_DIR/logs/daily-digest-launchd.log</string>
    <key>StandardErrorPath</key><string>$PROJECT_DIR/logs/daily-digest-launchd.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF
)"

# Alert checker — 5x daily during market hours (IST 9:15/11:15/13:15/15:15/18:00)
write_plist "com.bharath.alert-checker" "$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.bharath.alert-checker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>node</string>
        <string>$PROJECT_DIR/scripts/check-alerts.mjs</string>
    </array>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>15</integer></dict>
        <dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>15</integer></dict>
        <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>15</integer></dict>
        <dict><key>Hour</key><integer>15</integer><key>Minute</key><integer>15</integer></dict>
        <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
    </array>
    <key>StandardOutPath</key><string>$PROJECT_DIR/logs/check-alerts.log</string>
    <key>StandardErrorPath</key><string>$PROJECT_DIR/logs/check-alerts.log</string>
</dict>
</plist>
EOF
)"

# SIP auto-execute — daily 9 AM
write_plist "com.bharath.sip-auto-execute" "$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.bharath.sip-auto-execute</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$PROJECT_DIR/scripts/sip-auto-execute.sh</string>
    </array>
    <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>$PROJECT_DIR/logs/sip-auto-execute.log</string>
    <key>StandardErrorPath</key><string>$PROJECT_DIR/logs/sip-auto-execute.log</string>
</dict>
</plist>
EOF
)"

# 4. Load (or reload) each agent
for label in finance-dashboard finance-backup daily-digest alert-checker sip-auto-execute; do
  full="com.bharath.$label"
  plist="$LAUNCHD_DIR/$full.plist"
  echo "→ launchctl reloading $full"
  launchctl bootout "gui/$UID_NUMBER/$full" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUMBER" "$plist"
done

echo ""
echo "✓ All LaunchAgents installed and loaded."
echo "  Service:           http://localhost:9999"
echo "  Logs:              $PROJECT_DIR/logs/"
echo "  Rolling backups:   $PROJECT_DIR/backups/"
echo ""
echo "Next steps if this is a fresh machine:"
echo "  • If you have a backup tarball, run: ./scripts/restore-all.sh <tarball>"
echo "  • Otherwise the DB ships from git as the current snapshot."
echo "  • Verify: open http://localhost:9999 and log in."
