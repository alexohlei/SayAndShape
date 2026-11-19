#!/usr/bin/env bash
# Usage: rollback.sh /path/to/clone commit_hash
# Removes ONLY the given commit from history: the change disappears and its log
# entry is gone, while any later changes are kept. No revert commit is created.
set -euo pipefail
CLONE_DIR="${1}"; COMMIT_HASH="${2}"
cd "$CLONE_DIR" || { echo "ERROR: cannot cd to $CLONE_DIR"; exit 1; }

# May run as the web server user (www-data) on a repo owned by the worker user.
# Trust this repo and keep any new files group-writable for the daemon user.
umask 002
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$CLONE_DIR"

# Avoid any editor prompts during the rebase.
export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true

git cat-file -e "${COMMIT_HASH}^{commit}" 2>/dev/null || { echo "ERROR: unknown commit"; exit 1; }

[ -z "$(git status --porcelain)" ] || { echo "ERROR: uncommitted changes"; exit 1; }
git merge-base --is-ancestor "$COMMIT_HASH" HEAD || { echo "ERROR: commit no longer in history"; exit 1; }
git rev-parse --verify "${COMMIT_HASH}^" >/dev/null 2>&1 || { echo "ERROR: cannot remove initial clone"; exit 1; }
HEAD_HASH=$(git rev-parse HEAD)
FULL=$(git rev-parse "${COMMIT_HASH}")

if [ "$FULL" = "$HEAD_HASH" ]; then
  # Latest change → just move back to its parent.
  git reset --hard "${COMMIT_HASH}^" >/dev/null 2>&1 \
    || { echo "ERROR: reset failed"; exit 1; }
  echo "REVERTED: $(git rev-parse HEAD)"
else
  # Middle change → replay later commits onto this commit's parent, dropping it.
  if git rebase --onto "${COMMIT_HASH}^" "${COMMIT_HASH}" --empty=drop >/dev/null 2>&1; then
    echo "REVERTED: $(git rev-parse HEAD)"
  else
    git rebase --abort >/dev/null 2>&1 || true
    echo "ERROR: could not drop commit (conflict with a later change)"
    exit 1
  fi
fi
