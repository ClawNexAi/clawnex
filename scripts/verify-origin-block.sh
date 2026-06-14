#!/usr/bin/env bash
# =============================================================================
# verify-origin-block.sh — guards P0-A (internal reviewer 2026-05-13 DAST finding).
#
# requireLocalhost() previously only checked source IP, not document origin.
# An attacker page at evil.com (loaded into an operator's browser) could POST
# to /api/system/purge, /api/break-glass/activate, /api/proxy/block-mode, or
# /api/config/defaults — the browser sends the request from 127.0.0.1, so
# the IP check passed, even though the request was *driven* from evil.com.
#
# Fix: requireLocalhost now also runs validateOriginMatch() on mutating
# methods, refusing requests whose Origin (or Referer fallback) host does
# not match the request's own host.
#
# This script drives validateOriginMatch through tsx with the four exact
# attack shapes from the reviewer's DAST plus the must-still-work positive cases,
# and asserts the correct verdict each time.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Optional --live <base-url> mode: in addition to the unit test below, issue
# real HTTP requests against the four exact endpoints from the reviewer's DAST and
# assert each returns 403. Run after deploy to confirm the helper is wired
# in at runtime, not just at the unit level.
LIVE_BASE=""
if [[ "${1:-}" == "--live" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "Usage: $0 --live <base-url>   e.g.   $0 --live https://<deployment-domain>" >&2
    exit 2
  fi
  LIVE_BASE="$2"
fi

TEST_ALLOWED_HOST="${CLAWNEX_TEST_ALLOWED_HOST:-qa.example.invalid}"
OUTPUT="$(cd "$REPO_ROOT" && AUTH_EXPECTED_ORIGIN="https://${TEST_ALLOWED_HOST}" CLAWNEX_TEST_ALLOWED_HOST="$TEST_ALLOWED_HOST" npx --no-install tsx --eval "
// Codex 2026-05-17 #2: AUTH_EXPECTED_ORIGIN above puts the test deployment
// host on the allowlist for this unit run. validateOriginMatch now requires
// both (a) Host=Origin AND (b) Host on the allowlist — without the env, the
// test deployment host would be off the allowlist and same-origin POSTs would
// fail the new gate. Production sets this env via deploy/install-prod.sh.
import { validateOriginMatch } from './src/lib/auth/origin-match';
import type { NextRequest } from 'next/server';

function mkReq(method: string, headers: Record<string, string>): NextRequest {
  const h = new Headers(headers);
  return { method, headers: h } as unknown as NextRequest;
}

const ownHost = process.env.CLAWNEX_TEST_ALLOWED_HOST || 'qa.example.invalid';

const cases = [
  // The four exact attack shapes from the reviewer's DAST — all must be blocked.
  { label: 'POST /api/system/purge with Origin=evil.com',         req: mkReq('POST',   { host: ownHost, origin: 'https://evil.com' }),                           expect: 'block' },
  { label: 'POST /api/break-glass/activate with Origin=evil.com', req: mkReq('POST',   { host: ownHost, origin: 'https://evil.com' }),                           expect: 'block' },
  { label: 'POST /api/proxy/block-mode with Origin=evil.com',     req: mkReq('POST',   { host: ownHost, origin: 'https://evil.com' }),                           expect: 'block' },
  { label: 'PUT /api/config/defaults with Origin=evil.com',       req: mkReq('PUT',    { host: ownHost, origin: 'https://evil.com' }),                           expect: 'block' },

  // Other mutating methods + variations on the same host-mismatch.
  { label: 'PATCH with Origin=evil.com',                          req: mkReq('PATCH',  { host: ownHost, origin: 'https://evil.com' }),                           expect: 'block' },
  { label: 'DELETE with Origin=evil.com',                         req: mkReq('DELETE', { host: ownHost, origin: 'https://evil.com' }),                           expect: 'block' },
  { label: 'POST with Origin=http://attacker',                    req: mkReq('POST',   { host: ownHost, origin: 'http://attacker' }),                            expect: 'block' },
  { label: 'POST with malformed Origin',                          req: mkReq('POST',   { host: ownHost, origin: 'not a url' }),                                  expect: 'block' },

  // Referer-only fallback (older browsers / no-referrer-policy).
  { label: 'POST with no Origin, Referer=evil.com',               req: mkReq('POST',   { host: ownHost, referer: 'https://evil.com/path' }),                     expect: 'block' },
  { label: 'POST with no Origin, malformed Referer',              req: mkReq('POST',   { host: ownHost, referer: 'not a url' }),                                 expect: 'block' },

  // Legitimate same-origin requests — must pass.
  { label: 'POST same-origin (https)',                            req: mkReq('POST',   { host: ownHost, origin: 'https://' + ownHost }),                          expect: 'allow' },
  { label: 'PUT same-origin',                                     req: mkReq('PUT',    { host: ownHost, origin: 'https://' + ownHost }),                          expect: 'allow' },
  { label: 'POST same-origin via Referer fallback',               req: mkReq('POST',   { host: ownHost, referer: 'https://' + ownHost + '/dashboard' }),          expect: 'allow' },

  // Safe methods — Origin enforcement does not apply (browsers don't always
  // send Origin on top-level navigation, and GETs should not be mutating).
  { label: 'GET with Origin=evil.com (safe method exempt)',       req: mkReq('GET',    { host: ownHost, origin: 'https://evil.com' }),                           expect: 'allow' },
  { label: 'HEAD with Origin=evil.com',                           req: mkReq('HEAD',   { host: ownHost, origin: 'https://evil.com' }),                           expect: 'allow' },
  { label: 'OPTIONS with Origin=evil.com',                        req: mkReq('OPTIONS',{ host: ownHost, origin: 'https://evil.com' }),                           expect: 'allow' },

  // Non-browser caller (curl, server-side fetch, MCP) — no Origin, no
  // Referer. These have their own auth (API key) and must pass through.
  { label: 'POST from non-browser (no Origin, no Referer)',       req: mkReq('POST',   { host: ownHost }),                                                       expect: 'allow' },
];

const results = cases.map((c) => {
  const r = validateOriginMatch(c.req);
  const verdict = r === null ? 'allow' : 'block';
  return { label: c.label, expect: c.expect, got: verdict, ok: verdict === c.expect };
});

console.log(JSON.stringify({
  total: results.length,
  pass: results.filter((r) => r.ok).length,
  fail: results.filter((r) => !r.ok),
}, null, 2));
" 2>&1)"

echo "$OUTPUT"

UNIT_OK=0
if echo "$OUTPUT" | grep -q '"fail": \[\]'; then
  echo "PASS (unit) — Origin/Referer match blocks cross-origin mutations, allows same-origin and safe methods"
  UNIT_OK=1
else
  echo "FAIL (unit) — at least one Origin-match case did not return the expected verdict"
  exit 1
fi

if [[ -z "$LIVE_BASE" ]]; then
  [[ "$UNIT_OK" == "1" ]] && exit 0 || exit 1
fi

# ---- Live mode -----------------------------------------------------------
# Issue real cross-origin POST/PUTs against the four exploit endpoints and
# assert each returns 403. Body intentionally minimal — we want the Origin
# check to fire before any other validation.
echo ""
echo "== Live HTTP checks against $LIVE_BASE =="
LIVE_FAIL=0
check_live() {
  local method="$1" path="$2" body="$3"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X "$method" \
    -H 'Origin: https://evil.com' \
    -H 'Content-Type: application/json' \
    --max-time 10 \
    --data "$body" \
    "${LIVE_BASE}${path}" || echo "000")"
  # 403 = Origin layer fired (RBAC-off / unauthenticated localhost flow).
  # 401 = RBAC-on session layer rejected before Origin check could fire —
  #       which is fine, the attacker still can't reach the handler.
  # Anything else (2xx, 5xx, 000) = exploit reached the handler = FAIL.
  case "$code" in
    401|403)
      printf "  PASS  %-6s %-40s -> %s\n" "$method" "$path" "$code"
      ;;
    *)
      printf "  FAIL  %-6s %-40s -> %s (expected 401 or 403)\n" "$method" "$path" "$code"
      LIVE_FAIL=1
      ;;
  esac
}

check_live POST /api/system/purge          '{"confirm":"PURGE"}'
check_live POST /api/break-glass/activate  '{"reason":"test"}'
check_live POST /api/proxy/block-mode      '{"mode":"observe"}'
check_live PUT  /api/config/defaults       '{"key":"retention_audit_days","value":"30"}'

if [[ "$LIVE_FAIL" == "0" ]]; then
  echo "PASS (live) — all four exploit endpoints refuse Origin: https://evil.com (401 RBAC-on, or 403 RBAC-off)"
  exit 0
fi
echo "FAIL (live) — at least one exploit endpoint did not refuse the hostile Origin"
exit 1
