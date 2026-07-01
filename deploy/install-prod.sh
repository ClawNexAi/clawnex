#!/bin/bash
# =============================================================================
# ClawNex — Production Deploy Layer (Linux + systemd + Caddy)
#
# Runs ON TOP of a successful setup.sh. Adds:
#   - systemd unit for the dashboard (auto-restart, journald logs)
#   - Caddy package install from official Cloudsmith repo
#   - Caddyfile pointed at your domain
#   - ufw rules opening :80 + :443, leaves :5001 internal-only
#   - Triggers Let's Encrypt cert via tls-alpn-01 on first HTTPS hit
#
# Requires: sudo, Linux host (Ubuntu / Debian — apt-based)
# Usage:
#   ./deploy/install-prod.sh <public-domain>
#   e.g. ./deploy/install-prod.sh app.example.com
#
# Pre-requisites:
#   1. setup.sh has run successfully on this host
#   2. <public-domain> resolves to this host's public IP (gray-cloud DNS,
#      not Cloudflare-proxied — Caddy needs direct port-80 access for
#      Let's Encrypt HTTP/TLS challenge)
#   3. Ports 80 + 443 are reachable from the public internet (provider
#      firewall + any local ufw rules)
# =============================================================================
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ---- box-drawing helpers (matched to setup.sh) ------------------------------
# box_line strips ANSI escapes for visible-length math so colored content
# pads correctly. Caller wraps the block in color (echo -ne; box_*; echo -e).
BOX_W=70
box_top() { local w="${1:-$BOX_W}"; printf '╔'; printf '═%.0s' $(seq 1 "$w"); printf '╗\n'; }
box_bot() { local w="${1:-$BOX_W}"; printf '╚'; printf '═%.0s' $(seq 1 "$w"); printf '╝\n'; }
box_sep() { local w="${1:-$BOX_W}"; printf '║'; printf ' %.0s' $(seq 1 "$w"); printf '║\n'; }
rule()    { local w="${1:-$BOX_W}"; printf '═%.0s' $(seq 1 "$w"); printf '\n'; }
box_line() {
    local content="$1"
    local w="${2:-$BOX_W}"
    local visible="${content//$'\033'\[[0-9;]*m/}"
    local len=${#visible}
    local pad=$(( w - len ))
    [ "$pad" -lt 0 ] && pad=0
    printf '║%s%*s║\n' "$content" "$pad" ""
}

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_PORT=5001

if [ "$#" -lt 1 ]; then
    echo -e "${RED}usage:${NC} ./deploy/install-prod.sh <public-domain>"
    echo -e "  e.g. ./deploy/install-prod.sh app.example.com"
    exit 1
fi

PUBLIC_DOMAIN="$1"

# CX-G6 fix (2026-04-26 adversarial review): validate the domain BEFORE any
# file write or sudo invocation. Without this an attacker who tricks the
# operator into running install-prod.sh with a poisoned argument (newlines /
# control chars / shell metacharacters) could inject extra Caddy directives
# under sudo. Allowed: letters, digits, dots, hyphens. Reject anything else.
if ! [[ "$PUBLIC_DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    echo -e "${RED}✗${NC} Invalid domain '${PUBLIC_DOMAIN}' — must contain only letters, digits, dots, hyphens. Refusing to proceed."
    exit 1
fi

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║      ClawNex Production Deploy — ${PUBLIC_DOMAIN}    ${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
echo -e "${BOLD}[1/8] Pre-flight checks${NC}"

if [ "$(uname -s)" != "Linux" ]; then
    echo -e "  ${RED}✗${NC} install-prod.sh is Linux-only (uses apt + systemd). Detected: $(uname -s)"
    exit 1
fi

if ! command -v sudo &>/dev/null; then
    echo -e "  ${RED}✗${NC} sudo not available — required for /etc edits"
    exit 1
fi

# Sudo handling — works for both interactive operators (sudo prompts) and
# automated runs (SUDO_PASSWORD env). When SUDO_PASSWORD is set, an askpass
# helper script is created in /tmp (mode 700, deleted on exit) and exported
# via SUDO_ASKPASS so every sudo call uses it transparently. When unset,
# the script just runs `sudo -v` once to refresh the cache and let the
# operator type their password — every subsequent sudo call uses the cache.
if [ -n "${SUDO_PASSWORD:-}" ]; then
    ASKPASS_HELPER="$(mktemp)"
    chmod 700 "$ASKPASS_HELPER"
    cat > "$ASKPASS_HELPER" <<HELPER
#!/bin/sh
printf '%s' "${SUDO_PASSWORD}"
HELPER
    export SUDO_ASKPASS="$ASKPASS_HELPER"
    trap "rm -f $ASKPASS_HELPER" EXIT
    SUDO="sudo -A"
    echo -e "  ${GREEN}✓${NC} sudo via SUDO_PASSWORD env (askpass helper $ASKPASS_HELPER)"
else
    sudo -v || { echo -e "  ${RED}✗${NC} sudo failed to authenticate"; exit 1; }
    # Background keepalive so long apt installs don't outlast the cache
    ( while true; do sudo -n true 2>/dev/null || break; sleep 30; done ) &
    SUDO_KEEPALIVE_PID=$!
    trap "kill $SUDO_KEEPALIVE_PID 2>/dev/null" EXIT
    SUDO="sudo"
    echo -e "  ${GREEN}✓${NC} sudo cached (background keepalive PID ${SUDO_KEEPALIVE_PID})"
fi

if [ ! -f "$INSTALL_DIR/.env.local" ]; then
    echo -e "  ${RED}✗${NC} $INSTALL_DIR/.env.local not found — run ./setup.sh first"
    exit 1
fi

if [ ! -d "$INSTALL_DIR/.next" ]; then
    echo -e "  ${RED}✗${NC} $INSTALL_DIR/.next missing — setup.sh build did not complete"
    exit 1
fi

SYSTEMCTL_BIN="$(command -v systemctl || echo /usr/bin/systemctl)"

# Pre-flight: kill any non-systemd squatter on port 5001. setup.sh starts the
# dashboard via nohup; install-prod.sh wants to take over via systemd. The
# nohup process MUST exit before the systemd unit can bind. Without this the
# unit fails with "address already in use" inside journalctl and the install
# reports a confusing "service failed to start" — caught the hard way on
# staging host 2026-04-25 iteration 3.
SQUATTER_PID=$(ss -tlnp 2>/dev/null | awk '/:5001 /' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
if [ -n "$SQUATTER_PID" ]; then
    SQUATTER_NAME=$(ps -p "$SQUATTER_PID" -o comm= 2>/dev/null | xargs)
    echo -e "  ${YELLOW}⚠${NC} Port 5001 in use by ${SQUATTER_NAME} (PID ${SQUATTER_PID}) — killing before systemd takes over"
    kill "$SQUATTER_PID" 2>/dev/null
    sleep 2
    kill -0 "$SQUATTER_PID" 2>/dev/null && kill -9 "$SQUATTER_PID" 2>/dev/null
fi

# Confirm domain resolves. Tailscale `.ts.net` magic-DNS names are
# unresolvable from public DNS by design (only the tailnet sees them) — skip
# the @1.1.1.1 check for these. Operator is expected to use Tailscale's
# `tailscale cert` for TLS rather than Caddy's LE auto-provisioning.
case "$PUBLIC_DOMAIN" in
    *.ts.net)
        echo -e "  ${GREEN}✓${NC} ${PUBLIC_DOMAIN} is a Tailscale magic-DNS name — skipping public DNS check"
        echo -e "  ${YELLOW}⚠${NC} Caddy auto-HTTPS won't work for .ts.net. Use \`tailscale cert\` and a manual Caddyfile after install."
        ;;
    *)
        echo -e "  Checking that ${PUBLIC_DOMAIN} resolves..."
        RESOLVED=$(dig +short A "$PUBLIC_DOMAIN" @1.1.1.1 2>/dev/null | head -1)
        if [ -z "$RESOLVED" ]; then
            echo -e "  ${YELLOW}⚠${NC} ${PUBLIC_DOMAIN} did not resolve via 1.1.1.1. Caddy will fail to fetch cert until DNS is in place."
            read -p "  Proceed anyway? (yes/no) [no]: " PROCEED_DNS
            [ "${PROCEED_DNS:-no}" = "yes" ] || { echo "Aborting."; exit 1; }
        else
            echo -e "  ${GREEN}✓${NC} ${PUBLIC_DOMAIN} → ${RESOLVED}"
        fi
        ;;
esac

echo ""

# ---------------------------------------------------------------------------
# Update .env.local for the public domain
# ---------------------------------------------------------------------------
echo -e "${BOLD}[2/8] Updating .env.local with public domain${NC}"
sed -i.bak \
    -e "s|^AUTH_RP_ID=.*|AUTH_RP_ID=${PUBLIC_DOMAIN}|" \
    -e "s|^AUTH_EXPECTED_ORIGIN=.*|AUTH_EXPECTED_ORIGIN=https://${PUBLIC_DOMAIN}|" \
    "$INSTALL_DIR/.env.local"
# If GITHUB_OAUTH_CALLBACK_URL is uncommented, also update it
sed -i \
    -e "s|^GITHUB_OAUTH_CALLBACK_URL=.*|GITHUB_OAUTH_CALLBACK_URL=https://${PUBLIC_DOMAIN}/api/auth/github/callback|" \
    "$INSTALL_DIR/.env.local"
# Codex 2026-05-17 #5: TRUST_PROXY_HEADERS=1 tells the rate-limit middleware
# it can read X-Forwarded-For for client identity. This is ONLY safe because
# the Caddyfile reverse_proxy block above sets `header_up X-Forwarded-For
# {remote_host}`, overwriting any spoofed value the client sent. Idempotent:
# replace if present, append if not.
if grep -qE '^TRUST_PROXY_HEADERS=' "$INSTALL_DIR/.env.local"; then
    sed -i -e "s|^TRUST_PROXY_HEADERS=.*|TRUST_PROXY_HEADERS=1|" "$INSTALL_DIR/.env.local"
else
    echo "TRUST_PROXY_HEADERS=1" >> "$INSTALL_DIR/.env.local"
fi
rm -f "$INSTALL_DIR/.env.local.bak"
echo -e "  ${GREEN}✓${NC} AUTH_RP_ID and AUTH_EXPECTED_ORIGIN now point to https://${PUBLIC_DOMAIN}"
echo -e "  ${GREEN}✓${NC} TRUST_PROXY_HEADERS=1 set (safe: Caddy overwrites XFF with real peer IP)"

echo ""

# ---------------------------------------------------------------------------
# Rebuild — Next.js bakes env at build time, so domain switch needs a rebuild
# ---------------------------------------------------------------------------
echo -e "${BOLD}[3/8] Rebuilding with public-domain env${NC}"
cd "$INSTALL_DIR"
# internal reviewer 2026-05-10 fail-closed: capture full build log to disk and exit
# loudly on failure. The previous `| tail -3` swallowed type errors that
# made `next build` fail silently, leading to dashboard restart-loops.
BUILD_LOG="${INSTALL_DIR}/.deploy-build.log"
if ! npm run build > "$BUILD_LOG" 2>&1; then
    echo -e "  ${RED}✗${NC} npm run build FAILED. Last 50 lines of $BUILD_LOG:"
    tail -50 "$BUILD_LOG"
    exit 1
fi
tail -3 "$BUILD_LOG"

# internal reviewer 2026-05-10 fail-closed: standalone runtime artifacts MUST exist.
# install-prod.sh used to fall back to `npm start` when standalone was
# missing. That hid `next build` failures (incomplete .next/ → restart-
# loop) and produced dashboard units that would never come up. Refuse
# to continue if the standalone build is incomplete.
if [ ! -f "${INSTALL_DIR}/.next/standalone/server.js" ]; then
    echo -e "  ${RED}✗${NC} build did not produce .next/standalone/server.js"
    echo "    Last 50 lines of build log ($BUILD_LOG):"
    tail -50 "$BUILD_LOG"
    exit 1
fi
if [ ! -d "${INSTALL_DIR}/.next/standalone/.next/static" ]; then
    echo -e "  ${RED}✗${NC} build did not produce .next/standalone/.next/static (postbuild step did not run or failed)"
    tail -50 "$BUILD_LOG"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} build complete (full log: $BUILD_LOG)"
echo ""

# ---------------------------------------------------------------------------
# Install Caddy from official repo
# ---------------------------------------------------------------------------
echo -e "${BOLD}[4/8] Installing Caddy${NC}"
if command -v caddy &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Caddy already installed: $(caddy version | head -1)"
else
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq caddy
    echo -e "  ${GREEN}✓${NC} Caddy installed: $(caddy version | head -1)"
fi
echo ""

# ---------------------------------------------------------------------------
# Caddyfile
# ---------------------------------------------------------------------------
# Includes a CLAWNEX-MANAGED marker comment so the uninstall script can
# safely identify ours vs an operator-managed Caddyfile that happens to
# proxy localhost:5001. CX-G5 fix from 2026-04-26 adversarial review —
# the previous "if file contains 127.0.0.1:5001 then it's ours" heuristic
# could remove unrelated Caddy config.
echo -e "${BOLD}[5/8] Writing Caddyfile${NC}"
# M1 (DAST 2026-05-14): security headers are now set ONLY by Next.js
# (next.config.mjs + middleware.ts). Caddy used to re-add the same five
# headers here, which produced duplicate response headers with the
# additional gotcha that HSTS values diverged ("preload" only on Caddy).
# Single source of truth = Next; Caddy now passes upstream headers
# through unchanged. Also strips the Via header — Caddy added a
# "Via: 1.1 Caddy" identifier by default that revealed the proxy
# (DAST finding L1).

# DAST 2026-05-15 Run 2 #H5: detect whether this Caddy binary has the
# caddy-ratelimit plugin (http.handlers.rate_limit). Stock apt/brew
# Caddy does NOT — adding the directive unconditionally would fail
# `caddy validate` and abort install. If present, we emit the edge
# rate-limit block; if absent, the app-layer middleware rate-limit
# in src/middleware.ts is the sole defense and an operator advisory
# is printed.
CADDY_HAS_RATELIMIT=0
if caddy list-modules 2>/dev/null | grep -q '^http\.handlers\.rate_limit$'; then
    CADDY_HAS_RATELIMIT=1
fi

if [ "$CADDY_HAS_RATELIMIT" = "1" ]; then
    RATELIMIT_BLOCK=$(cat <<'RATELIMIT_BLOCK_EOF'
    # DAST 2026-05-15 Run 2 #H5: edge rate-limit via caddy-ratelimit
    # plugin. Per-IP zones layered on top of the in-app middleware
    # rate-limit (src/middleware.ts) for belt-and-suspenders. Burst
    # zones catch DAST-style 15-rapid-request probes; sustained zones
    # match the app-layer 60-second policy.
    rate_limit {
        zone clawnex_burst {
            key {remote_host}
            events 20
            window 10s
        }
        zone clawnex_sustained {
            key {remote_host}
            events 240
            window 60s
        }
    }
RATELIMIT_BLOCK_EOF
)
else
    RATELIMIT_BLOCK=""
fi

$SUDO tee /etc/caddy/Caddyfile > /dev/null <<CADDYFILE
# CLAWNEX-MANAGED — written by deploy/install-prod.sh, removed by uninstall.
# Edit at your own risk; future deploys will overwrite. To opt out, comment
# the marker line above before running install-prod.sh again.
${PUBLIC_DOMAIN} {
    encode zstd gzip
    # DAST 2026-05-15 #9: refuse oversized request bodies. The
    # dashboard's largest legitimate payloads (config JSON, ingest
    # callbacks, workspace edits) all sit well under 1MB; 10MB is a
    # generous ceiling that still cuts off unbounded upload floods.
    request_body {
        max_size 10MB
    }
    # DAST 2026-05-15 #9: pin TLS to 1.2+. Caddy's automatic HTTPS
    # already negotiates modern protocols by default, but declaring
    # the floor explicitly makes the policy auditable in the
    # Caddyfile and survives any future Caddy default change.
    tls {
        protocols tls1.2 tls1.3
    }
${RATELIMIT_BLOCK}
    # DAST 2026-05-15 #8 (edge fix): refuse TRACE at the Caddy layer
    # before it reaches Next. Next.js 14 intercepts unrecognized HTTP
    # methods upstream of middleware and returns its built-in 500
    # error page (including X-Powered-By: Next.js), so the middleware
    # TRACE guard never runs in standalone production. We close
    # Cross-Site-Tracing here: matched requests get a clean 405 +
    # Allow header listing the methods we DO route. The middleware
    # guard (src/middleware.ts) is kept as defense-in-depth in case
    # this block is ever removed by an operator-managed Caddyfile.
    @trace method TRACE
    handle @trace {
        header Allow "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
        respond "" 405
    }
    reverse_proxy 127.0.0.1:${DASHBOARD_PORT} {
        flush_interval -1
        # Codex 2026-05-17 #5: overwrite client-sent X-Forwarded-For with
        # the actual remote host so Next's middleware can trust the value
        # for rate-limit bucketing. Without this, an attacker rotating
        # spoofed XFF headers gets a fresh bucket each request and bypasses
        # the dual-window limiter. {remote_host} is the real peer IP that
        # connected to Caddy. Pair this with TRUST_PROXY_HEADERS=1 in the
        # dashboard env (set below in step 2).
        header_up X-Forwarded-For {remote_host}
    }
    header {
        # Strip Caddy proxy fingerprint (DAST L1).
        -Via
        -Server
    }
}
CADDYFILE
$SUDO caddy validate --config /etc/caddy/Caddyfile > /dev/null
if [ "$CADDY_HAS_RATELIMIT" = "1" ]; then
    echo -e "  ${GREEN}✓${NC} /etc/caddy/Caddyfile written + validated (edge rate-limit ENABLED)"
else
    echo -e "  ${GREEN}✓${NC} /etc/caddy/Caddyfile written + validated"
    echo -e "  ${YELLOW}⚠${NC} Caddy does not have the caddy-ratelimit plugin — edge rate-limit is DISABLED."
    echo -e "      The app-layer rate-limit in src/middleware.ts is the sole rate-limit defense."
    echo -e "      To enable edge rate-limit, rebuild Caddy with the plugin:"
    echo -e "        xcaddy build --with github.com/mholt/caddy-ratelimit"
    echo -e "        sudo install -m 0755 caddy /usr/bin/caddy && sudo systemctl restart caddy"
    echo -e "      Then re-run this installer; the Caddyfile will pick up the directive automatically."
fi
echo ""

# ---------------------------------------------------------------------------
# systemd unit for the dashboard
# ---------------------------------------------------------------------------
echo -e "${BOLD}[6/8] Writing systemd unit${NC}"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
# ExecStart: Next.js standalone server. internal reviewer 2026-05-10 spec: no `npm start`
# fallback. The npm-start fallback used to paper over partial `.next/`
# builds (no BUILD_ID → restart-loop). Step [3/8] above already exits 1
# when standalone artifacts are missing, so reaching this point means the
# standalone runtime is present and verified.
if [ ! -f "${INSTALL_DIR}/.next/standalone/server.js" ] || [ ! -d "${INSTALL_DIR}/.next/standalone/.next/static" ]; then
    echo -e "  ${RED}✗${NC} standalone runtime gone between [3/8] and [6/8] — refusing to write systemd unit"
    exit 1
fi
DASHBOARD_EXEC="/usr/bin/node ${INSTALL_DIR}/.next/standalone/server.js"
$SUDO tee /etc/systemd/system/clawnex-dashboard.service > /dev/null <<UNIT
[Unit]
Description=ClawNex Dashboard (Next.js)
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env.local
Environment=PATH=/home/${SERVICE_USER}/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOSTNAME=127.0.0.1
# Pin the DB to the install root: Next's standalone server.js chdir()s to
# .next/standalone at startup, so cwd-relative DB resolution would put the
# database inside the build dir — which setup.sh wipes on every rebuild
# (operator data loss; live finding on Crucible 2026-06-13).
Environment=DATABASE_PATH=${INSTALL_DIR}/clawnex.db
Environment=CLAWNEX_LOG_DIR=${INSTALL_DIR}/logs
ExecStart=${DASHBOARD_EXEC}
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

# LiteLLM proxy — only install the unit when there's a config to run
# against. Bare `litellm --config ...` with a missing config exits
# immediately, so an unconditionally-installed unit would fail-loop.
#
# 2026-05-08 fix-for-real: previously this picked between two pre-existing
# `litellm` binary paths and silently fell through to /usr/local/bin/litellm
# when neither existed (e.g. a fresh box that never ran setup.sh). Result:
# systemd unit with a broken ExecStart, service stuck in restart-loop.
# Made worse on Ubuntu 26.04 because the system python is 3.14 and
# uvloop 0.21.0 (a hard dep of litellm[proxy]) was built against
# `asyncio.events.BaseDefaultEventLoopPolicy` which 3.14 removed.
#
# Resolution priority:
#   1. ~/.litellm-venv/bin/litellm (portable-python venv) — the durable
#      pattern we want as default. Survives redeploys (lives outside
#      INSTALL_DIR), version-locked python, no system-python coupling.
#   2. ~/.local/bin/litellm (legacy pip --user install — staging host/demo host
#      historically). Kept as a fallback so existing boxes keep working
#      across redeploys without forcing a venv migration.
#   3. /usr/local/bin/litellm (legacy pip system install). Same idea.
#   4. Bootstrap fresh: download Astral python-build-standalone python3.12,
#      create ~/.litellm-venv, pip install litellm[proxy]==1.84.10. This is
#      the path Ubuntu 26.04 / Debian 13 / any fresh box hits.
#
# The bootstrap is intentionally idempotent — re-running it on a box that
# already has an older venv upgrades LiteLLM to the required security floor.
if [ -f "${INSTALL_DIR}/litellm/config.yaml" ]; then
    REQUIRED_LITELLM_VERSION="1.84.10"
    LITELLM_BIN=""
    ensure_litellm_version() {
        local python_bin="$1"
        local current
        current="$($SUDO -u "${SERVICE_USER}" "${python_bin}" - <<'PY' 2>/dev/null || true
import importlib.metadata
try:
    print(importlib.metadata.version("litellm"))
except importlib.metadata.PackageNotFoundError:
    pass
PY
)"
        if [ "$current" = "$REQUIRED_LITELLM_VERSION" ]; then
            echo -e "  ${GREEN}✓${NC} LiteLLM ${REQUIRED_LITELLM_VERSION} verified"
            return 0
        fi
        echo -e "  ${YELLOW}⚠${NC} LiteLLM ${current:-not installed} found; upgrading to ${REQUIRED_LITELLM_VERSION}"
        $SUDO -u "${SERVICE_USER}" "${python_bin}" -m pip install --upgrade "litellm[proxy]==${REQUIRED_LITELLM_VERSION}" --quiet 2>&1 | tail -1 \
            || { echo -e "  ${RED}✗${NC} litellm pip upgrade failed"; exit 1; }
        current="$($SUDO -u "${SERVICE_USER}" "${python_bin}" - <<'PY' 2>/dev/null || true
import importlib.metadata
try:
    print(importlib.metadata.version("litellm"))
except importlib.metadata.PackageNotFoundError:
    pass
PY
)"
        [ "$current" = "$REQUIRED_LITELLM_VERSION" ] \
            || { echo -e "  ${RED}✗${NC} LiteLLM version check failed after upgrade. Got '${current:-metadata not found}'"; exit 1; }
        echo -e "  ${GREEN}✓${NC} LiteLLM ${REQUIRED_LITELLM_VERSION} installed"
    }
    if [ -x "/home/${SERVICE_USER}/.litellm-venv/bin/litellm" ]; then
        LITELLM_BIN="/home/${SERVICE_USER}/.litellm-venv/bin/litellm"
        echo -e "  ${GREEN}✓${NC} Using existing litellm venv at ~/.litellm-venv (fresh-box durable pattern)"
        ensure_litellm_version "/home/${SERVICE_USER}/.litellm-venv/bin/python"
    elif [ -x "/home/${SERVICE_USER}/.local/bin/litellm" ]; then
        LITELLM_BIN="/home/${SERVICE_USER}/.local/bin/litellm"
        echo -e "  ${GREEN}✓${NC} Using legacy pip-user litellm at ~/.local/bin/litellm"
        ensure_litellm_version "$(command -v python3)"
    elif [ -x "/usr/local/bin/litellm" ]; then
        LITELLM_BIN="/usr/local/bin/litellm"
        echo -e "  ${GREEN}✓${NC} Using legacy pip-system litellm at /usr/local/bin/litellm"
        ensure_litellm_version "$(command -v python3)"
    else
        # Bootstrap path: fresh box, no litellm anywhere. Install via
        # portable python3.12 so we don't fight whatever distro python the
        # box ships (uvloop / fastuuid / polars / etc. all have version-
        # specific wheels and break on too-new pythons).
        echo -e "  ${YELLOW}⚠${NC} No litellm binary found — bootstrapping fresh install via portable python3.12..."
        PY_TARBALL="cpython-3.12.8+20241219-x86_64-unknown-linux-gnu-install_only.tar.gz"
        PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20241219/${PY_TARBALL}"
        PY_PORTABLE="/home/${SERVICE_USER}/.python-portable"
        VENV="/home/${SERVICE_USER}/.litellm-venv"
        if [ ! -x "${PY_PORTABLE}/python/bin/python3" ]; then
            $SUDO -u "${SERVICE_USER}" mkdir -p "${PY_PORTABLE}"
            $SUDO -u "${SERVICE_USER}" bash -c "curl -sSL '${PY_URL}' | tar xz -C '${PY_PORTABLE}'" \
                || { echo -e "  ${RED}✗${NC} portable python download failed"; exit 1; }
            echo -e "  ${GREEN}✓${NC} portable python3.12 installed at ${PY_PORTABLE}"
        fi
        $SUDO -u "${SERVICE_USER}" "${PY_PORTABLE}/python/bin/python3" -m venv "${VENV}"
        $SUDO -u "${SERVICE_USER}" "${VENV}/bin/pip" install --upgrade pip --quiet 2>&1 | tail -1
        $SUDO -u "${SERVICE_USER}" "${VENV}/bin/pip" install "litellm[proxy]==${REQUIRED_LITELLM_VERSION}" --quiet 2>&1 | tail -1 \
            || { echo -e "  ${RED}✗${NC} litellm pip install failed"; exit 1; }
        LITELLM_BIN="${VENV}/bin/litellm"
        [ -x "$LITELLM_BIN" ] || { echo -e "  ${RED}✗${NC} venv bootstrap completed but ${LITELLM_BIN} not executable"; exit 1; }
        echo -e "  ${GREEN}✓${NC} litellm ${REQUIRED_LITELLM_VERSION} installed in ${VENV}"
    fi
    $SUDO tee /etc/systemd/system/clawnex-litellm.service > /dev/null <<UNIT
