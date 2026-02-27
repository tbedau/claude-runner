#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JOBS_DIR="${SCRIPT_DIR}/jobs"
SETUP="${SCRIPT_DIR}/setup.sh"

# --- Argument parsing ---

SETUP_ARGS=()
JOB_NAME=""

for arg in "$@"; do
  case "$arg" in
    --no-wake) SETUP_ARGS+=("$arg") ;;
    -*)        echo "Unknown flag: $arg"; exit 1 ;;
    *)
      if [ -z "$JOB_NAME" ]; then
        JOB_NAME="$arg"
      else
        echo "Error: unexpected argument: $arg"
        exit 1
      fi
      ;;
  esac
done

if [ -z "$JOB_NAME" ]; then
  echo "Usage: delete-job.sh <job-name> [--no-wake]"
  echo ""
  echo "Available jobs:"
  for f in "$JOBS_DIR"/*.yaml; do
    [ -f "$f" ] || continue
    echo "  $(basename "$f" .yaml)"
  done
  exit 1
fi

JOB_FILE="${JOBS_DIR}/${JOB_NAME}.yaml"

# --- Validate job exists ---

if [ ! -f "$JOB_FILE" ]; then
  echo "Error: Job not found: ${JOB_NAME}"
  echo "File does not exist: ${JOB_FILE}"
  exit 1
fi

# --- Confirmation prompt ---

echo "This will delete job '${JOB_NAME}' and remove its launchd schedule."
read -r -p "Are you sure? [y/N] " REPLY
if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
  echo "Cancelled."
  exit 0
fi

# --- Delete the YAML file ---

rm "$JOB_FILE"
echo "Deleted: ${JOB_FILE}"

# --- Re-run setup.sh to sync launchd schedules ---

echo ""
echo "Re-syncing schedules..."
"$SETUP" "${SETUP_ARGS[@]+"${SETUP_ARGS[@]}"}"

echo ""
echo "Job '${JOB_NAME}' has been deleted."
