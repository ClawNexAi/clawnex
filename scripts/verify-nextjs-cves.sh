#!/usr/bin/env bash
# =============================================================================
# verify-nextjs-cves.sh — confirms the installed Next.js version is past the
# fixed-in patch for every public CVE in the 14.x stream that the 2026-05-13
# multi-vector assessment flagged as applicable.
#
# Background: the assessment claimed Next.js 14.2.35 was vulnerable to
# CVE-2025-29927 + 10 other CVEs. The actual published advisories fix each
# of those at a 14.2.x patch level well below .35. The pin we ship is past
# every relevant fix — this script makes that audit-checkable on a CI run
# or red-team review pass.
#
# If the pin ever drifts BELOW the highest fixed-in level (e.g., a future
# operator pins to 14.2.20 for a compatibility reason), this fails loudly
# so the regression is caught before a deploy.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PINNED=$(grep -E '"next":' "$REPO_ROOT/package.json" | sed -E 's/.*"next":[[:space:]]*"([^"]+)".*/\1/' | tr -d '^~')

# Minimum 14.2.x patch level that contains every Next.js CVE fix the
# 2026-05-13 multi-vector report cited as applicable. Sourced from:
#   - github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw (CVE-2025-29927)
#   - github.com/vercel/next.js/security/advisories/GHSA-7gfc-8cq8-jh5f (CVE-2024-56332)
#   - github.com/vercel/next.js/security/advisories/GHSA-3h52-269p-cp9r (CVE-2025-27110)
#   - github.com/vercel/next.js/security/advisories/GHSA-7m27-7ghc-44w9 (CVE-2024-46982)
# Highest of those fixed-in levels is 14.2.25; we ship >= that.
REQUIRED_MIN="14.2.25"

ok() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; exit 1; }

echo "=== Next.js CVE verification ==="
echo "  pinned:   $PINNED"
echo "  required: >= $REQUIRED_MIN"
echo ""

# Compare a.b.c.d-style versions
ver_ge() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

if ver_ge "$PINNED" "$REQUIRED_MIN"; then
  ok "pin $PINNED is >= $REQUIRED_MIN"
else
  fail "pin $PINNED is BELOW $REQUIRED_MIN — at least one Next.js CVE is unpatched"
fi

# Confirm the installed copy matches the pin (no skew between package.json
# and node_modules — caught a stale-cache build problem once).
INSTALLED=$(node -e "try { console.log(require('next/package.json').version); } catch { console.log('not-installed'); }")
if [ "$INSTALLED" = "not-installed" ]; then
  echo "  WARN  node_modules/next not present — run npm install"
elif [ "$INSTALLED" = "$PINNED" ]; then
  ok "installed copy ($INSTALLED) matches package.json pin"
else
  fail "installed copy ($INSTALLED) does NOT match pin ($PINNED) — run npm install"
fi

echo ""
echo "PASS — Next.js pin satisfies every CVE fix-in level"
