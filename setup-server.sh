#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.claude-runner.server"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="${AGENTS_DIR}/${LABEL}.plist"
LOG_DIR="$HOME/.claude-runner"

# --- Argument parsing ---
UNINSTALL=false
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=true ;;
    *) echo "Usage: setup-server.sh [--uninstall]"; exit 1 ;;
  esac
done

# --- Uninstall ---
if [ "$UNINSTALL" = true ]; then
  echo "Uninstalling ${LABEL}..."
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST_FILE"
  echo "Done. Service removed."
  exit 0
fi

# --- Detect bun ---
BUN_PATH="$(which bun 2>/dev/null || true)"
if [ -z "$BUN_PATH" ]; then
  echo "Error: bun not found in PATH. Install it from https://bun.sh"
  exit 1
fi

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

# --- Install dependencies & build frontend ---
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
bun install

echo "Building web frontend..."
bun run --cwd web build

# --- Unload existing if present ---
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

# --- Generate and install plist ---
cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUN_PATH}</string>
        <string>run</string>
        <string>${SCRIPT_DIR}/server/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/server.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/server.stderr.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"

echo "Installed ${LABEL}"
echo "  Plist: ${PLIST_FILE}"
echo "  Logs:  ${LOG_DIR}/server.{stdout,stderr}.log"
echo ""
echo "Manage with:"
echo "  launchctl kickstart -k gui/$(id -u)/${LABEL}   # restart"
echo "  launchctl bootout gui/$(id -u)/${LABEL}        # stop"
echo "  ./setup-server.sh --uninstall                   # remove"
