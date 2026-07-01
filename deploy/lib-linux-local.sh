#!/bin/bash
# =============================================================================
# ClawNex — Local Linux Service Layer (systemd, localhost-only)
#
# Runs ON TOP of a successful setup.sh --no-start. Adds:
#   - systemd unit for the dashboard on 127.0.0.1:5001
#   - systemd unit for LiteLLM on 127.0.0.1:4001 when configured
#   - no Caddy, no public TLS, no UFW changes
#
# Use this for single-operator Linux boxes, including cloud VPS desktops
# reached through VNC/RDP/SSH tunnels where ClawNex should not be public.
# =============================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_PORT=5001
LITELLM_PORT=4001

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║      ClawNex Local Linux Deploy — localhost only     ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BOLD}[1/4] Pre-flight checks${NC}"
if [ "$(uname -s)" != "Linux" ]; then
    echo -e "  ${RED}✗${NC} lib-linux-local.sh is Linux-only. Detected: $(uname -s)"
    exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
    echo -e "  ${RED}✗${NC} systemd/systemctl is required for Linux local mode"
    exit 1
fi
if ! command -v sudo >/dev/null 2>&1; then
    echo -e "  ${RED}✗${NC} sudo not available — required for systemd units"
    exit 1
fi

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
    echo -e "  ${GREEN}✓${NC} sudo via SUDO_PASSWORD env"
else
    sudo -v || { echo -e "  ${RED}✗${NC} sudo failed to authenticate"; exit 1; }
    ( while true; do sudo -n true 2>/dev/null || break; sleep 30; done ) &
    SUDO_KEEPALIVE_PID=$!
    trap "kill $SUDO_KEEPALIVE_PID 2>/dev/null" EXIT
    SUDO="sudo"
    echo -e "  ${GREEN}✓${NC} sudo cached (background keepalive PID ${SUDO_KEEPALIVE_PID})"
fi

if [ ! -f "$INSTALL_DIR/.env.local" ]; then
    echo -e "  ${RED}✗${NC} $INSTALL_DIR/.env.local not found — run install.sh/setup.sh first"
    exit 1
fi
if [ ! -f "${INSTALL_DIR}/.next/standalone/server.js" ] || [ ! -d "${INSTALL_DIR}/.next/standalone/.next/static" ]; then
    echo -e "  ${RED}✗${NC} standalone Next.js build missing — setup.sh build did not complete"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} local runtime present"
echo ""

