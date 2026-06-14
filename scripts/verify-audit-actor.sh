#!/usr/bin/env bash
# =============================================================================
# verify-audit-actor.sh — guards L3 (DAST 2026-05-14).
#
# Previously, DEFAULT_OPERATOR.username was 'admin'. Any audit_log entry
# emitted from an unauthenticated localhost-trust path (RBAC-off direct
# curl) was indistinguishable in the audit table from a real,
# authenticated admin operator's action. Post-incident review couldn't
# tell whether "admin purged the DB" was intentional or an unauth
# direct-curl attack.
#
# Fix: DEFAULT_OPERATOR.username is now 'localhost' (a name no real
# human operator would choose) and displayName captures the
# unauthenticated source. This verifier asserts the rename is in place
# and flags any regression that reverts to 'admin'.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

OUTPUT="$(cd "$REPO_ROOT" && npx --no-install tsx --eval "
// We can't import { DEFAULT_OPERATOR } directly — it's a module-internal
// constant, not exported. Instead, drive getOperatorFromRequest in
// RBAC-off mode with no session cookie. That code path returns the
// default operator, which we then inspect.
import { getOperatorFromRequest } from './src/lib/rbac/guard';
import type { NextRequest } from 'next/server';

// Force RBAC-off for this assertion. The guard module caches the
// computed flag, but for a fresh tsx invocation the env var is read
// at first call.
process.env.RBAC_ENABLED = '';

const fakeRequest = {
  cookies: { get: () => undefined },
  headers: { get: () => null },
} as unknown as NextRequest;

const op = getOperatorFromRequest(fakeRequest);
if (!op) {
  console.log(JSON.stringify({ fail: 'getOperatorFromRequest returned null in RBAC-off mode (expected DEFAULT_OPERATOR)' }));
  process.exit(1);
}

const cases = [
  { label: 'username !== admin (was the leak)',           pass: op.username !== 'admin',                  detail: 'got=' + op.username },
  { label: 'username === localhost',                       pass: op.username === 'localhost',              detail: 'got=' + op.username },
  { label: 'displayName mentions unauthenticated',         pass: /unauth/i.test(op.displayName ?? ''),     detail: 'got=' + op.displayName },
  { label: 'role still admin (permission grant intact)',   pass: op.role === 'admin',                      detail: 'got=' + op.role },
];

console.log(JSON.stringify({
  total: cases.length,
  pass: cases.filter(c => c.pass).length,
  fail: cases.filter(c => !c.pass),
}, null, 2));
" 2>&1)"

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q '"fail": \[\]'; then
  echo "PASS — DEFAULT_OPERATOR.username='localhost' (audit-distinguishable from real admin)"
  exit 0
fi
echo "FAIL — DEFAULT_OPERATOR did not match expected shape"
exit 1
