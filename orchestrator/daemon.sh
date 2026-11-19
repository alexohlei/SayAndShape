#!/usr/bin/env bash
# Existing systemd/start.command entry point.
exec python3 "$(dirname "$0")/worker.py" "$@"
