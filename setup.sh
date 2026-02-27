#!/usr/bin/env bash
set -euo pipefail

# Ensure bun and other tools are on PATH (may be missing when invoked from launchd)
export PATH="/opt/homebrew/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JOBS_DIR="${SCRIPT_DIR}/jobs"
JOBS_LOCAL_DIR="${SCRIPT_DIR}/jobs.local"
RUNNER="${SCRIPT_DIR}/runner.sh"
PLIST_PREFIX="com.claude-runner.job"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.claude-runner"
CRON_MARKER_START="# --- claude-runner jobs start ---"
CRON_MARKER_END="# --- claude-runner jobs end ---"

# --- Argument parsing ---
SKIP_WAKE=false
for arg in "$@"; do
  case "$arg" in
    --no-wake) SKIP_WAKE=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

# --- Remove legacy cron marker block (one-time cleanup) ---
EXISTING_CRONTAB="$(crontab -l 2>/dev/null || true)"
if echo "$EXISTING_CRONTAB" | grep -qF "$CRON_MARKER_START"; then
  echo "Removing legacy cron entries..."
  CLEANED="$(echo "$EXISTING_CRONTAB" | sed "/${CRON_MARKER_START}/,/${CRON_MARKER_END}/d")"
  if [ -z "$(echo "$CLEANED" | tr -d '[:space:]')" ]; then
    crontab -r 2>/dev/null || true
  else
    echo "$CLEANED" | crontab -
  fi
  echo "  Legacy cron block removed."
fi

