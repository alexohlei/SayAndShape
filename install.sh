#!/usr/bin/env bash
# SayAndShape installer: fetches the engine and prepares it. Safe to run again (updates an existing checkout).
#
#   bash install.sh [--dir DIR] [--repo OWNER/NAME|GIT_URL] [--ref TAG_OR_BRANCH]
#
# The repository may be private: the script tries the GitHub CLI (gh), then HTTPS with the
# machine's stored Git credentials, then SSH. Afterwards connect a project with
#   DIR/bin/sayandshape add /path/to/project
set -euo pipefail

REPO="${SAYANDSHAPE_REPO:-alexohlei/SayAndShape}"
DIR="${SAYANDSHAPE_DIR:-$HOME/SayAndShape}"
REF=""

while [ $# -gt 0 ]; do
    case "$1" in
        --dir)  DIR="$2"; shift 2 ;;
        --repo) REPO="$2"; shift 2 ;;
        --ref)  REF="$2"; shift 2 ;;
        -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

fail() { echo "SayAndShape install: $*" >&2; exit 1; }
for tool in git php python3; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required but was not found"
done
php -r 'exit(PHP_VERSION_ID >= 80100 ? 0 : 1);' || fail "PHP 8.1 or newer is required (found $(php -r 'echo PHP_VERSION;'))"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || fail "Python 3.9 or newer is required"

export GIT_TERMINAL_PROMPT=0
if [ -d "$DIR/.git" ]; then
    echo "Updating existing checkout in $DIR"
    git -C "$DIR" pull --ff-only || fail "could not update $DIR (local changes or no repository access)"
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    fail "$DIR exists and is not a SayAndShape checkout; choose another --dir"
else
    mkdir -p "$(dirname "$DIR")"
    echo "Fetching $REPO into $DIR"
    if [[ "$REPO" == *:* || "$REPO" == /* || "$REPO" == .* ]]; then
        # A full Git URL or a local path (mirror, fork, other host).
        git clone --quiet "$REPO" "$DIR" || fail "could not clone $REPO"
    elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && gh repo clone "$REPO" "$DIR" -- --quiet; then :
    elif git clone --quiet "https://github.com/$REPO.git" "$DIR" 2>/dev/null; then :
    elif git clone --quiet "git@github.com:$REPO.git" "$DIR" 2>/dev/null; then :
    else
        fail "could not clone $REPO. The repository is private: sign in with 'gh auth login' or add an SSH key with access, then run this again."
    fi
fi
if [ -n "$REF" ]; then
    git -C "$DIR" checkout --quiet "$REF" || fail "ref $REF not found"
fi

# init asks which AI agent to use. Piped into bash (… | bash -s), stdin is the script: use the terminal if there is one.
if [ ! -t 0 ] && [ -t 1 ] && (exec </dev/tty) 2>/dev/null; then
    "$DIR/bin/sayandshape" init </dev/tty
else
    "$DIR/bin/sayandshape" init
fi
echo
"$DIR/bin/sayandshape" doctor || true
echo
echo "Next: $DIR/bin/sayandshape add /path/to/project --url https://your-site.example   (see $DIR/INSTALL.md)"
