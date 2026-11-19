#!/usr/bin/env bash
# Usage: commit.sh /path/to/clone "commit message"
set -euo pipefail
CLONE_DIR="${1}"; MESSAGE="${2}"
cd "$CLONE_DIR" || { echo "ERROR: cannot cd to $CLONE_DIR"; exit 1; }
git add -A
git commit -m "$MESSAGE" --author="SayAndShape <sayandshape@local>" -q \
  && echo "COMMITTED: $(git rev-parse HEAD)" \
  || { echo "ERROR: git commit failed"; exit 1; }
