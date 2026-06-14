#!/usr/bin/env bash
# =============================================================================
# verify-pattern-b.sh — Pattern-B RBAC-off route-guard verifier.
#
# Background
# ----------
# Pattern-B: a route handler gates auth behind `if (isRbacEnabled())` with
# no else clause. With RBAC off (default-admin / break-glass), the guard
# is skipped and the handler is reachable to any caller — including the
# network. Originally found by internal reviewer in DAST 2026-05-13 and partially
# fixed by commit `ab21c26` (P0-B, 21 hand-curated routes). The hand
# list missed routes added since then; this verifier walks the full
# tree systematically.
#
# What "guarded" means here
# -------------------------
# A handler is guarded if its body contains at least one of:
#
#   (a) `if (isRbacEnabled())` paired with a matching `} else {` block
#       whose body calls `requireLocalhost(`  — the RBAC-Off Defense
#       Pattern. The inverted shape `} else { requireLocalhost(` reads
#       a couple of intermediate statements ahead.
#   (a') `if (!isRbacEnabled())` early-bail (e.g. `return 403`) before
#       any unauthenticated work — the surface is closed when RBAC is
#       off, so the localhost fallback isn't needed.
#   (b)  `requireSession(` with no enclosing `if (isRbacEnabled())` —
#        the auth call is unconditional, no rbac-off bypass exists.
#   (c)  `authenticateRequest(` — the v1 public-API token middleware.
#   (d)  `checkDevToolsGate(` or `checkDevToolsReadGate(` — the shared
#        Developer Tools gate (env + DB + RBAC + localhost-fallback).
#
# Routes that defer to a file-local helper instead of an inline guard
# are listed in HELPER_GUARDED_ALLOWLIST below with the helper name and
# a one-line reason. Truly public routes (login, health, OAuth init,
# proxy ingest) are listed in PUBLIC_ALLOWLIST.
#
# Static pass: walks every src/app/api/**/route.ts and classifies every
# exported HTTP-method handler.
# Live pass (--live <base>): hits each non-allow-listed GET route and
# asserts 401/403/404 from a remote-origin position.
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

# ---- Static pass: systematic tree walk -----------------------------------
echo "== Pattern-B static check (systematic tree walk) =="

python3 - "$REPO_ROOT" <<'PY'
import os, re, sys

repo_root = sys.argv[1]
api_dir = os.path.join(repo_root, "src/app/api")

# Public by design — login flow, health probes, OAuth callbacks, ingest
# endpoints with their own secret, and the OpenClaw-state probe used by
# the unauthenticated Quick Setup card.
PUBLIC_ALLOWLIST = {
    "auth/login", "auth/logout", "auth/csrf", "auth/status", "auth/setup",
    "auth/forgot-password", "auth/reset-password",
    "auth/magic-link/begin", "auth/magic-link/complete",
    "auth/passkey/authenticate/begin", "auth/passkey/authenticate/complete",
    "auth/github/start", "auth/github/callback", "auth/github/status",
    "health", "health/detailed", "v1/health",
    "proxy/ingest", "setup/openclaw-state",
}

# Files where the guard lives in a file-local helper instead of inline.
# Each entry is the reason a maintainer reading the verifier output can
# spot-check by opening that file. KEEP THIS LIST SMALL — if a new
# pattern appears, prefer fixing the route to using an inline guard
# rather than adding to this list.
HELPER_GUARDED_ALLOWLIST = {
    "auth/sessions":
        "GET uses unconditional requireSession; DELETE early-bails with 403 when RBAC is off (RBAC-required surface).",
    "config/operators":
        "Both handlers early-bail with `if (!isRbacEnabled()) return 403` before any auth-sensitive work (RBAC-required admin surface).",
    "config/operators/[id]":
        "Both handlers early-bail with `if (!isRbacEnabled()) return 403` before any auth-sensitive work.",
    "correlations/rules":
        "Handlers call file-local `checkAuth(request, perm)` which does isRbacEnabled + else { requireLocalhost }.",
    "reports/schedule":
        "Handlers call file-local `checkAuth(request)` which does isRbacEnabled + else { requireLocalhost }.",
    "risk-acceptances":
        "Handlers call file-local `authReadOrFail`/`authWriteOrFail` (isRbacEnabled early-return + fall-through requireLocalhost).",
    "risk-acceptances/[id]":
        "DELETE calls file-local `authWriteOrFail` (isRbacEnabled early-return + fall-through requireLocalhost).",
    "policies/[id]/rules/[ruleId]":
        "Handlers call file-local `authorizeWrite` which does isRbacEnabled + else { requireLocalhost }.",
}

HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD")


