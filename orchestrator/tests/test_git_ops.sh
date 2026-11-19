#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMMIT_SH="$SCRIPT_DIR/../git/commit.sh"
ROLLBACK_SH="$SCRIPT_DIR/../git/rollback.sh"
PASS=0; FAIL=0; TMP=$(mktemp -d)

REPO="$TMP/repo"; mkdir "$REPO"; cd "$REPO"
git init -q; git config user.email "t@t.com"; git config user.name "T"
echo "hello" > f.txt
git add -A; git commit -q -m "init" --author="T <t@t>"

echo "=== Git Ops Tests ==="

# commit.sh creates a commit
echo "changed" > "$REPO/f.txt"
OUT=$(bash "$COMMIT_SH" "$REPO" "test message")
echo "$OUT" | grep -q "COMMITTED:"
if [ $? -eq 0 ]; then echo "  PASS: commit returns COMMITTED:"; ((PASS++)); else echo "  FAIL: no COMMITTED: in output ($OUT)"; ((FAIL++)); fi

# commit message stored in log
MSG=$(cd "$REPO" && git log --format="%s" -1)
if [ "$MSG" = "test message" ]; then echo "  PASS: commit message correct"; ((PASS++)); else echo "  FAIL: wrong message: '$MSG'"; ((FAIL++)); fi

# rollback.sh reverts the commit
HASH=$(cd "$REPO" && git rev-parse HEAD)
echo "second" > "$REPO/g.txt"; bash "$COMMIT_SH" "$REPO" "second" >/dev/null
OUT=$(bash "$ROLLBACK_SH" "$REPO" "$HASH")
echo "$OUT" | grep -q "REVERTED:"
if [ $? -eq 0 ]; then echo "  PASS: rollback returns REVERTED:"; ((PASS++)); else echo "  FAIL: no REVERTED: in output ($OUT)"; ((FAIL++)); fi

# file content restored
CONTENT=$(cat "$REPO/f.txt")
if [ "$CONTENT" = "hello" ] && [ "$(cat "$REPO/g.txt")" = "second" ]; then echo "  PASS: file restored after rollback"; ((PASS++)); else echo "  FAIL: file content wrong: '$CONTENT'"; ((FAIL++)); fi

rm -rf "$TMP"
echo ""; echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