[Unit]
Description=ClawNex LiteLLM Proxy
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env.local
Environment=PATH=/home/${SERVICE_USER}/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${LITELLM_BIN} --config ${INSTALL_DIR}/litellm/config.yaml --host 127.0.0.1 --port 4001
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
    LITELLM_UNIT_INSTALLED=1
    SUDOERS_TMP="$(mktemp)"
    cat > "$SUDOERS_TMP" <<SUDOERS
# ClawNex: allow the dashboard service user to restart only the LiteLLM proxy
# after provider config sync. No shell access or arbitrary systemctl verbs.
${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} start clawnex-litellm.service, ${SYSTEMCTL_BIN} stop clawnex-litellm.service, ${SYSTEMCTL_BIN} restart clawnex-litellm.service
SUDOERS
    if [ -x /usr/sbin/visudo ]; then
        $SUDO /usr/sbin/visudo -cf "$SUDOERS_TMP" >/dev/null
    fi
    $SUDO install -m 0440 "$SUDOERS_TMP" /etc/sudoers.d/clawnex-litellm
    rm -f "$SUDOERS_TMP"
else
    LITELLM_UNIT_INSTALLED=0
fi

$SUDO systemctl daemon-reload
echo -e "  ${GREEN}✓${NC} clawnex-dashboard.service installed (User=${SERVICE_USER})"
if [ "$LITELLM_UNIT_INSTALLED" = "1" ]; then
    echo -e "  ${GREEN}✓${NC} clawnex-litellm.service installed"
    echo -e "  ${GREEN}✓${NC} sudoers scoped for dashboard LiteLLM start/stop/restart"
