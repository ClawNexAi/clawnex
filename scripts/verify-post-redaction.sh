#!/usr/bin/env bash
# =============================================================================
# verify-post-redaction.sh — guards POST /api/config/providers + gateways
# against returning plaintext secrets in the create response.
#
# Background: GET responses redact api_key / token, but the POST handler
# previously returned the newly-created object directly from
# configService.addProvider / addGateway — including the plaintext secret in
# the HTTP response body. Browser memory + network tab + reverse-proxy logs
# all saw the real value.
#
# This test reads the two route files and asserts each POST's
# NextResponse.json(...) goes through `configService.redactProvider(...)` or
# `configService.redactGateway(...)`. Code-level grep is sufficient because
# the redactor functions are well-tested by the GET path; what we want to
# guard is that the route doesn't bypass them again on a future edit.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVIDERS="$REPO_ROOT/src/app/api/config/providers/route.ts"
GATEWAYS="$REPO_ROOT/src/app/api/config/gateways/route.ts"

fail=0

check() {
    local file="$1"
    local needle="$2"
    local label="$3"
    if grep -q "$needle" "$file"; then
        echo "  PASS  $label"
    else
        echo "  FAIL  $label"
        fail=1
    fi
}

echo "=== POST redaction guard ==="

check "$PROVIDERS" "configService.redactProvider(provider)" \
    "providers POST routes response through redactProvider"

check "$GATEWAYS" "configService.redactGateway(gateway)" \
    "gateways POST routes response through redactGateway"

# Belt: confirm the raw addProvider/addGateway return value never appears in
# a NextResponse.json shape without redaction. If a future commit reverts
# to `{ provider }` or `{ gateway }` directly, this catches it.
if grep -E "NextResponse\.json\(\s*\{\s*provider\s*\}" "$PROVIDERS" >/dev/null 2>&1; then
    echo "  FAIL  providers POST shorthand `{ provider }` resurfaced (unredacted)"
    fail=1
else
    echo "  PASS  providers POST does not shorthand-return unredacted object"
fi

if grep -E "NextResponse\.json\(\s*\{\s*gateway\s*\}" "$GATEWAYS" >/dev/null 2>&1; then
    echo "  FAIL  gateways POST shorthand `{ gateway }` resurfaced (unredacted)"
    fail=1
else
    echo "  PASS  gateways POST does not shorthand-return unredacted object"
fi

if [ "$fail" = "0" ]; then
    echo "PASS — POST create endpoints redact secrets"
    exit 0
fi

echo "FAIL — at least one POST endpoint can leak plaintext secrets in its response body"
exit 1
