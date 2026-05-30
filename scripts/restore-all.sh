#!/usr/bin/env bash
# restore-all.sh — restore a bundle produced by backup-all.sh onto a fresh
# clone. Stops the service, swaps the DB + secrets, then restarts.
#
# Usage:
#   ./scripts/restore-all.sh ~/Downloads/finance-bundle-2026-05-22-220000.tar.gz

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <bundle.tar.gz>"
  exit 1
fi
BUNDLE="$1"
if [ ! -f "$BUNDLE" ]; then
  echo "✗ Bundle not found: $BUNDLE"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "→ Stopping service (if running)…"
launchctl bootout "gui/$(id -u)/com.bharath.finance-dashboard" 2>/dev/null || true

# Move existing DB aside for safety before overwriting
if [ -f personal-finance.db ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  mv personal-finance.db "personal-finance.db.pre-restore-$STAMP"
  echo "→ Existing DB saved as personal-finance.db.pre-restore-$STAMP"
fi
rm -f personal-finance.db-shm personal-finance.db-wal

echo "→ Extracting $BUNDLE"
tar -xzf "$BUNDLE" -C "$PROJECT_DIR"

# Restart via launchctl bootstrap (re-uses the existing plist).
PLIST="$HOME/Library/LaunchAgents/com.bharath.finance-dashboard.plist"
if [ -f "$PLIST" ]; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  echo "→ Service restarted"
else
  echo "⚠  LaunchAgent plist not found at $PLIST"
  echo "   Run ./scripts/install.sh to install it."
fi

echo ""
echo "✓ Restore complete. Verify at http://localhost:9999"