resolve_litellm_bin() {
    local service_user="$1"
    local candidate
    for candidate in \
        "/home/${service_user}/.litellm-venv/bin/litellm" \
        "/home/${service_user}/.local/bin/litellm" \
        "/usr/local/bin/litellm" \
        "/usr/bin/litellm"
    do
        [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
    done
    $SUDO -u "$service_user" bash -lc 'command -v litellm' 2>/dev/null || true
}

echo -e "${BOLD}[2/4] Writing systemd units${NC}"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
SYSTEMCTL_BIN="$(command -v systemctl || echo /usr/bin/systemctl)"

$SUDO systemctl stop clawnex-dashboard clawnex-litellm 2>/dev/null || true
$SUDO systemctl disable clawnex-dashboard clawnex-litellm 2>/dev/null || true

$SUDO tee /etc/systemd/system/clawnex-dashboard.service > /dev/null <<UNIT
[Unit]
Description=ClawNex Dashboard (Local Linux)
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env.local
Environment=PATH=/home/${SERVICE_USER}/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOSTNAME=127.0.0.1
Environment=PORT=${DASHBOARD_PORT}
Environment=DATABASE_PATH=${INSTALL_DIR}/clawnex.db
Environment=CLAWNEX_LOG_DIR=${INSTALL_DIR}/logs
ExecStart=/usr/bin/node ${INSTALL_DIR}/.next/standalone/server.js
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
echo -e "  ${GREEN}✓${NC} clawnex-dashboard.service installed (User=${SERVICE_USER}, localhost-only)"

LITELLM_UNIT_INSTALLED=0
if [ -f "${INSTALL_DIR}/litellm/config.yaml" ]; then
    LITELLM_BIN="$(resolve_litellm_bin "$SERVICE_USER")"
    if [ -z "$LITELLM_BIN" ] || [ ! -x "$LITELLM_BIN" ]; then
        echo -e "  ${RED}✗${NC} LiteLLM config exists but no litellm executable was found"
        echo "    Re-run install.sh so dependency preflight can install LiteLLM, then try again."
        exit 1
    fi
    $SUDO tee /etc/systemd/system/clawnex-litellm.service > /dev/null <<UNIT
[Unit]
Description=ClawNex LiteLLM Proxy (Local Linux)
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env.local
Environment=PATH=/home/${SERVICE_USER}/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${LITELLM_BIN} --config ${INSTALL_DIR}/litellm/config.yaml --host 127.0.0.1 --port ${LITELLM_PORT}
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
    LITELLM_UNIT_INSTALLED=1
    echo -e "  ${GREEN}✓${NC} clawnex-litellm.service installed (localhost-only)"

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
    echo -e "  ${GREEN}✓${NC} sudoers scoped for dashboard LiteLLM start/stop/restart"
else
    echo -e "  ${DIM}—${NC} clawnex-litellm.service skipped (no litellm/config.yaml)"
fi

$SUDO systemctl daemon-reload
echo ""

echo -e "${BOLD}[3/4] Starting local services${NC}"
if [ "$LITELLM_UNIT_INSTALLED" = "1" ]; then
    $SUDO systemctl enable --now clawnex-litellm
fi
$SUDO systemctl enable --now clawnex-dashboard

echo "  Waiting for clawnex-dashboard to become active (up to 60s)..."
for i in $(seq 1 30); do
    STATE=$($SUDO systemctl is-active clawnex-dashboard 2>/dev/null || echo "unknown")
    case "$STATE" in
        active)
            echo -e "  ${GREEN}✓${NC} clawnex-dashboard active (after ${i} polls / $((i*2))s)"
            break
            ;;
        failed|deactivating|inactive)
            echo -e "  ${RED}✗${NC} clawnex-dashboard reached state '${STATE}' — last 30 journal lines:"
            $SUDO journalctl -u clawnex-dashboard -n 30 --no-pager
            exit 1
            ;;
        *) sleep 2 ;;
    esac
done
if [ "$($SUDO systemctl is-active clawnex-dashboard 2>/dev/null || true)" != "active" ]; then
    echo -e "  ${RED}✗${NC} clawnex-dashboard did not become active"
    $SUDO journalctl -u clawnex-dashboard -n 30 --no-pager
    exit 1
fi
echo ""

echo -e "${BOLD}[4/4] Local health check${NC}"
DASHBOARD_HEALTHY=0
for i in $(seq 1 60); do
    if curl -fsS -m 3 "http://127.0.0.1:${DASHBOARD_PORT}/api/health" >/dev/null 2>&1; then
        DASHBOARD_HEALTHY=1
        echo -e "  ${GREEN}✓${NC} Dashboard healthy on http://localhost:${DASHBOARD_PORT} (after ${i} polls / $((i*2))s)"
        break
    fi
    sleep 2
done
if [ "$DASHBOARD_HEALTHY" != "1" ]; then
    echo -e "  ${RED}✗${NC} Dashboard did not answer /api/health after 120s — last 40 journal lines:"
    $SUDO journalctl -u clawnex-dashboard -n 40 --no-pager
    exit 1
fi
if [ "$LITELLM_UNIT_INSTALLED" = "1" ]; then
    if curl -fsS "http://127.0.0.1:${LITELLM_PORT}/health/liveliness" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} LiteLLM liveliness healthy on http://localhost:${LITELLM_PORT}"
    else
        echo -e "  ${YELLOW}⚠${NC} LiteLLM liveliness check did not respond yet; systemd will keep retrying"
    fi
fi
echo ""

SETUP_SECRET="$(grep -E '^SETUP_SECRET=' "$INSTALL_DIR/.env.local" | head -1 | cut -d= -f2-)"
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ClawNex local Linux deploy complete                 ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
if [ -n "$SETUP_SECRET" ]; then
    echo "  First-run admin:"
    echo "    http://localhost:${DASHBOARD_PORT}/setup?secret=${SETUP_SECRET}"
else
    echo "  Dashboard:"
    echo "    http://localhost:${DASHBOARD_PORT}"
fi
echo ""
echo -e "  ${CYAN}Status:${NC} $SUDO systemctl status clawnex-dashboard clawnex-litellm"
echo -e "  ${CYAN}Logs:${NC}   $SUDO journalctl -u clawnex-dashboard -f"
echo ""
