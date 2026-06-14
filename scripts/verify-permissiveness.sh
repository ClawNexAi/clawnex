#!/usr/bin/env bash
# verify-permissiveness.sh — endpoint-level smoke test for the blast-radius API.
#
# Hits /api/permissiveness and asserts the response has the expected
# envelope shape (surfaces / profiles / postureLints / rankings / meta).
# Does not validate deep content — that is the job of
# scripts/verify-permissiveness-units.ts.
#
# Usage:
#   ./scripts/verify-permissiveness.sh [base_url]
#
#   base_url  Optional. Defaults to http://127.0.0.1:5001
#
# Exit codes:
#   0   endpoint reachable + shape present
#   1   reachable but shape missing a required field
#   2   endpoint unreachable or non-200

set -uo pipefail

BASE_URL="${1:-http://127.0.0.1:5001}"
URL="${BASE_URL}/api/permissiveness"

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

status=$(curl -sS --max-time 10 -o "$tmpfile" -w "%{http_code}" "$URL" 2>/dev/null || echo "000")

case "$status" in
  200)
    ;;
  *)
    echo "FAIL: $URL → HTTP $status (unreachable or error)"
    exit 2
    ;;
esac

# Shape assertions — each required field must appear as a top-level JSON key.
# Plain grep is enough here; we're not parsing, just confirming presence.
for field in surfaces profiles postureLints rankings meta generatedAt dangerousCombos; do
  if ! grep -q "\"$field\"" "$tmpfile"; then
    echo "FAIL: $URL response missing required top-level field \"$field\""
    exit 1
  fi
done

echo "PASS: /api/permissiveness reachable + envelope shape present"
exit 0
