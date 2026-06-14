#!/usr/bin/env bash
# =============================================================================
# verify-symlink-escape.sh — guards the workspace-reader symlink-escape fix.
#
# Background: a lexical `path.resolve()` + string-prefix check is not enough
# when readFileSync follows symlinks. This test plants a symlink inside an
# allowed workspace pointing at a sensitive file outside it, then asks the
# read function to fetch the link. The fix (realpathContainsSync) must reject
# this; without the fix readFileSync would happily serve the target contents.
#
# Coverage: drives readWorkspaceFile via $OPENCLAW_HOME override. The hermes-
# side fix at readHermesFile is structurally identical (same realpathContainsSync
# call after the same lexical-prefix gate) — covered by code-equivalence, not
# by this script.
#
# Targets: src/lib/services/workspace-reader.ts (readWorkspaceFile)
# Runtime: Node TS via tsx — no live server, no staging host touch.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d -t clawnex-symlink-test-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

# Build a fake OpenClaw home and a secret target outside it.
FAKE_OC="$TMPDIR/.openclaw"
SECRET_OUTSIDE="$TMPDIR/secret-outside.txt"

mkdir -p "$FAKE_OC/workspace"
echo "shhh — sensitive contents that must never leak" > "$SECRET_OUTSIDE"
echo "legit content inside workspace" > "$FAKE_OC/workspace/legit.md"

# Plant the malicious symlink INSIDE the allowed workspace.
ln -s "$SECRET_OUTSIDE" "$FAKE_OC/workspace/pwned.md"

export OPENCLAW_HOME="$FAKE_OC"

OUTPUT="$(cd "$REPO_ROOT" && npx --no-install tsx --eval "
import { readWorkspaceFile } from './src/lib/services/workspace-reader';

const legit  = readWorkspaceFile('legit.md');
const escape = readWorkspaceFile('pwned.md');

const ok = legit && legit.content.includes('legit content');
const blocked = escape === null;

console.log(JSON.stringify({
  legit_read_ok: ok,
  workspace_symlink_blocked: blocked,
}));
" 2>&1)"

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q '"legit_read_ok":true' \
   && echo "$OUTPUT" | grep -q '"workspace_symlink_blocked":true'; then
  echo "PASS — symlink escape blocked at readWorkspaceFile"
  exit 0
fi

echo "FAIL — symlink escape was NOT blocked; the realpathContainsSync guard is bypassed or missing"
exit 1
