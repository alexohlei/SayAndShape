#!/usr/bin/env bash
# Usage: prompt-filter.sh "transcript text"
# Exit 0: safe. Exit 1: blocked (prints reason).

TRANSCRIPT="${1}"
T=$(echo "$TRANSCRIPT" | tr '[:upper:]' '[:lower:]')

# Patterns that indicate destructive or information-leaking intent. They are matched against what a
# person typed in any language: "passw" catches English "password" as well as German "Passwort"/"Passwörter".
BLOCKED=(
    "drop table" "drop database" "truncate" "alter table" "delete from"
    "rm -rf" "rm -r /" "unlink" "chmod 777"
    "\.\.\/" '\$\(' 'eval ' "passthru" "proc_open"
    "passw" "auth_key" "private_key" "secret"
)

ENGINE_DIR="$(dirname "$0")/../.."
CONFIG="$ENGINE_DIR/config/apps.json"
APP_EXTRA=()
if [ -n "${APP_ID:-}" ] && [ -f "$CONFIG" ]; then
    # No mapfile: macOS ships bash 3.2.
    while IFS= read -r line; do
        [ -n "$line" ] && APP_EXTRA+=("$line")
    done < <(jq -r ".apps.\"$APP_ID\".extra_blocked_patterns[]? // empty" "$CONFIG" 2>/dev/null)
fi

for pat in "${BLOCKED[@]}" ${APP_EXTRA[@]+"${APP_EXTRA[@]}"}; do
    if echo "$T" | grep -qiE "$pat"; then
        echo "BLOCKED: matched pattern '$pat'"
        exit 1
    fi
done

exit 0