else
    echo -e "  ${DIM}—${NC} clawnex-litellm.service skipped (no litellm/config.yaml — proxy not configured)"
fi
echo ""

# ---------------------------------------------------------------------------
# Firewall — open 80 + 443, leave 5001 internal
# ---------------------------------------------------------------------------
echo -e "${BOLD}[7/8] Firewall (ufw)${NC}"
if command -v ufw &>/dev/null; then
    $SUDO ufw allow 80/tcp comment "Caddy HTTP" > /dev/null 2>&1 || true
    $SUDO ufw allow 443/tcp comment "Caddy HTTPS" > /dev/null 2>&1 || true
    UFW_STATUS=$($SUDO ufw status | head -1)
    echo -e "  ${GREEN}✓${NC} :80 + :443 allowed (${UFW_STATUS})"
else
    echo -e "  ${YELLOW}⚠${NC} ufw not installed — make sure your provider firewall opens :80 + :443"
fi
echo ""

# ---------------------------------------------------------------------------
# Start services + cert handshake
# ---------------------------------------------------------------------------
echo -e "${BOLD}[8/8] Starting services + first cert handshake${NC}"
# If a transient LiteLLM is still running from setup.sh's nohup, kill it
# so systemd can take ownership of the port like we do for the dashboard.
if [ "$LITELLM_UNIT_INSTALLED" = "1" ]; then
    LL_PID=$(ss -tlnp 2>/dev/null | awk '/:4001 /' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
    if [ -n "$LL_PID" ]; then
        kill "$LL_PID" 2>/dev/null && sleep 1
        echo -e "  ${DIM}Killed transient LiteLLM (PID $LL_PID) — systemd will own it now${NC}"
    fi
    $SUDO systemctl enable --now clawnex-litellm
fi
$SUDO systemctl enable --now clawnex-dashboard

# Wait up to 60s for the unit to reach a definitive state. npm start +
# next start cold-launch can take 10-30s on a slow VPS; "activating" is
# transient and not a failure signal. Poll every 2s.
echo "  Waiting for clawnex-dashboard to come active (up to 60s)..."
for i in $(seq 1 30); do
    STATE=$($SUDO systemctl is-active clawnex-dashboard 2>/dev/null || echo "unknown")
    case "$STATE" in
        active)
            echo -e "  ${GREEN}✓${NC} clawnex-dashboard active (after ${i} polls / $((i*2))s)"
            break
            ;;
        failed|deactivating|inactive)
            echo -e "  ${RED}✗${NC} clawnex-dashboard reached state '${STATE}' — last 30 lines from journal:"
            $SUDO journalctl -u clawnex-dashboard -n 30 --no-pager
            exit 1
            ;;
        activating)
            sleep 2
            ;;
        *)
            sleep 2
            ;;
    esac
