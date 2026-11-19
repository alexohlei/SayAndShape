#!/usr/bin/env bash
# Usage: reset.sh /path/to/clone
# Reset to the most recently established baseline (initial clone if none was set).
# Archived history and baseline metadata are preserved.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLONE_DIR="${1}"
cd "$CLONE_DIR" || { echo "ERROR: cannot cd to $CLONE_DIR"; exit 1; }

# May run as the web server user (www-data) on a repo owned by the worker user.
# Trust this repo and keep any new files group-writable for the daemon user.
umask 002
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$CLONE_DIR"

ROOT=$(python3 "$SCRIPT_DIR/../repo_state.py" "$CLONE_DIR")
if [ -z "$ROOT" ]; then
  echo "ERROR: no root commit found"
  exit 1
fi

git reset --hard "$ROOT" >/dev/null 2>&1 || { echo "ERROR: reset failed"; exit 1; }
git clean -fd >/dev/null 2>&1 || true
echo "RESET: $ROOT"