# --- Build PATH for launchd environment ---
LAUNCHD_PATH="/opt/homebrew/bin:$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# --- Convert cron expression to StartCalendarInterval plist XML ---
# Usage: cron_to_calendar_interval "min hour dom mon dow"
# Outputs <array> of <dict> entries (or single <dict> if no expansion needed)
cron_to_calendar_interval() {
  local cron="$1"
  local min hour dom mon dow
  read -r min hour dom mon dow <<< "$cron"

  # Expand a single cron field: returns space-separated values
  # Handles: number, *, */step, comma-separated, ranges (n-m)
  expand_field() {
    local field="$1" max="$2"
    if [ "$field" = "*" ]; then
      echo "*"
      return
    fi
    if echo "$field" | grep -qE '^\*/[0-9]+$'; then
      local step="${field#*/}"
      local vals=""
      for ((i=0; i<max; i+=step)); do
        vals="$vals $i"
      done
      echo "$vals"
      return
    fi
    # Handle comma-separated (each element may be a range)
    local result=""
    IFS=',' read -ra parts <<< "$field"
    for part in "${parts[@]}"; do
      if echo "$part" | grep -qE '^[0-9]+-[0-9]+$'; then
        local start="${part%-*}"
        local end="${part#*-}"
        for ((i=start; i<=end; i++)); do
          result="$result $i"
        done
      else
        result="$result $part"
      fi
    done
    echo "$result"
  }

  local min_vals hour_vals dom_vals mon_vals dow_vals
  min_vals=$(expand_field "$min" 60)
  hour_vals=$(expand_field "$hour" 24)
  dom_vals=$(expand_field "$dom" 32)
  mon_vals=$(expand_field "$mon" 13)
  dow_vals=$(expand_field "$dow" 7)

  # Generate all combinations as dict entries
  # Each dict has only the non-wildcard keys
  generate_dicts() {
    local mins="$1" hours="$2" doms="$3" mons="$4" dows="$5"
    set -f  # disable glob expansion — field values may be literal "*"

    for m in $mins; do
      for h in $hours; do
        for d in $doms; do
          for mo in $mons; do
            for dw in $dows; do
              echo "      <dict>"
              [ "$m" != "*" ] && echo "        <key>Minute</key><integer>$m</integer>"
              [ "$h" != "*" ] && echo "        <key>Hour</key><integer>$h</integer>"
              [ "$d" != "*" ] && echo "        <key>Day</key><integer>$d</integer>"
              [ "$mo" != "*" ] && echo "        <key>Month</key><integer>$mo</integer>"
              [ "$dw" != "*" ] && echo "        <key>Weekday</key><integer>$dw</integer>"
              echo "      </dict>"
            done
          done
        done
      done
    done
    set +f
  }

  local dicts
  dicts="$(generate_dicts "$min_vals" "$hour_vals" "$dom_vals" "$mon_vals" "$dow_vals")"

  # Count number of dicts
  local count
  count="$(echo "$dicts" | grep -c '<dict>' || true)"

  if [ "$count" -eq 1 ]; then
    # Single dict — use directly (strip leading whitespace for proper nesting)
    echo "$dicts" | sed 's/^      /    /'
  else
    # Multiple dicts — wrap in array
    echo "    <array>"
    echo "$dicts"
    echo "    </array>"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then

# --- Install launchd plists for each scheduled job ---
COUNT=0
INSTALLED_PLISTS=()

# Collect job files from jobs/ and jobs.local/ (local takes precedence)
# Build a newline-separated list of "name|path" pairs; later entries win
JOB_ENTRIES=""
for job_file in "$JOBS_DIR"/*.yaml; do
  [ -f "$job_file" ] || continue
  JOB_ENTRIES="${JOB_ENTRIES}$(basename "$job_file" .yaml)|${job_file}"$'\n'
done
for job_file in "$JOBS_LOCAL_DIR"/*.yaml; do
  [ -f "$job_file" ] || continue
  JOB_ENTRIES="${JOB_ENTRIES}$(basename "$job_file" .yaml)|${job_file}"$'\n'
done

# Deduplicate: later entries (jobs.local/) override earlier ones (jobs/)
JOB_LIST="$(echo "$JOB_ENTRIES" | awk -F'|' 'NF{a[$1]=$2} END{for(k in a) print k"|"a[k]}')"

while IFS='|' read -r JOB_NAME job_file; do
  [ -z "$JOB_NAME" ] && continue

  # Read schedule and enabled fields from YAML (pipe-delimited to avoid splitting cron spaces;
  # pipe is a non-whitespace IFS char so bash won't strip leading empty fields)
  IFS='|' read -r SCHEDULE ENABLED <<< "$(bun -e "
    const y = require('js-yaml');
    const fs = require('fs');
    const c = y.load(fs.readFileSync('${job_file}', 'utf8')) || {};
    const schedule = c.schedule || '';
    const enabled = c.enabled === false ? 'false' : 'true';
    process.stdout.write(schedule + '|' + enabled);
  ")"

  [ -z "$SCHEDULE" ] && continue
  [ "$ENABLED" = "false" ] && continue

  LABEL="${PLIST_PREFIX}.${JOB_NAME}"
  PLIST_FILE="${AGENTS_DIR}/${LABEL}.plist"
  INSTALLED_PLISTS+=("$LABEL")

  # Unload existing plist if loaded
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

  # Generate StartCalendarInterval XML
  CALENDAR_XML="$(cron_to_calendar_interval "$SCHEDULE")"

  # Write plist
  cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER}</string>
    <string>${JOB_NAME}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${LAUNCHD_PATH}</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
  <key>StartCalendarInterval</key>
${CALENDAR_XML}
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd-job-${JOB_NAME}.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd-job-${JOB_NAME}.stderr.log</string>
</dict>
</plist>
PLIST

  # Load the new plist
  launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"

  COUNT=$((COUNT + 1))
  echo "  ${JOB_NAME} -> ${SCHEDULE}"
done <<< "$JOB_LIST"

# --- Clean up stale plists for deleted jobs ---
for plist_file in "$AGENTS_DIR"/${PLIST_PREFIX}.*.plist; do
  [ -f "$plist_file" ] || continue

  LABEL="$(basename "$plist_file" .plist)"

  # Check if this label is in our installed list
  FOUND=false
  for installed in "${INSTALLED_PLISTS[@]+"${INSTALLED_PLISTS[@]}"}"; do
    if [ "$installed" = "$LABEL" ]; then
      FOUND=true
      break
    fi
  done

  if [ "$FOUND" = false ]; then
    echo "  Removing stale plist: ${LABEL}"
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    rm "$plist_file"
  fi
done

echo ""
if [ "$COUNT" -eq 0 ]; then
  echo "No jobs with schedules found."
else
  echo "Installed ${COUNT} launchd job(s). Verify with: launchctl list | grep ${PLIST_PREFIX}"
fi

# --- Set fixed pmset wake for backups (macOS only) ---

if [ "$SKIP_WAKE" = true ]; then
  echo "Skipping pmset wake configuration (--no-wake)."
elif [ "$(uname)" != "Darwin" ]; then
  echo "Skipping pmset wake configuration (not macOS)."
else
  WAKE_TIME="02:00:00"

  echo ""
  echo "Setting Mac wake time: ${WAKE_TIME} (for backups)"
  echo "This requires sudo. Enter your password if prompted."

  if ! sudo pmset repeat wakeorpoweron MTWRFSU "$WAKE_TIME"; then
    echo ""
    echo "Warning: Failed to set pmset wake schedule."
    echo "You can set it manually with:"
    echo "  sudo pmset repeat wakeorpoweron MTWRFSU $WAKE_TIME"
  else
    echo "Wake schedule set. Verify with: pmset -g sched"
  fi
fi

fi # end source guard
