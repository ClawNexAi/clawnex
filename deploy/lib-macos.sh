#!/bin/bash
# =============================================================================
# ClawNex — macOS Service Layer (launchd [+ Caddy for server mode])
#
# Runs ON TOP of a successful `setup.sh --no-start`, the macOS counterpart
# of deploy/install-prod.sh. Invoked by install.sh:
#
#   MAC_MODE=local  bash deploy/lib-macos.sh
#   MAC_MODE=server DOMAIN=clawnex.example.com bash deploy/lib-macos.sh
#
# Env contract:
#   MAC_MODE        local | server                      (required)
#   DOMAIN          public name for server mode         (required if server)
#   DASHBOARD_PORT  default 5001
#   LITELLM_PORT    default 4001
#
# What it does:
#   [1] Writes launchd agents (KeepAlive) for dashboard + LiteLLM
#       ~/Library/LaunchAgents/io.clawnex.dashboard.plist
#       ~/Library/LaunchAgents/io.clawnex.litellm.plist
#   [2] (server) brew-installs Caddy, writes a marker-tagged Caddyfile
#       block, picks TLS per domain class (LE / tailscale guidance /
#       internal CA), starts Caddy via brew services
#   [3] Health-verifies what it started
#
# TLS classes (server mode):
#   *.ts.net         → print `tailscale cert` instructions; tls file paths
#   public FQDN      → Caddy automatic Let's Encrypt
#   bare/LAN name    → `tls internal` (Caddy local CA; browser warning OK)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
info() { echo -e "  ${CYAN}•${NC} $*"; }
die()  { echo -e "  ${RED}✗${NC} $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "lib-macos.sh is macOS-only (detected $(uname -s))"
MAC_MODE="${MAC_MODE:-}"
[ "$MAC_MODE" = "local" ] || [ "$MAC_MODE" = "server" ] || die "MAC_MODE must be local|server"
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_PORT="${DASHBOARD_PORT:-5001}"
LITELLM_PORT="${LITELLM_PORT:-4001}"
AGENTS_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTS_DIR" "$INSTALL_DIR/logs"

if [ "$MAC_MODE" = "server" ]; then
    DOMAIN="${DOMAIN:-}"
    [ -n "$DOMAIN" ] || die "server mode requires DOMAIN"
    # Same injection guard as install-prod.sh (CX-G6): letters/digits/dots/hyphens.
    [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "Invalid domain '$DOMAIN'"
fi

# macOS always binds the dashboard to loopback. Local mode is explicitly
# localhost-only, and server mode reaches the dashboard through the local Caddy
# reverse proxy. RBAC controls who can use the app, not whether :5001 is exposed
# on the LAN.
DASHBOARD_BIND="127.0.0.1"

# ---- [1] launchd agents ------------------------------------------------------
echo -e "${CYAN}[mac 1/3] launchd agents${NC}"

# Production server is the Next standalone bundle (next.config 'output:
# standalone'), exactly like deploy/install-prod.sh — NOT `next start`, which
# a standalone build doesn't provide (node_modules/.bin/next absent; live
# finding on the test Mac 2026-06-13).
STANDALONE_SERVER="$INSTALL_DIR/.next/standalone/server.js"
[ -f "$STANDALONE_SERVER" ] || die "standalone server missing at $STANDALONE_SERVER — did setup.sh build complete?"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
    for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
        [ -x "$c" ] && { NODE_BIN="$c"; break; }
    done
fi
[ -n "$NODE_BIN" ] || die "node not found on PATH or in known prefixes"

# launchd has no systemd-style EnvironmentFile, so a tiny launcher sources
# .env.local before exec'ing the standalone server. PORT/HOSTNAME/DATABASE_PATH
# are set AFTER the source so they win — mirrors the systemd unit's Environment.
DASH_LAUNCHER="$INSTALL_DIR/deploy/.clawnex-dashboard-run.sh"
cat > "$DASH_LAUNCHER" <<LAUNCH
#!/bin/bash
cd "$INSTALL_DIR" || exit 1
set -a
[ -f ./.env.local ] && . ./.env.local
PORT=$DASHBOARD_PORT
HOSTNAME=$DASHBOARD_BIND
DATABASE_PATH="$INSTALL_DIR/clawnex.db"
set +a
exec "$NODE_BIN" "$STANDALONE_SERVER"
LAUNCH
chmod +x "$DASH_LAUNCHER"

cat > "$AGENTS_DIR/io.clawnex.dashboard.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.clawnex.dashboard</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>${DASH_LAUNCHER}</string>
  </array>
  <key>WorkingDirectory</key><string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${INSTALL_DIR}/logs/dashboard.log</string>
  <key>StandardErrorPath</key><string>${INSTALL_DIR}/logs/dashboard.log</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict></plist>
PLIST
ok "io.clawnex.dashboard.plist written (standalone server, bind ${DASHBOARD_BIND}:${DASHBOARD_PORT})"

# LiteLLM agent only when a usable binary + config exist (mirrors setup.sh).
LITELLM_BIN="$(command -v litellm 2>/dev/null || true)"
if [ -z "$LITELLM_BIN" ]; then
    for c in /opt/homebrew/bin/litellm "$HOME/.local/bin/litellm" /usr/local/bin/litellm; do
        [ -f "$c" ] && { LITELLM_BIN="$c"; break; }
    done
fi
if [ -n "$LITELLM_BIN" ] && [ -f "$INSTALL_DIR/litellm/config.yaml" ]; then
cat > "$AGENTS_DIR/io.clawnex.litellm.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.clawnex.litellm</string>
  <key>ProgramArguments</key><array>
    <string>${LITELLM_BIN}</string>
    <string>--config</string><string>${INSTALL_DIR}/litellm/config.yaml</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>${LITELLM_PORT}</string>
  </array>
  <key>WorkingDirectory</key><string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${INSTALL_DIR}/logs/litellm.log</string>
  <key>StandardErrorPath</key><string>${INSTALL_DIR}/logs/litellm.log</string>
</dict></plist>
PLIST
    ok "io.clawnex.litellm.plist written (127.0.0.1:${LITELLM_PORT})"
    HAVE_LITELLM=1
else
    warn "LiteLLM binary or config missing — proxy agent skipped (configure provider later, re-run installer)"
    HAVE_LITELLM=0
fi

# bootout first so re-installs land cleanly; bootout failing (not loaded) is fine.
UID_N="$(id -u)"
launchctl bootout "gui/${UID_N}" "$AGENTS_DIR/io.clawnex.dashboard.plist" 2>/dev/null || true
launchctl bootstrap "gui/${UID_N}" "$AGENTS_DIR/io.clawnex.dashboard.plist"
launchctl kickstart -k "gui/${UID_N}/io.clawnex.dashboard" 2>/dev/null || true
ok "dashboard agent loaded"
if [ "$HAVE_LITELLM" = "1" ]; then
    launchctl bootout "gui/${UID_N}" "$AGENTS_DIR/io.clawnex.litellm.plist" 2>/dev/null || true
    launchctl bootstrap "gui/${UID_N}" "$AGENTS_DIR/io.clawnex.litellm.plist"
    launchctl kickstart -k "gui/${UID_N}/io.clawnex.litellm" 2>/dev/null || true
    ok "litellm agent loaded"
fi

# ---- [2] server mode: Caddy --------------------------------------------------
TS_NOTE=0
if [ "$MAC_MODE" = "server" ]; then
    echo -e "${CYAN}[mac 2/3] Caddy reverse proxy${NC}"
    command -v brew >/dev/null || die "Homebrew required for server mode (https://brew.sh)"
    if ! command -v caddy >/dev/null; then
        info "Installing Caddy via Homebrew..."
        brew install caddy
    fi
    ok "Caddy: $(caddy version | head -1)"

    BREW_PREFIX="$(brew --prefix)"
    CADDYFILE="${BREW_PREFIX}/etc/Caddyfile"
    touch "$CADDYFILE"

    # TLS directive per domain class
    TLS_LINE=""
    case "$DOMAIN" in
        *.ts.net)
            TS_NOTE=1
            TLS_LINE="    tls ${BREW_PREFIX}/etc/clawnex-certs/${DOMAIN}.crt ${BREW_PREFIX}/etc/clawnex-certs/${DOMAIN}.key"
            ;;
        *.*)
            TLS_LINE=""   # public FQDN → Caddy automatic Let's Encrypt
            ;;
        *)
            TLS_LINE="    tls internal"   # bare LAN name → Caddy local CA
            ;;
    esac

    # Remove any prior ClawNex-managed block, then append fresh (idempotent).
    if grep -q '# >>> CLAWNEX MANAGED BLOCK >>>' "$CADDYFILE"; then
        sed -i '' '/# >>> CLAWNEX MANAGED BLOCK >>>/,/# <<< CLAWNEX MANAGED BLOCK <<</d' "$CADDYFILE"
        info "Replaced existing ClawNex Caddyfile block"
    fi
    {
        echo "# >>> CLAWNEX MANAGED BLOCK >>>"
        echo "${DOMAIN} {"
        [ -n "$TLS_LINE" ] && echo "$TLS_LINE"
        echo "    reverse_proxy 127.0.0.1:${DASHBOARD_PORT} {"
        echo "        header_up X-Forwarded-For {remote_host}"
        echo "    }"
        echo "}"
        echo "# <<< CLAWNEX MANAGED BLOCK <<<"
    } >> "$CADDYFILE"
    caddy validate --config "$CADDYFILE" >/dev/null 2>&1 || die "Caddyfile failed validation — inspect $CADDYFILE"
    ok "Caddyfile block written + validated"

    if [ "$TS_NOTE" = "1" ]; then
        mkdir -p "${BREW_PREFIX}/etc/clawnex-certs"
        warn "Tailscale domain: run these before HTTPS works:"
        echo "      tailscale cert --cert-file '${BREW_PREFIX}/etc/clawnex-certs/${DOMAIN}.crt' \\"
        echo "                     --key-file  '${BREW_PREFIX}/etc/clawnex-certs/${DOMAIN}.key' ${DOMAIN}"
        echo "      brew services restart caddy"
    fi

    brew services restart caddy >/dev/null
    ok "Caddy (re)started via brew services"
