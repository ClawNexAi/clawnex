#!/usr/bin/env bash
# =============================================================================
# verify-caddyfile-hardening.sh — DAST 2026-05-15 #9 fix guard.
#
# Static check against deploy/install-prod.sh: asserts the shipped
# Caddyfile template (rendered inside the `tee /etc/caddy/Caddyfile`
# heredoc) carries the body-cap and TLS-protocol-floor blocks.
#
# No live Caddy process is invoked — install-prod.sh runs
# `caddy validate` at deploy time which catches any syntax issue
# operator-side. This script just guards against a future edit silently
# removing the hardening clauses.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_ROOT/deploy/install-prod.sh"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "FAIL — $TEMPLATE not found"
  exit 1
fi

fail=0
pass() { printf "  PASS  %s\n" "$1"; }
flag() { printf "  FAIL  %s\n" "$1"; fail=1; }

# Pull just the Caddyfile heredoc (between `tee /etc/caddy/Caddyfile` and
# the closing CADDYFILE marker) so we don't match coincidental keywords
# in shell comments elsewhere in the install script.
HEREDOC="$(awk '
  /tee \/etc\/caddy\/Caddyfile/ { capture=1; next }
  capture && /^CADDYFILE$/      { capture=0 }
  capture                        { print }
' "$TEMPLATE")"

if [[ -z "$HEREDOC" ]]; then
  flag "could not extract Caddyfile heredoc from install-prod.sh"
  echo ""
  echo "FAIL — heredoc extraction returned empty"
  exit 1
fi

# Portability note: all patterns use POSIX classes ([[:space:]]) and
# avoid \s / \b — BSD grep (macOS, FreeBSD) and busybox grep do not
# treat those as shortcuts. Use end-of-token via space/EOL contexts
# rather than \b.

# --- Request body limit ----------------------------------------------------
if printf '%s\n' "$HEREDOC" | grep -qE '^[[:space:]]*request_body[[:space:]]*\{'; then
  pass "Caddyfile has a request_body block"
else
  flag "Caddyfile is missing a request_body block"
fi

if printf '%s\n' "$HEREDOC" | grep -qE '^[[:space:]]*max_size[[:space:]]+[0-9]+[[:space:]]*(KB|MB|GB)?'; then
  BODY_CAP="$(printf '%s\n' "$HEREDOC" | grep -oE 'max_size[[:space:]]+[0-9]+[[:space:]]*(KB|MB|GB)?' | head -1)"
  pass "Caddyfile body cap present ($BODY_CAP)"
else
  flag "Caddyfile is missing a max_size directive inside request_body"
fi

# --- TLS protocol floor ----------------------------------------------------
if printf '%s\n' "$HEREDOC" | grep -qE '^[[:space:]]*tls[[:space:]]*\{'; then
  pass "Caddyfile has a tls block"
else
  flag "Caddyfile is missing a tls block"
fi

if printf '%s\n' "$HEREDOC" | grep -qE 'protocols[[:space:]]+tls1\.2[[:space:]]+tls1\.3'; then
  pass "Caddyfile pins TLS to 1.2 + 1.3 (no TLS 1.0/1.1 fallback)"
else
  flag "Caddyfile is missing `protocols tls1.2 tls1.3` inside the tls block"
fi

# --- Proxy fingerprint headers stripped (regression guard for L1) ---------
# `-Via` / `-Server` are directives — match by requiring trailing space
# or end-of-line instead of \b (BSD grep treats \b as literal).
if printf '%s\n' "$HEREDOC" | grep -qE '^[[:space:]]*-Via([[:space:]]|$)'; then
  pass "Caddyfile strips Via header (DAST L1)"
else
  flag "Caddyfile no longer strips the Via header"
fi
if printf '%s\n' "$HEREDOC" | grep -qE '^[[:space:]]*-Server([[:space:]]|$)'; then
  pass "Caddyfile strips Server header (DAST L1)"
else
  flag "Caddyfile no longer strips the Server header"
fi

# --- TRACE refusal at the Caddy edge (DAST 2026-05-15 #8 edge fix) --------
# Next.js 14 intercepts TRACE upstream of middleware → returns 500. We
# refuse TRACE at Caddy so it never reaches Next. The middleware guard
# is kept as defense-in-depth.
if printf '%s\n' "$HEREDOC" | grep -qE '^[[:space:]]*@trace[[:space:]]+method[[:space:]]+TRACE[[:space:]]*$'; then
  pass "Caddyfile defines @trace matcher (method TRACE)"
