#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.yaml"
CONFIG_LOCAL="${SCRIPT_DIR}/config.local.yaml"
JOBS_DIR="${SCRIPT_DIR}/jobs"
JOBS_LOCAL_DIR="${SCRIPT_DIR}/jobs.local"

STATE_DIR="$HOME/.claude-runner"
LOG_DIR="$STATE_DIR/logs"
LOCK_DIR="$STATE_DIR/locks"
STATE_FILE="$STATE_DIR/state.json"

mkdir -p "$LOG_DIR" "$LOCK_DIR"

# --- Config loading via bun + js-yaml ---

cfg() {
  local key="$1"
  bun -e "
    const y = require('js-yaml');
    const fs = require('fs');
    const base = y.load(fs.readFileSync('${CONFIG_FILE}', 'utf8')) || {};
    let local = {};
    try { local = y.load(fs.readFileSync('${CONFIG_LOCAL}', 'utf8')) || {}; } catch {}
    const merged = { ...base, ...local };
    const val = merged['${key}'];
    if (val !== undefined && val !== null) process.stdout.write(String(val));
  "
}

load_job() {
  local job_file="$1"
  local key="$2"
  bun -e "
    const y = require('js-yaml');
    const fs = require('fs');
    const c = y.load(fs.readFileSync('${job_file}', 'utf8')) || {};
    const val = c['${key}'];
    if (val !== undefined && val !== null) process.stdout.write(String(val));
  "
}

# --- Structured logging ---

log() {
  local level="$1"
  shift
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${level}] $*" | tee -a "$LOG_FILE"
}

# --- Argument parsing ---

JOB_NAME=""
PROMPT=""
INLINE=false