fi

# ---- [3] health --------------------------------------------------------------
echo -e "${CYAN}[mac 3/3] health${NC}"
HEALTHY=0
for i in $(seq 1 60); do
    if curl -sf -m 3 "http://127.0.0.1:${DASHBOARD_PORT}/api/health" >/dev/null 2>&1; then
        HEALTHY=1; ok "dashboard healthy (~$((i*2))s)"; break
    fi
    sleep 2
done
[ "$HEALTHY" = "1" ] || die "dashboard not healthy in 120s — check ${INSTALL_DIR}/logs/dashboard.log"
if [ "$HAVE_LITELLM" = "1" ]; then
    if curl -sf -m 5 "http://127.0.0.1:${LITELLM_PORT}/health" >/dev/null 2>&1 \
       || curl -s -m 5 "http://127.0.0.1:${LITELLM_PORT}/" >/dev/null 2>&1; then
        ok "litellm responding on :${LITELLM_PORT}"
    else
        warn "litellm not responding yet — check ${INSTALL_DIR}/logs/litellm.log"
    fi
fi
if [ "$MAC_MODE" = "server" ] && [ "$TS_NOTE" = "0" ]; then
    if curl -skf -m 8 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
        ok "HTTPS reachable at https://${DOMAIN}"
    else
        warn "HTTPS not confirmed yet (cert issuance can take ~1 min): curl -k https://${DOMAIN}/api/health"
    fi
fi
exit 0
