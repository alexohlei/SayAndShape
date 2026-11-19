#!/usr/bin/env bash
REVIEW="$(dirname "$0")/../safety/diff-review.sh"
PASS=0; FAIL=0; TMP=$(mktemp -d)

mk_repo() {
    local dir="$TMP/$1"; mkdir -p "$dir"; cd "$dir"
    git init -q; git config user.email "t@t.com"; git config user.name "T"
    echo "body{color:red}" > style.css; echo "<?php echo 1;" > index.php
    git add -A; git commit -q -m "init" --author="T <t@t>"
    echo "$dir"
}

echo "=== Diff Review Tests ==="

R=$(mk_repo "no-changes")
bash "$REVIEW" "$R" >/dev/null 2>&1
if [ $? -eq 0 ]; then echo "  PASS: no changes"; ((PASS++)); else echo "  FAIL: no changes (expected PASS)"; ((FAIL++)); fi

R=$(mk_repo "safe-css"); echo "body{color:blue}" > "$R/style.css"
bash "$REVIEW" "$R" >/dev/null 2>&1
if [ $? -eq 0 ]; then echo "  PASS: safe css change"; ((PASS++)); else echo "  FAIL: safe css change (expected PASS)"; ((FAIL++)); fi

R=$(mk_repo "env-file"); echo "S=1" > "$R/.env"
bash "$REVIEW" "$R" >/dev/null 2>&1
if [ $? -eq 1 ]; then echo "  PASS: env file touched"; ((PASS++)); else echo "  FAIL: env file touched (expected BLOCK)"; ((FAIL++)); fi

R=$(mk_repo "too-many"); for i in $(seq 1 22); do echo x > "$R/f$i.txt"; done
bash "$REVIEW" "$R" >/dev/null 2>&1
if [ $? -eq 1 ]; then echo "  PASS: too many files"; ((PASS++)); else echo "  FAIL: too many files (expected BLOCK)"; ((FAIL++)); fi

rm -rf "$TMP"
echo ""; echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