done
# Final guard if we exhausted the loop without reaching active or failed
FINAL_STATE=$($SUDO systemctl is-active clawnex-dashboard 2>/dev/null)
if [ "$FINAL_STATE" != "active" ]; then
    echo -e "  ${YELLOW}⚠${NC} clawnex-dashboard state '${FINAL_STATE}' after 60s — proceeding (Caddy will retry)"
fi

# internal reviewer 2026-05-10 ordering fix: post-deploy LiteLLM-config rehydrate is
# owned by scripts/deploy-prod.sh (the deploy wrapper that handles preserved-
# DB tar/restore). install-prod.sh runs BEFORE the wrapper restores the
# preserved DB, so a rehydrate hook here would always operate against an
# empty DB. The wrapper's REMOTE_SCRIPT step "7/8 chown + symlink" runs
# the rehydrate AFTER restore, AFTER chown, BEFORE standalone symlinks,
# BEFORE clawnex-litellm + clawnex-dashboard restarts. See
# scripts/deploy-prod.sh and verify-post-deploy-rehydrate.ts §4.

$SUDO systemctl enable caddy
# Use RESTART (not start) — Debian's apt install of Caddy auto-starts the
# service with the default file_server Caddyfile, so a plain `start` is a
# no-op (already running with the wrong config). Restart forces a fresh
# config load. (Caught on staging host 2026-04-25 iteration 1: Caddy bound :80
# only because it was using the default config; reload didn't refresh TLS
# state cleanly so we use restart for determinism.)
$SUDO systemctl restart caddy
sleep 5
if ! $SUDO systemctl is-active --quiet caddy; then
    echo -e "  ${RED}✗${NC} caddy failed to start. Check: $SUDO journalctl -u caddy -n 30"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} caddy active with our Caddyfile"

