#!/usr/bin/env bash
# =============================================================================
# verify-rbac-fail-open.sh — guards CX-R13-01 (RBAC fails-open-to-admin).
#
# Background: when RBAC_ENABLED is unset/wrong, isRbacEnabled() returns false.
# requireSession() previously returned DEFAULT_OPERATOR (admin) to ANY source
# IP. A typo on .env.local would silently turn the dashboard into an
# unauthenticated public admin console.
#
# Fix at src/lib/rbac/guard.ts: the RBAC-off branch now gates DEFAULT_OPERATOR
# behind requireLocalhost(request). Non-localhost callers get 403 even when
# RBAC is off.
#
# This script drives requireSession() through tsx with two fake requests:
# one from 127.0.0.1 (must return operator), one from 203.0.113.7 (must
# return a 403 NextResponse).
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Ensure RBAC is OFF for this test so the localhost gate is the only thing
# between a remote caller and admin access.
unset RBAC_ENABLED
export NODE_ENV=production

OUTPUT="$(cd "$REPO_ROOT" && npx --no-install tsx --eval "
import { requireSession } from './src/lib/rbac/guard';

function fakeRequest(ip: string): any {
  return {
    ip,
    method: 'GET',
    cookies: { get: () => undefined },
    headers: { get: () => null },
  };
}

const localOK = requireSession(fakeRequest('127.0.0.1') as any);
const localHasOperator = typeof localOK === 'object' && 'operator' in localOK;

const remoteDenied = requireSession(fakeRequest('203.0.113.7') as any);
// NextResponse exposes a numeric \`status\` field
const remoteStatus = (remoteDenied && typeof remoteDenied === 'object' && 'status' in remoteDenied)
  ? (remoteDenied as { status: number }).status
  : 0;

console.log(JSON.stringify({
  rbac_off_localhost_grants_admin: localHasOperator,
  rbac_off_remote_blocked: remoteStatus === 403,
  remote_status: remoteStatus,
}));
" 2>&1)"

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q '"rbac_off_localhost_grants_admin":true' \
   && echo "$OUTPUT" | grep -q '"rbac_off_remote_blocked":true'; then
  echo "PASS — RBAC-off mode is localhost-only; remote requests get 403"
  exit 0
fi

echo "FAIL — RBAC-off mode is fail-open to remote IPs"
exit 1