else
  flag "Caddyfile is missing the @trace matcher (@trace method TRACE)"
fi

if printf '%s\n' "$HEREDOC" | grep -qE '^[[:space:]]*handle[[:space:]]+@trace[[:space:]]*\{'; then
  pass "Caddyfile uses handle @trace { ... } to fully capture the request"
else
  flag "Caddyfile is missing handle @trace { ... } block"
fi

# Inside the @trace handle: Allow header set + respond 405. We extract
# the handle block body once for both assertions. POSIX awk regex uses
# [[:space:]] (not \s, which is GNU-specific).
TRACE_BLOCK="$(printf '%s\n' "$HEREDOC" | awk '
  /^[[:space:]]*handle[[:space:]]+@trace[[:space:]]*\{/ { in_block=1; brace=1; next }
  in_block {
    for (i=1; i<=length($0); i++) {
      c = substr($0, i, 1)
      if (c == "{") brace++
      if (c == "}") brace--
    }
    print
    if (brace == 0) exit
  }
')"

# Allow-header presence + value-content check. Target the Allow LINE
# specifically — not the first quoted string in the block — so a
# future `respond "..." 405` body argument can't shadow the value.
ALLOW_HEADER_LINE="$(
  printf '%s\n' "$TRACE_BLOCK" \
    | grep -E '^[[:space:]]*header[[:space:]]+Allow[[:space:]]+"[^"]+"' \
    | head -1 \
    || true
)"
if [[ -n "$ALLOW_HEADER_LINE" ]]; then
  pass "TRACE handle sets Allow header"
  ALLOW_VAL="$(
    printf '%s\n' "$ALLOW_HEADER_LINE" \
      | sed -E 's/^[[:space:]]*header[[:space:]]+Allow[[:space:]]+"([^"]+)".*/\1/'
  )"
  case ",$ALLOW_VAL," in
    *TRACE*) flag "TRACE handle Allow header advertises TRACE (should NOT): \"$ALLOW_VAL\"" ;;
    *)       pass "TRACE handle Allow header does NOT advertise TRACE (value=\"$ALLOW_VAL\")" ;;
  esac
else
  flag "TRACE handle is missing the Allow header"
fi

# 405 response inside the handle. Accepts respond "" 405 / respond \"\" 405 /
# respond '' 405. POSIX classes only.
if printf '%s\n' "$TRACE_BLOCK" | grep -qE 'respond[[:space:]]+("[[:space:]]*"|'\'''\'')[[:space:]]+405'; then
  pass "TRACE handle responds with 405"
else
  flag "TRACE handle does not respond with 405 (expected: respond \"\" 405)"
fi

# --- Edge rate-limit detection block (DAST 2026-05-15 Run 2 #H5) ----------
# install-prod.sh detects whether the running Caddy has caddy-ratelimit,
# emits the rate_limit block if present, prints an advisory if absent.
# Static check: assert the detection logic and template strings are
# present in the install script. We do NOT assert presence in the
# final $HEREDOC because the rate_limit block is conditional.
if grep -qE 'caddy[[:space:]]+list-modules.*http\\\.handlers\\\.rate_limit' "$TEMPLATE"; then
  pass "install-prod.sh detects caddy-ratelimit plugin presence"
else
  flag "install-prod.sh missing caddy-ratelimit detection (caddy list-modules | grep http.handlers.rate_limit)"
fi

if grep -qE '^[[:space:]]*rate_limit[[:space:]]*\{' "$TEMPLATE"; then
  pass "install-prod.sh carries a rate_limit { ... } template"
else
  flag "install-prod.sh missing the rate_limit { ... } Caddyfile template"
fi

if grep -qE 'zone[[:space:]]+clawnex_burst' "$TEMPLATE" \
   && grep -qE 'zone[[:space:]]+clawnex_sustained' "$TEMPLATE"; then
  pass "install-prod.sh defines burst + sustained rate-limit zones"
else
  flag "install-prod.sh missing one of the rate-limit zones (clawnex_burst, clawnex_sustained)"
fi

if grep -qE 'xcaddy[[:space:]]+build[[:space:]]+--with[[:space:]]+github\.com/mholt/caddy-ratelimit' "$TEMPLATE"; then
  pass "install-prod.sh prints xcaddy build instructions when plugin is missing"
else
  flag "install-prod.sh is missing the xcaddy build advisory for operators without the plugin"
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "PASS — Caddyfile hardening clauses are intact"
  exit 0
fi
echo "FAIL — at least one hardening clause is missing from the Caddyfile template"
exit 1