echo "  Triggering cert acquisition (first :443 hit; ~5-15s for Let's Encrypt)..."
HTTPS_RESULT=$(curl -sS --max-time 30 "https://${PUBLIC_DOMAIN}/api/health" 2>&1 | head -c 300)
echo "  → $HTTPS_RESULT"
echo ""

# ---------------------------------------------------------------------------
# Summary + magic URL
# ---------------------------------------------------------------------------
SETUP_SECRET=$(grep -E "^SETUP_SECRET=" "$INSTALL_DIR/.env.local" | head -1 | cut -d= -f2-)

# Auto-size the "deploy complete" box to fit the domain
W=$(( ${#PUBLIC_DOMAIN} + 50 ))
[ "$W" -lt 70 ] && W=70
echo -ne "${GREEN}${BOLD}"
box_top $W
box_line "  ClawNex production deploy complete on https://${PUBLIC_DOMAIN}" $W
box_bot $W
echo -e "${NC}"
echo ""

if [ -n "$SETUP_SECRET" ]; then
    SETUP_URL="https://${PUBLIC_DOMAIN}/setup?secret=${SETUP_SECRET}"
    # URL on its own line — no box, no leading whitespace, no color codes.
    # Boxed URLs visually broke when terminals wrapped them at column 80/100,
    # splitting the secret across lines and making operators copy-paste only
    # half. Plain-text-on-its-own-line works in every terminal: even when
    # wrapped, the URL still reconstructs from the wrap point cleanly.
    echo -e "${YELLOW}${BOLD}"
    rule 72
    echo "  FIRST-RUN ADMIN — open this URL in your browser:"
    rule 72
    echo -e "${NC}"
    echo ""
    echo "$SETUP_URL"
    echo ""
    echo "  Recover later:"
    echo "    grep SETUP_SECRET ${INSTALL_DIR}/.env.local"
    echo ""
fi

echo -e "  ${CYAN}Status:${NC} $SUDO systemctl status clawnex-dashboard caddy"
echo -e "  ${CYAN}Logs:${NC}   $SUDO journalctl -u clawnex-dashboard -f"
echo -e "  ${CYAN}Caddy:${NC}  $SUDO journalctl -u caddy -f"
echo ""
