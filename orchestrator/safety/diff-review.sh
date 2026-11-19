#!/usr/bin/env bash
# Read-only review; the worker discards rejected workspaces.
exec python3 "$(dirname "$0")/diff_review.py" "$@"