if [ $# -eq 0 ]; then
  echo "Usage: runner.sh <job-name> | runner.sh --prompt \"...\""
  exit 1
fi

if [ "$1" = "--prompt" ]; then
  shift
  PROMPT="$*"
  JOB_NAME="adhoc"
  INLINE=true
else
  JOB_NAME="$1"
  JOB_FILE="${JOBS_LOCAL_DIR}/${JOB_NAME}.yaml"
  if [ ! -f "$JOB_FILE" ]; then
    JOB_FILE="${JOBS_DIR}/${JOB_NAME}.yaml"
  fi
  if [ ! -f "$JOB_FILE" ]; then
    echo "Job not found: ${JOB_NAME}"
    exit 1
  fi
fi

# --- Setup run ID and log file ---

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_ID="${JOB_NAME}-${TIMESTAMP}"
LOG_FILE="${LOG_DIR}/${RUN_ID}.log"

# --- Load config values ---

CLAUDE_BINARY="$(cfg claude_binary)"
CLAUDE_BINARY="${CLAUDE_BINARY:-claude}"
DEFAULT_WORKDIR="$(cfg default_workdir)"
DEFAULT_WORKDIR="${DEFAULT_WORKDIR/#\~/$HOME}"
NTFY_SERVER="$(cfg ntfy_server)"
NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
NTFY_TOPIC="$(cfg ntfy_topic)"

# --- Load job-specific values (if named job) ---

JOB_RETRIES=0
JOB_TIMEOUT=""
JOB_NOTIFY="true"
JOB_WORKDIR="$DEFAULT_WORKDIR"

if [ "$INLINE" = false ]; then
  PROMPT="$(load_job "$JOB_FILE" prompt)"
  JOB_RETRIES="$(load_job "$JOB_FILE" retries)"
  JOB_RETRIES="${JOB_RETRIES:-0}"
  JOB_TIMEOUT="$(load_job "$JOB_FILE" timeout)"
  JOB_NOTIFY="$(load_job "$JOB_FILE" notify)"
  JOB_NOTIFY="${JOB_NOTIFY:-true}"
  JOB_WORKDIR_RAW="$(load_job "$JOB_FILE" workdir)"
  if [ -n "$JOB_WORKDIR_RAW" ]; then
    JOB_WORKDIR="${JOB_WORKDIR_RAW/#\~/$HOME}"
  fi

  # Safety net: skip disabled jobs (schedule should already be removed)
  JOB_ENABLED="$(load_job "$JOB_FILE" enabled)"
  if [ "$JOB_ENABLED" = "false" ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [WARN] Job ${JOB_NAME} is paused (enabled: false). Exiting."
    exit 0
  fi
fi

# --- Lockfile (prevent concurrent same-job runs) ---

LOCKFILE="${LOCK_DIR}/${JOB_NAME}.lock"

PIDFILE="${LOCK_DIR}/${JOB_NAME}.pid"

acquire_lock() {
  if mkdir "$LOCKFILE" 2>/dev/null; then
    echo $$ > "$PIDFILE"
    trap 'rm -rf "$LOCKFILE" "$PIDFILE"' EXIT
    return 0
  else
    return 1
  fi
}

if ! acquire_lock; then
  log "WARN" "Job ${JOB_NAME} is already running (lockfile exists). Exiting."
  exit 2
fi

# --- Unset nested session guard ---
unset CLAUDECODE

# --- Export env vars defined in job YAML (values are looked up from config) ---

if [ "$INLINE" = false ]; then
  ENV_KEYS="$(bun -e "
    const y = require('js-yaml');
    const fs = require('fs');
    const c = y.load(fs.readFileSync('${JOB_FILE}', 'utf8')) || {};
    if (c.env && typeof c.env === 'object') {
      for (const [k, v] of Object.entries(c.env)) {
        process.stdout.write(k + '=' + v + '\n');
      }
    }
  ")"
  while IFS='=' read -r env_name config_key; do
    [ -z "$env_name" ] && continue
    env_val="$(cfg "$config_key")"
    if [ -n "$env_val" ]; then
      export "$env_name=$env_val"
      log "INFO" "Exported env var: ${env_name}"
    fi
  done <<< "$ENV_KEYS"
fi

# --- Build claude command ---

log "INFO" "Starting job ${JOB_NAME} (run: ${RUN_ID})"
log "INFO" "Workdir: ${JOB_WORKDIR}"

CMD=(
  "$CLAUDE_BINARY"
  -p "$PROMPT"
  --dangerously-skip-permissions
  --output-format text
)


# --- Execute with retries ---

ATTEMPT=0
MAX_RETRIES="$JOB_RETRIES"
EXIT_CODE=1
START_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- Write "running" entry to state.json ---

bun -e "
  const fs = require('fs');
  const stateFile = '${STATE_FILE}';

  let runs = [];
  try { runs = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}

  runs.push({
    runId: '${RUN_ID}',
    jobName: '${JOB_NAME}',
    startedAt: '${START_TIME}',
    status: 'running',
    logFile: '${LOG_FILE}'
  });

  if (runs.length > 100) runs = runs.slice(-100);

  const tmp = stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(runs, null, 2));
  fs.renameSync(tmp, stateFile);
"

while [ "$ATTEMPT" -le "$MAX_RETRIES" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  log "INFO" "Attempt ${ATTEMPT}/$((MAX_RETRIES + 1))"

  # Determine timeout command
  TIMEOUT_CMD=""
  if [ -n "$JOB_TIMEOUT" ]; then
    if command -v gtimeout &>/dev/null; then
      TIMEOUT_CMD="gtimeout ${JOB_TIMEOUT}"
    elif command -v timeout &>/dev/null; then
      TIMEOUT_CMD="timeout ${JOB_TIMEOUT}"
    fi
  fi

  log "INFO" "Running claude..."
  set +e
  if [ -n "$TIMEOUT_CMD" ]; then
    (cd "$JOB_WORKDIR" && $TIMEOUT_CMD "${CMD[@]}") >> "$LOG_FILE" 2>&1
  else
    (cd "$JOB_WORKDIR" && "${CMD[@]}") >> "$LOG_FILE" 2>&1
  fi
  EXIT_CODE=$?
  set -e

  # Log output size for visibility
  LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null | tr -d ' ')
  log "INFO" "Claude finished (exit ${EXIT_CODE}, log ${LOG_SIZE} bytes)"

  if [ "$EXIT_CODE" -eq 0 ]; then
    log "INFO" "Job ${JOB_NAME} completed successfully"
    break
  else
    log "ERROR" "Job ${JOB_NAME} failed with exit code ${EXIT_CODE}"
    if [ "$ATTEMPT" -le "$MAX_RETRIES" ]; then
      log "INFO" "Retrying in 5 seconds..."
      sleep 5
    fi
  fi
done

END_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- Update state.json ---

bun -e "
  const fs = require('fs');
  const stateFile = '${STATE_FILE}';

  let runs = [];
  try { runs = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}

  // Replace the 'running' entry with the final result
  const idx = runs.findIndex(r => r.runId === '${RUN_ID}');
  const entry = {
    runId: '${RUN_ID}',
    jobName: '${JOB_NAME}',
    startedAt: '${START_TIME}',
    completedAt: '${END_TIME}',
    exitCode: ${EXIT_CODE},
    attempts: ${ATTEMPT},
    logFile: '${LOG_FILE}'
  };
  if (idx >= 0) { runs[idx] = entry; } else { runs.push(entry); }

  // Keep last 100 runs
  if (runs.length > 100) runs = runs.slice(-100);

  const tmp = stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(runs, null, 2));
  fs.renameSync(tmp, stateFile);
"

# --- Notify via ntfy.sh ---

if [ "$JOB_NOTIFY" = "true" ] && [ -n "$NTFY_TOPIC" ]; then
  if [ "$EXIT_CODE" -eq 0 ]; then
    TITLE="claude-runner: ${JOB_NAME} succeeded"
    PRIORITY="default"
    TAGS="white_check_mark"
  else
    TITLE="claude-runner: ${JOB_NAME} failed"
    PRIORITY="high"
    TAGS="x"
  fi

  curl -s \
    -H "Title: ${TITLE}" \
    -H "Priority: ${PRIORITY}" \
    -H "Tags: ${TAGS}" \
    -d "Run: ${RUN_ID}
Exit: ${EXIT_CODE}
Attempts: ${ATTEMPT}/$((MAX_RETRIES + 1))
Log: ${LOG_FILE}" \
    "${NTFY_SERVER}/${NTFY_TOPIC}" > /dev/null 2>&1 || true
fi

log "INFO" "Done (exit code: ${EXIT_CODE})"
exit "$EXIT_CODE"