def extract_handler_body(src, method):
    pat = re.compile(
        r"export\s+async\s+function\s+" + method + r"\s*\([^)]*\)\s*(?::\s*[^{]+)?\{",
    )
    m = pat.search(src)
    if not m:
        return None
    i = m.end()
    depth = 1
    n = len(src)
    in_str = None
    while i < n and depth > 0:
        ch = src[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
        else:
            if ch in ("'", '"', "`"):
                in_str = ch
            elif ch == "/" and i + 1 < n and src[i + 1] in ("/", "*"):
                if src[i + 1] == "/":
                    nl = src.find("\n", i)
                    i = n if nl == -1 else nl
                    continue
                else:
                    end = src.find("*/", i + 2)
                    i = n if end == -1 else end + 2
                    continue
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return src[m.end():i]
        i += 1
    return None


def classify(body):
    has_authenticate_request = "authenticateRequest(" in body
    has_dev_tools_gate = "checkDevToolsGate(" in body or "checkDevToolsReadGate(" in body
    has_isrbac_gate = "isRbacEnabled()" in body
    has_require_session = "requireSession(" in body
    has_require_localhost = "requireLocalhost(" in body

    if has_authenticate_request:
        return ("PASS", "v1 API token")
    if has_dev_tools_gate:
        return ("PASS", "dev-tools gate")
    if has_isrbac_gate:
        else_then_localhost = re.search(
            r"\}\s*else\s*\{[^}]*?requireLocalhost\(",
            body,
            re.DOTALL,
        )
        if else_then_localhost and has_require_session:
            return ("PASS", "Pattern (a): isRbacEnabled + else { requireLocalhost }")
        if "!isRbacEnabled()" in body:
            return ("PASS", "Pattern (a'): early-bail when RBAC is off")
        return (
            "FAIL",
            "isRbacEnabled() gate without matching else { requireLocalhost } block",
        )
    if has_require_session:
        return ("PASS", "Pattern (b): unconditional requireSession")
    return ("FAIL", "no inline guard (and route not in any allow-list)")


fails = []
passes = []
allowed_public = []
allowed_helper = []
total_handlers = 0

for dirpath, _, filenames in os.walk(api_dir):
    if "route.ts" not in filenames:
        continue
    f = os.path.join(dirpath, "route.ts")
    rel = os.path.relpath(dirpath, api_dir).replace(os.sep, "/")
    src = open(f, "r", encoding="utf-8").read()

    handlers = []
    for method in HTTP_METHODS:
        body = extract_handler_body(src, method)
        if body is not None:
            handlers.append((method, body))
            total_handlers += 1

    if not handlers:
        continue

    if rel in PUBLIC_ALLOWLIST:
        for method, _ in handlers:
            allowed_public.append((rel, method))
        continue

    if rel in HELPER_GUARDED_ALLOWLIST:
        for method, _ in handlers:
            allowed_helper.append((rel, method))
        continue

    for method, body in handlers:
        verdict, reason = classify(body)
        if verdict == "PASS":
            passes.append((rel, method, reason))
        else:
            fails.append((rel, method, reason))

print(f"Handlers scanned: {total_handlers}")
print(f"  PASS (inline) : {len(passes)}")
print(f"  ALLOW public  : {len(allowed_public)}")
print(f"  ALLOW helper  : {len(allowed_helper)}")
print(f"  FAIL          : {len(fails)}")
print()

if allowed_helper:
    print("Helper-guarded routes (verified by file inspection):")
    for rel, method in sorted(set(allowed_helper)):
        reason = HELPER_GUARDED_ALLOWLIST[rel]
        print(f"  ALLOW  {method:6s}  /api/{rel:<40s}  {reason}")
    print()

if fails:
    print("FAILURES (handlers that need a guard chain):")
    for rel, method, reason in sorted(fails):
        print(f"  FAIL  {method:6s}  /api/{rel:<40s}  {reason}")
    print()
    print("FAIL — at least one handler is missing its guard chain.")
    sys.exit(1)

print("PASS — every API handler is guarded (inline, helper-guarded, or public by design).")
sys.exit(0)
PY
STATIC_RC=$?

if [[ "$STATIC_RC" != "0" ]]; then
  exit 1
fi

if [[ -z "$LIVE_BASE" ]]; then
  exit 0
fi

# ---- Live pass ----------------------------------------------------------
echo ""
echo "== Pattern-B live HTTP check against $LIVE_BASE =="
python3 - "$REPO_ROOT" "$LIVE_BASE" <<'PY'
import os, re, sys, urllib.request, urllib.error

repo_root = sys.argv[1]
base = sys.argv[2].rstrip("/")
api_dir = os.path.join(repo_root, "src/app/api")

PUBLIC_ALLOWLIST = {
    "auth/login", "auth/logout", "auth/csrf", "auth/status", "auth/setup",
    "auth/forgot-password", "auth/reset-password",
    "auth/magic-link/begin", "auth/magic-link/complete",
    "auth/passkey/authenticate/begin", "auth/passkey/authenticate/complete",
    "auth/github/start", "auth/github/callback", "auth/github/status",
    "health", "health/detailed", "v1/health",
    "proxy/ingest", "setup/openclaw-state",
}


def has_method(src, method):
    return re.search(r"export\s+async\s+function\s+" + method + r"\s*\(", src) is not None


fails = []
checked = 0
for dirpath, _, filenames in os.walk(api_dir):
    if "route.ts" not in filenames:
        continue
    rel = os.path.relpath(dirpath, api_dir).replace(os.sep, "/")
    if rel in PUBLIC_ALLOWLIST or "[" in rel:
        continue
    src = open(os.path.join(dirpath, "route.ts"), "r", encoding="utf-8").read()
    if not has_method(src, "GET"):
        continue
    url = f"{base}/api/{rel}"
    try:
        resp = urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=10)
        code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        code = 0
    checked += 1
    if code in (401, 403, 404):
        print(f"  PASS  GET /api/{rel:<40s} -> {code}")
    else:
        print(f"  FAIL  GET /api/{rel:<40s} -> {code} (expected 401/403/404)")
        fails.append((rel, code))

if fails:
    print(f"\nFAIL (live) — {len(fails)} route(s) leaked to remote caller")
    sys.exit(1)
print(f"\nPASS (live) — {checked} GET routes refused unauthenticated remote callers")
sys.exit(0)
PY
exit $?
