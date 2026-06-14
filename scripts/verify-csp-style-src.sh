#!/usr/bin/env bash
# =============================================================================
# verify-csp-style-src.sh — guards H2 (DAST 2026-05-14 residual, closed
# 2026-05-15).
#
# The Content-Security-Policy emitted by `src/middleware.ts` must:
#   - have a `style-src` directive that does NOT include 'unsafe-inline'
#   - have a `style-src-elem` directive scoped to 'self' (no 'unsafe-inline'
#     either) so attacker-injected <style> tags are refused
#   - keep `style-src-attr 'unsafe-inline'` so the React style={{...}}
#     attribute pattern (~3169 callsites) keeps working — these aren't
#     the threat class H2 addresses
#   - keep script-src's nonce intact (no regression on P1-A)
#
# This script asserts those shapes by static-parsing middleware.ts so the
# guard fires at the verifier layer before any build / deploy. A separate
# `--live <base-url>` mode hits a running server and inspects the emitted
# CSP header.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

LIVE_BASE=""
if [[ "${1:-}" == "--live" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "Usage: $0 [--live <base-url>]" >&2
    exit 2
  fi
  LIVE_BASE="$2"
fi

# ---- Static pass --------------------------------------------------------
echo "== CSP style-src static check =="
STATIC_FAIL=0

MIDDLEWARE="${REPO_ROOT}/src/middleware.ts"
if [[ ! -f "$MIDDLEWARE" ]]; then
  echo "FAIL — src/middleware.ts not found"
  exit 1
fi

check_re() {
  local label="$1"
  local re="$2"
  local invert="${3:-}"
  if grep -Eq "$re" "$MIDDLEWARE"; then
    if [[ "$invert" == "invert" ]]; then
      printf "  FAIL  %s\n" "$label"
      STATIC_FAIL=1
    else
      printf "  PASS  %s\n" "$label"
    fi
  else
    if [[ "$invert" == "invert" ]]; then
      printf "  PASS  %s\n" "$label"
    else
      printf "  FAIL  %s\n" "$label"
      STATIC_FAIL=1
    fi
  fi
}

# Use Python for precise regex on the buildCspWithNonce string array
python3 - "$MIDDLEWARE" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
# Extract the buildCspWithNonce function body
m = re.search(r"function buildCspWithNonce\([^)]*\)[^{]*\{(.+?)^\}", src, re.DOTALL | re.MULTILINE)
if not m:
    print("FAIL  buildCspWithNonce function not found", flush=True)
    sys.exit(1)
body = m.group(1)

cases = []
# style-src 'self' (no unsafe-inline on the bare style-src directive)
m1 = re.search(r'"style-src ([^"]*)"', body)
if not m1:
    cases.append(("FAIL", "style-src directive present"))
elif "'unsafe-inline'" in m1.group(1):
    cases.append(("FAIL", "style-src does NOT contain 'unsafe-inline'  (got: style-src " + m1.group(1) + ")"))
else:
    cases.append(("PASS", "style-src does NOT contain 'unsafe-inline'  (got: style-src " + m1.group(1) + ")"))

# style-src-elem 'self' (no unsafe-inline)
m2 = re.search(r'"style-src-elem ([^"]*)"', body)
if not m2:
    cases.append(("FAIL", "style-src-elem directive present"))
elif "'unsafe-inline'" in m2.group(1):
    cases.append(("FAIL", "style-src-elem does NOT contain 'unsafe-inline'  (got: style-src-elem " + m2.group(1) + ")"))
else:
    cases.append(("PASS", "style-src-elem does NOT contain 'unsafe-inline'  (got: style-src-elem " + m2.group(1) + ")"))

# style-src-attr 'unsafe-inline' (intentionally allowed)
m3 = re.search(r'"style-src-attr ([^"]*)"', body)
if not m3 or "'unsafe-inline'" not in m3.group(1):
    cases.append(("FAIL", "style-src-attr 'unsafe-inline' present (keeps React style={{...}} working)"))
else:
    cases.append(("PASS", "style-src-attr 'unsafe-inline' present (keeps React style={{...}} working)"))

# script-src nonce-${nonce} (P1-A regression guard)
if "'nonce-${nonce}'" not in body:
    cases.append(("FAIL", "script-src 'nonce-${nonce}' template present (P1-A regression guard)"))
else:
    cases.append(("PASS", "script-src 'nonce-${nonce}' template present (P1-A regression guard)"))

# script-src NOT relaxed with 'unsafe-inline'
m4 = re.search(r"`script-src ([^`]*)`", body)
if m4 and "'unsafe-inline'" in m4.group(1):
    cases.append(("FAIL", "script-src does NOT contain 'unsafe-inline'"))
else:
    cases.append(("PASS", "script-src does NOT contain 'unsafe-inline'"))

# default-src 'self'
if "\"default-src 'self'\"" not in body:
    cases.append(("FAIL", "default-src 'self' present"))
else:
    cases.append(("PASS", "default-src 'self' present"))

fails = 0
for status, label in cases:
    print(f"  {status}  {label}")
    if status == "FAIL":
        fails += 1

print(f"\n{fails} static fail(s) out of {len(cases)}")
sys.exit(1 if fails else 0)
PY

STATIC_RC=$?
if [[ "$STATIC_RC" != "0" ]]; then
  STATIC_FAIL=1
fi

if [[ "$STATIC_FAIL" != "0" ]]; then
  echo "FAIL (static) — CSP style-src shape regressed"
  exit 1
fi
echo "PASS (static) — CSP style-src dropped 'unsafe-inline' on element-level, kept it on attribute-level"

if [[ -z "$LIVE_BASE" ]]; then
  exit 0
fi

# ---- Live pass ---------------------------------------------------------
echo ""
echo "== CSP live header check against $LIVE_BASE =="
LIVE_FAIL=0

CSP="$(curl -sI -L "$LIVE_BASE/" 2>&1 | grep -i '^content-security-policy:' | head -1 || true)"
if [[ -z "$CSP" ]]; then
  echo "  FAIL  CSP header present"
  LIVE_FAIL=1
else
  echo "  PASS  CSP header present (len=$(echo -n "$CSP" | wc -c))"
fi

# style-src has no unsafe-inline
if echo "$CSP" | grep -Eo "style-src [^;]*" | head -1 | grep -q "'unsafe-inline'"; then
  echo "  FAIL  live style-src contains 'unsafe-inline'"
  LIVE_FAIL=1
else
  echo "  PASS  live style-src omits 'unsafe-inline'"
fi

# style-src-elem 'self'
if echo "$CSP" | grep -q "style-src-elem 'self'"; then
  echo "  PASS  live style-src-elem 'self' present"
else
  echo "  FAIL  live style-src-elem 'self' missing"
  LIVE_FAIL=1
fi

# style-src-attr 'unsafe-inline'
if echo "$CSP" | grep -q "style-src-attr 'unsafe-inline'"; then
  echo "  PASS  live style-src-attr 'unsafe-inline' present"
else
  echo "  FAIL  live style-src-attr 'unsafe-inline' missing"
  LIVE_FAIL=1
fi

# script-src nonce
if echo "$CSP" | grep -Eo "script-src [^;]*" | grep -q "'nonce-"; then
  echo "  PASS  live script-src nonce present"
else
  echo "  FAIL  live script-src nonce missing"
  LIVE_FAIL=1
fi

# Root HTML has zero <style> tags (a regression would indicate someone
# added an inline <style> back into a component without a nonce)
ROOT_HTML="$(curl -s "$LIVE_BASE/" 2>&1 || true)"
STYLE_COUNT="$(echo "$ROOT_HTML" | grep -oE '<style\b' | wc -l | tr -d ' ')"
if [[ "$STYLE_COUNT" == "0" ]]; then
  echo "  PASS  root / HTML emits zero <style> tags"
else
  echo "  FAIL  root / HTML emits $STYLE_COUNT <style> tag(s) — CSP will block them"
  LIVE_FAIL=1
fi

if [[ "$LIVE_FAIL" == "0" ]]; then
  echo "PASS (live) — CSP wire shape matches static intent + no <style> regression"
  exit 0
fi
echo "FAIL (live) — see above"
exit 1
