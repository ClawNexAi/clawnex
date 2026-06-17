#!/bin/bash
# =============================================================================
# ClawNex Uninstall Script
# 3-level confirmation to prevent accidental removal
#
# Install-dir resolution — order of precedence:
#   1. Positional argument: bash uninstall.sh /path/to/install
#   2. CLAWNEX_INSTALL_DIR environment variable
#   3. Script's own parent directory (legacy default)
#
# Override modes added in v0.9.2 after a staging host re-wipe (2026-04-26) where
# the operator extracted a fresh tarball to /tmp and ran THAT copy of
# uninstall.sh. The legacy "derive from script location" logic happily wiped
# the new-tarball directory because that's where the script lived — leaving
# the live ~/sentinel install untouched. Always pass the target explicitly
# when running uninstall from outside the install you want to remove.
# =============================================================================

set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

BOX_W=48
repeat_box_char() {
    local char="$1" count="$2" i
    for ((i = 0; i < count; i++)); do
        printf '%s' "$char"
    done
}
box_rule() {
    local left="$1" fill="$2" right="$3"
    printf '%s' "$left"
    repeat_box_char "$fill" "$BOX_W"
    printf '%s\n' "$right"
}
box_line() {
    local text="$1" pad
    pad=$(( BOX_W - ${#text} ))
    [ "$pad" -lt 0 ] && pad=0
    printf '║%s%*s║\n' "$text" "$pad" ''
}
box_center() {
    local text="$1" total left right
    total=$(( BOX_W - ${#text} ))
    [ "$total" -lt 0 ] && total=0
    left=$(( total / 2 ))
    right=$(( total - left ))
    printf '║%*s%s%*s║\n' "$left" '' "$text" "$right" ''
}

# ---- argument / help handling --------------------------------------------
# --force-clean: skip all 3 confirm prompts AND default both preserve prompts
# to "no" (full nuke). Intended for scripted resets / CI / test harnesses.
# Operators running this by hand should never use this flag — the prompts
# exist for a reason. Documented in --help so the bypass mechanism is at
# least visible rather than hidden.
FORCE_CLEAN=false
ARCHIVE_DB=""
POSITIONAL=""
for arg in "$@"; do
    case "$arg" in
        -h|--help)
            cat <<USAGE
ClawNex uninstall

Usage:
  bash uninstall.sh                       # uninstall whichever install owns this script
  bash uninstall.sh /path/to/clawnex      # uninstall the install at the given path
  CLAWNEX_INSTALL_DIR=/path bash uninstall.sh
  bash uninstall.sh --force-clean /path   # NON-INTERACTIVE: skip all confirms,
                                          #   wipe everything (no preserved
                                          #   backups or docs). For automation
                                          #   only — be sure of the path.
  bash uninstall.sh --no-archive /path    # skip the pre-uninstall DB archive

Refuses to proceed if the resolved directory doesn't look like a ClawNex
install (must contain package.json with name "clawnex" or a recognizable
setup.sh).
USAGE
            exit 0
            ;;
        --force-clean)
            FORCE_CLEAN=true
            ;;
        --archive)
            ARCHIVE_DB="yes"
            ;;
        --no-archive)
            ARCHIVE_DB="no"
            ;;
        *)
            POSITIONAL="$arg"
            ;;
    esac
done

# Resolve INSTALL_DIR — explicit arg wins, then env var, then script location.
SCRIPT_LOCATION="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR_SOURCE="script location"
if [ -n "$POSITIONAL" ]; then
    if [ ! -d "$POSITIONAL" ]; then
        echo -e "\033[0;31m✗\033[0m Directory not found: $POSITIONAL"
        exit 1
    fi
    INSTALL_DIR="$(cd "$POSITIONAL" && pwd)"
    INSTALL_DIR_SOURCE="argument"
elif [ -n "${CLAWNEX_INSTALL_DIR:-}" ]; then
    if [ ! -d "$CLAWNEX_INSTALL_DIR" ]; then
        echo -e "\033[0;31m✗\033[0m CLAWNEX_INSTALL_DIR points at a non-existent directory: $CLAWNEX_INSTALL_DIR"
        exit 1
    fi
    INSTALL_DIR="$(cd "$CLAWNEX_INSTALL_DIR" && pwd)"
    INSTALL_DIR_SOURCE="CLAWNEX_INSTALL_DIR env"
else
    INSTALL_DIR="$SCRIPT_LOCATION"
fi

# Validate that the chosen directory actually looks like a ClawNex install.
# Refuse to proceed otherwise — better to fail loudly than to wipe the wrong
# directory (which is exactly the bug that prompted these overrides). Two
# acceptable markers: package.json identifying as clawnex/sentinel (the
# legacy package name from before the v0.9 rebrand still ships in
# package.json — accept either), OR a setup.sh that mentions ClawNex by name.
LOOKS_LIKE_CLAWNEX=0
if [ -f "${INSTALL_DIR}/package.json" ] && grep -qE '"name":[[:space:]]*"(clawnex|sentinel)"' "${INSTALL_DIR}/package.json" 2>/dev/null; then
    LOOKS_LIKE_CLAWNEX=1
elif [ -f "${INSTALL_DIR}/setup.sh" ] && grep -q -i "clawnex" "${INSTALL_DIR}/setup.sh" 2>/dev/null; then
    LOOKS_LIKE_CLAWNEX=1
fi
if [ "$LOOKS_LIKE_CLAWNEX" -ne 1 ]; then
    echo -e "\033[0;31m✗\033[0m '${INSTALL_DIR}' (resolved from ${INSTALL_DIR_SOURCE}) doesn't look like a ClawNex install."
    echo -e "  Expected to find \033[0;36mpackage.json\033[0m with name=clawnex, or \033[0;36msetup.sh\033[0m mentioning ClawNex."
    echo -e "  Pass the correct path explicitly: \033[0;36mbash uninstall.sh /home/you/sentinel\033[0m"
    exit 1
fi

if [ "$INSTALL_DIR" != "$SCRIPT_LOCATION" ]; then
    echo -e "\033[0;36mℹ\033[0m Using install dir from ${INSTALL_DIR_SOURCE}: \033[1;33m${INSTALL_DIR}\033[0m"
    echo -e "  (script lives at ${SCRIPT_LOCATION}, but operating on the path above)"
fi

CURRENT_SHELL_DIR="$(pwd -P 2>/dev/null || pwd 2>/dev/null || true)"
STARTED_INSIDE_INSTALL=0
if [ -n "$CURRENT_SHELL_DIR" ]; then
    case "${CURRENT_SHELL_DIR}/" in
        "${INSTALL_DIR}/"*) STARTED_INSIDE_INSTALL=1 ;;
    esac
fi

echo ""
echo -ne "${RED}"
box_rule "╔" "═" "╗"
box_center "CLAWNEX UNINSTALL"
box_center "This will remove the ClawNex installation."
box_center "A ClawNex Project"
box_rule "╚" "═" "╝"
echo -e "${NC}"
echo ""
echo -e "Installation directory: ${YELLOW}${INSTALL_DIR}${NC}"
if [ "$STARTED_INSIDE_INSTALL" -eq 1 ]; then
    echo ""
    echo -e "${YELLOW}!${NC} You are running uninstall from inside the ClawNex install directory."
    echo "  The uninstall will remove this directory. When it finishes, your shell"
    echo -e "  may still show a deleted path; run ${CYAN}cd ~${NC} to return home."
fi
echo ""

# ---- sudo wrapper -----------------------------------------------------------
# Steps below need root for systemd unit removal and Caddyfile cleanup. In
# interactive mode, plain `sudo` is fine — it'll prompt the operator. In
# non-interactive mode (--force-clean, or stdin not a tty) a sudo prompt
# would hang the script forever waiting on input that never comes (issue
# #29). Use `sudo -n` then, and degrade gracefully: warn once and skip the
# step rather than aborting the whole uninstall. Operators running this in
# CI / automation should pre-cache sudo (e.g. NOPASSWD in sudoers) or run
# the script as root directly.
if [ "$FORCE_CLEAN" = "true" ] || [ ! -t 0 ]; then
    SUDO_NONINTERACTIVE=1
else
    SUDO_NONINTERACTIVE=0
fi
SUDO_WARNED=0
_sudo() {
    if [ "$(id -u)" -eq 0 ]; then
        # Already root — sudo is a no-op, just exec.
        "$@"
        return $?
    fi
    if [ "$SUDO_NONINTERACTIVE" -eq 1 ]; then
        # SUDO_PASSWORD env (same contract as install-prod.sh) beats -n:
        # cached-timestamp sudo (-n) is keyed to the calling session's tty,
        # which a detached automation run doesn't have (live miss on the
        # 2026-06-13 Crucible installer test).
        if [ -n "${SUDO_PASSWORD:-}" ]; then
            if printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' "$@" 2>/dev/null; then
                return 0
            fi
        fi
        if ! sudo -n "$@" 2>/dev/null; then
            if [ "$SUDO_WARNED" -eq 0 ]; then
                echo -e "  ${YELLOW}!${NC} sudo unavailable non-interactively — skipping privileged cleanup steps."
                echo "    (systemd units / Caddyfile won't be removed; run manually as root if needed)"
                SUDO_WARNED=1
            fi
            # return 0, not 1: this script runs `set -e`, so a nonzero here
            # aborts the WHOLE uninstall at the first privileged step —
            # the opposite of the documented "warn and skip" intent
            # (live failure on the 2026-06-13 Crucible installer test).
            return 0
        fi
        return 0
    fi
    sudo "$@"
}

if [ "$FORCE_CLEAN" = "true" ]; then
    echo -e "${YELLOW}--force-clean active — skipping the 3 confirmation prompts.${NC}"
    echo -e "${YELLOW}Proceeding to wipe ${INSTALL_DIR} non-interactively.${NC}"
    echo ""
else
    # === LEVEL 1 ===
    echo -e "${YELLOW}CONFIRMATION 1 OF 3${NC}"
    read -p "Are you sure you want to uninstall ClawNex? (yes/no): " CONFIRM1
    if [ "$CONFIRM1" != "yes" ]; then
        echo "Uninstall cancelled."
        exit 0
    fi

    # === LEVEL 2 ===
    echo ""
    echo -e "${YELLOW}CONFIRMATION 2 OF 3${NC}"
    echo "This action will stop all services, remove source code, and delete node_modules."
    read -p "Type UNINSTALL in capitals to proceed: " CONFIRM2
    if [ "$CONFIRM2" != "UNINSTALL" ]; then
        echo "Uninstall cancelled. You typed: $CONFIRM2"
        exit 0
    fi

    # === LEVEL 3 ===
    echo ""
    echo -e "${RED}FINAL CONFIRMATION (3 OF 3)${NC}"
    echo -e "${RED}There is no undo. This removes ClawNex completely.${NC}"
    read -p "Type 'DO IT NOW' to execute the uninstall: " CONFIRM3
    if [ "$CONFIRM3" != "DO IT NOW" ]; then
        echo "Uninstall cancelled. You typed: $CONFIRM3"
        exit 0
    fi
fi

echo ""
echo -e "${YELLOW}Starting uninstall...${NC}"
echo ""

# Step 1: Archive database
echo "[1/8] Database archive..."
DB_ARCHIVE_CANDIDATES=()
for db in sentinel.db clawnex.db; do
    [ -f "${INSTALL_DIR}/${db}" ] && DB_ARCHIVE_CANDIDATES+=("${INSTALL_DIR}/${db}")
done
if [ "${#DB_ARCHIVE_CANDIDATES[@]}" -eq 0 ]; then
    echo "  - No database found"
else
    if [ -z "$ARCHIVE_DB" ]; then
        if [ "$FORCE_CLEAN" = "true" ]; then
            ARCHIVE_DB="no"
        else
            read -p "  Archive database before uninstall? (yes/no) [yes]: " ARCHIVE_DB
            ARCHIVE_DB=${ARCHIVE_DB:-yes}
        fi
    fi
    case "$ARCHIVE_DB" in
        yes|y|Y|YES)
            BACKUP_DIR="${INSTALL_DIR}/backups"
            mkdir -p "$BACKUP_DIR"
            TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
            for dbpath in "${DB_ARCHIVE_CANDIDATES[@]}"; do
                db="$(basename "$dbpath")"
                cp "$dbpath" "${BACKUP_DIR}/${db%.db}-pre-uninstall-${TIMESTAMP}.db"
                chmod 600 "${BACKUP_DIR}/${db%.db}-pre-uninstall-${TIMESTAMP}.db" 2>/dev/null || true
            done
            echo -e "  ${GREEN}✓${NC} Database archived to backups/"
            ;;
        no|n|N|NO)
            echo "  - Database archive skipped"
            ;;
        *)
            echo -e "  ${RED}✗${NC} Invalid archive choice: $ARCHIVE_DB"
            exit 1
            ;;
    esac
fi

# Step 2: Restore OpenClaw routing
echo "[2/8] Restoring OpenClaw routing..."
OC_RESTORED=0

# Find openclaw.json — same search order as setup.sh
OPENCLAW_PATH=""
if [ -n "$OPENCLAW_HOME" ] && [ -f "$OPENCLAW_HOME/openclaw.json" ]; then
    OPENCLAW_PATH="$OPENCLAW_HOME"
elif command -v openclaw &>/dev/null; then
    OC_CLI_DIR=$(openclaw --config-dir 2>/dev/null || echo "")
    if [ -n "$OC_CLI_DIR" ] && [ -f "$OC_CLI_DIR/openclaw.json" ]; then
        OPENCLAW_PATH="$OC_CLI_DIR"
    fi
fi
if [ -z "$OPENCLAW_PATH" ]; then
    for sp in "$HOME/.openclaw" "$HOME/openclaw" "/opt/openclaw" "$HOME/.config/openclaw"; do
        if [ -f "$sp/openclaw.json" ]; then
            OPENCLAW_PATH="$sp"
            break
        fi
    done
fi

if [ -n "$OPENCLAW_PATH" ]; then
    OC_JSON="$OPENCLAW_PATH/openclaw.json"
    OC_BAK="${OC_JSON}.bak"

    if [ -f "$OC_BAK" ]; then
        # Restore from the backup created during setup
        cp "$OC_BAK" "$OC_JSON"
        rm -f "$OC_BAK"
        echo -e "  ${GREEN}✓${NC} Restored openclaw.json from pre-ClawNex backup"
        OC_RESTORED=1
    else
        # No backup — revert proxy URLs back to original using Python
        OC_JSON_PATH="$OC_JSON" python3 -c "
import json, sys, os
oc_path = os.environ['OC_JSON_PATH']
try:
    with open(oc_path, 'r') as f:
        data = json.load(f)
    providers = data.get('models', {}).get('providers', {})
    changed = 0
    for pid, prov in providers.items():
        url = prov.get('baseUrl', '')
        if '127.0.0.1:4001' in url or 'localhost:4001' in url:
            print(f'  Reverted {pid}: {url} -> (cleared)')
            prov['baseUrl'] = ''
            changed += 1
    if changed > 0:
        with open(oc_path, 'w') as f:
            json.dump(data, f, indent=2)
        print(f'  Reverted {changed} provider(s) from proxy routing')
    else:
        print('  No proxy-routed providers found')
except Exception as e:
    print(f'  Warning: Could not revert routing: {e}', file=sys.stderr)
"
        echo -e "  ${YELLOW}!${NC} No backup found — cleared proxy URLs from openclaw.json"
        OC_RESTORED=1
    fi
else
    echo "  - OpenClaw installation not found — no routing to restore"
fi

# Step 3: Stop services & restart OpenClaw Gateway
echo "[3/8] Stopping ClawNex services..."

# Linux: stop and remove systemd services if present
if command -v systemctl &>/dev/null; then
    if systemctl list-unit-files 2>/dev/null | grep -q "clawnex-dashboard.service"; then
        _sudo systemctl disable --now clawnex-dashboard.service 2>/dev/null
        _sudo rm -f /etc/systemd/system/clawnex-dashboard.service 2>/dev/null
        echo -e "  ${GREEN}✓${NC} clawnex-dashboard systemd service removed"
    fi
    if systemctl list-unit-files 2>/dev/null | grep -q "clawnex-litellm.service"; then
        _sudo systemctl disable --now clawnex-litellm.service 2>/dev/null
        _sudo rm -f /etc/systemd/system/clawnex-litellm.service 2>/dev/null
        _sudo rm -f /etc/sudoers.d/clawnex-litellm 2>/dev/null
        echo -e "  ${GREEN}✓${NC} clawnex-litellm systemd service removed"
    fi
    if systemctl list-unit-files 2>/dev/null | grep -q "clawnex.service"; then
        _sudo systemctl disable --now clawnex.service 2>/dev/null
        _sudo rm -f /etc/systemd/system/clawnex.service 2>/dev/null
        echo -e "  ${GREEN}✓${NC} clawnex systemd service removed"
    fi
    _sudo systemctl daemon-reload 2>/dev/null
fi

kill $(lsof -ti :5001) 2>/dev/null && echo -e "  ${GREEN}✓${NC} Dashboard stopped" || echo "  - Dashboard not running"
kill $(lsof -ti :4001) 2>/dev/null && echo -e "  ${GREEN}✓${NC} LiteLLM stopped" || echo "  - LiteLLM not running"

# Restart OpenClaw Gateway so it picks up restored config
if launchctl list ai.openclaw.gateway &>/dev/null; then
    launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway" 2>/dev/null \
        || (launchctl stop ai.openclaw.gateway 2>/dev/null && launchctl start ai.openclaw.gateway 2>/dev/null)
    echo -e "  ${GREEN}✓${NC} OpenClaw Gateway restarted via launchd"
elif lsof -ti :18789 &>/dev/null; then
    echo -e "  ${YELLOW}!${NC} OpenClaw Gateway running (port 18789) but not managed by launchd"
    echo -e "    Please restart it manually to pick up restored routing"
else
    echo "  - OpenClaw Gateway not running"
fi

# Step 4: Remove ALL cron jobs (watchdog + daily backup)
echo "[4/8] Removing cron jobs..."
CRON_REMOVED=0
if crontab -l 2>/dev/null | grep -q "# clawnex-watchdog"; then
    # CX-G5 fix: target the exact "# clawnex-watchdog" marker stamped by
    # setup.sh, not the substring "watchdog" — otherwise an operator's
    # unrelated *watchdog cron entry gets removed too.
    crontab -l 2>/dev/null | grep -v "# clawnex-watchdog" | crontab -
    echo -e "  ${GREEN}✓${NC} Watchdog cron removed"
    CRON_REMOVED=1
fi
if crontab -l 2>/dev/null | grep -q "system/archive"; then
    crontab -l 2>/dev/null | grep -v "system/archive" | crontab -
    echo -e "  ${GREEN}✓${NC} Daily backup cron removed"
    CRON_REMOVED=1
fi
# Remove launchd agents if installed (dashboard + litellm)
for _plist in io.clawnex.dashboard.plist io.clawnex.litellm.plist; do
    if [ -f "$HOME/Library/LaunchAgents/$_plist" ]; then
        launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/$_plist" 2>/dev/null \
            || launchctl unload "$HOME/Library/LaunchAgents/$_plist" 2>/dev/null \
            || true   # plist present but not loaded — fine under set -e
        rm -f "$HOME/Library/LaunchAgents/$_plist"
        echo -e "  ${GREEN}✓${NC} LaunchAgent removed: $_plist"
        CRON_REMOVED=1
    fi
done
# Remove ClawNex-managed Caddyfile block (mac-server installs). Caddy itself
# is left alone — ClawNex didn't install the operator's other sites.
if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    _CADDYFILE="$(brew --prefix)/etc/Caddyfile"
    if [ -f "$_CADDYFILE" ] && grep -q '# >>> CLAWNEX MANAGED BLOCK >>>' "$_CADDYFILE"; then
        sed -i '' '/# >>> CLAWNEX MANAGED BLOCK >>>/,/# <<< CLAWNEX MANAGED BLOCK <<</d' "$_CADDYFILE"
        echo -e "  ${GREEN}✓${NC} ClawNex Caddyfile block removed"
        brew services restart caddy 2>/dev/null || true
    fi
fi
if [ "$CRON_REMOVED" = "0" ]; then
    echo "  - No cron jobs or launch agents found"
fi

# Step 4: Ask about preserving backups and docs
echo "[5/8] Preservation options..."
if [ "$FORCE_CLEAN" = "true" ]; then
    KEEP_BACKUPS=no
    KEEP_DOCS=no
else
    read -p "  Preserve database backups? (yes/no) [yes]: " KEEP_BACKUPS
    KEEP_BACKUPS=${KEEP_BACKUPS:-yes}
    read -p "  Preserve documentation? (yes/no) [yes]: " KEEP_DOCS
    KEEP_DOCS=${KEEP_DOCS:-yes}
fi

# Step 5a: Remove ClawNex-installed binaries outside the install dir
# These get installed by setup.sh into ~/.local/bin/ and aren't covered by
# the install-dir wipe. Per feedback_clawnex_cleanup_scope.md: anything
# ClawNex installs gets removed here. Adjacent products (OpenClaw, Hermes,
# paperclip) are explicitly NOT touched.
echo "[6a/8] Removing ClawNex binaries + Python deps + tarballs..."

# LiteLLM (pip-installed by setup.sh). On Ubuntu 24 / modern Debian / Homebrew
# Python the system interpreter is "externally-managed" — `pip uninstall`
# refuses without --break-system-packages. Without that flag the uninstall
# fails silently, the Python module stays registered, and a subsequent
# setup.sh thinks LiteLLM is "already installed" via importlib.metadata —
# but the CLI binary at ~/.local/bin/litellm has been rm'd in the next line,
# leading to a crash at step 10's `which litellm`. Probe support and pass
# the flag if available; older pips that don't know it just see an unknown
# arg and do their normal thing.
PIP_UNINSTALL_FLAGS=""
if command -v pip3 &>/dev/null; then
    if pip3 install --help 2>/dev/null | grep -q -- '--break-system-packages'; then
        PIP_UNINSTALL_FLAGS="--break-system-packages"
    fi
    pip3 uninstall -y $PIP_UNINSTALL_FLAGS litellm 2>&1 | tail -1 || echo "  - pip3 uninstall litellm failed (may not be installed)"
elif command -v pip &>/dev/null; then
    if pip install --help 2>/dev/null | grep -q -- '--break-system-packages'; then
        PIP_UNINSTALL_FLAGS="--break-system-packages"
    fi
    pip uninstall -y $PIP_UNINSTALL_FLAGS litellm 2>&1 | tail -1 || echo "  - pip uninstall litellm failed (may not be installed)"
fi
rm -f "$HOME/.local/bin/litellm" 2>/dev/null
if [ -e "$HOME/.local/bin/clawnex" ] || [ -L "$HOME/.local/bin/clawnex" ]; then
    rm -f "$HOME/.local/bin/clawnex" 2>/dev/null && echo "  ✓ removed $HOME/.local/bin/clawnex"
fi

# Clawkeeper (curl|bash installer drops here per the upstream script)
for f in "$HOME/.local/bin/clawkeeper.sh" "$HOME/.local/bin/clawkeeper" \
         "$HOME/.local/bin/defenseclaw.sh" "$HOME/.local/bin/defenseclaw"; do
    [ -e "$f" ] && rm -f "$f" && echo "  ✓ removed $f"
done
for d in "$HOME/.clawkeeper" "$HOME/.defenseclaw" "$HOME/.config/clawkeeper" "$HOME/.config/defenseclaw"; do
    [ -d "$d" ] && rm -rf "$d" && echo "  ✓ removed $d"
done

# ClawNex Caddyfile (only the file ClawNex wrote; leave caddy package alone)
if [ -f /etc/caddy/Caddyfile ] && grep -q "CLAWNEX-MANAGED" /etc/caddy/Caddyfile 2>/dev/null; then
    # CX-G5 fix: only remove Caddyfiles stamped with the CLAWNEX-MANAGED
    # marker (written by deploy/install-prod.sh). The previous heuristic —
    # "if file contains 127.0.0.1:5001 then it's ours" — could remove a
    # repurposed Caddyfile that happened to proxy that local port.
    _sudo rm -f /etc/caddy/Caddyfile && echo "  ✓ /etc/caddy/Caddyfile removed (CLAWNEX-MANAGED marker confirmed)"
fi

# ClawNex tarballs (only the canonical installer artifacts — leave any
# operator-named staging tarballs alone). The legitimate names this layer
# knows about:
#   - /tmp/clawnex-deploy.tar.gz                    (from deploy/transfer.sh)
#   - $HOME/clawnex-deploy.tar.gz                   (manual scp landing pad)
#   - clawnex-vX.Y.Z[-suffix]-deploy.tar.gz         (versioned releases)
#   - clawnex-vX.Y.Z[-suffix]-macos.tar.gz          (Mac packages)
#   - clawnex-vX.Y.Z[-suffix]-showcase.tar.gz       (showcase bundles)
# A wildcard like clawnex-*.tar.gz scoops up things like
# "clawnex-staging-build.tar.gz" or "clawnex-mytest.tar.gz" that the operator
# left around — see issue #28. Only remove what we know we wrote.
shopt -s nullglob
for dir in "$HOME" /tmp; do
    for f in "$dir"/clawnex-deploy.tar.gz \
             "$dir"/clawnex-v*-deploy.tar.gz \
             "$dir"/clawnex-v*-macos.tar.gz \
             "$dir"/clawnex-v*-showcase.tar.gz; do
        [ -e "$f" ] && rm -f "$f" && echo "  ✓ removed $f"
    done
done
shopt -u nullglob

# Step 5b: Remove installation files inside the install dir
echo "[6b/8] Removing installation files..."
if [ "$STARTED_INSIDE_INSTALL" -eq 1 ]; then
    cd "$HOME" 2>/dev/null || cd / 2>/dev/null || true
fi
rm -rf "${INSTALL_DIR}/.next" && echo "  - Removed .next"
rm -rf "${INSTALL_DIR}/node_modules" && echo "  - Removed node_modules"
rm -rf "${INSTALL_DIR}/src" && echo "  - Removed src/"
rm -rf "${INSTALL_DIR}/public" && echo "  - Removed public/"
rm -rf "${INSTALL_DIR}/deploy" && echo "  - Removed deploy/"
rm -rf "${INSTALL_DIR}/litellm" && echo "  - Removed litellm/"
rm -f "${INSTALL_DIR}/sentinel.db" "${INSTALL_DIR}/sentinel.db-wal" "${INSTALL_DIR}/sentinel.db-shm"
rm -f "${INSTALL_DIR}/clawnex.db" "${INSTALL_DIR}/clawnex.db-wal" "${INSTALL_DIR}/clawnex.db-shm"
rm -f "${INSTALL_DIR}/package.json" "${INSTALL_DIR}/package-lock.json" "${INSTALL_DIR}/tsconfig.json"
rm -f "${INSTALL_DIR}/next.config.mjs" "${INSTALL_DIR}/tailwind.config.ts" "${INSTALL_DIR}/postcss.config.mjs"
rm -f "${INSTALL_DIR}/.env" "${INSTALL_DIR}/.env.local" "${INSTALL_DIR}/.gitignore"
rm -f "${INSTALL_DIR}/setup.sh" "${INSTALL_DIR}/start.sh" "${INSTALL_DIR}/stop.sh"
rm -f "${INSTALL_DIR}/next-env.d.ts"
echo -e "  ${GREEN}✓${NC} Source files removed"

# Step 6: Remove optional directories based on user choice
echo "[7/8] Cleaning up..."
if [ "$KEEP_BACKUPS" != "yes" ]; then
    rm -rf "${INSTALL_DIR}/backups"
    echo "  - Removed backups/"
else
    echo -e "  ${GREEN}✓${NC} Backups preserved at ${INSTALL_DIR}/backups/"
fi

if [ "$KEEP_DOCS" != "yes" ]; then
    rm -rf "${INSTALL_DIR}/docs"
    echo "  - Removed docs/"
else
    echo -e "  ${GREEN}✓${NC} Docs preserved at ${INSTALL_DIR}/docs/"
fi

rm -rf "${INSTALL_DIR}/logs" && echo "  - Removed logs/"
rm -rf "${INSTALL_DIR}/scripts" && echo "  - Removed scripts/"

# Step 7: Remove the directory if empty (or nearly empty)
echo "[8/8] Final cleanup..."
REMAINING=$(find "${INSTALL_DIR}" -maxdepth 1 -not -name "." -not -name ".." | wc -l | tr -d ' ')
if [ "$REMAINING" = "0" ]; then
    rmdir "${INSTALL_DIR}" 2>/dev/null
    echo -e "  ${GREEN}✓${NC} Installation directory removed"
elif [ "$KEEP_BACKUPS" != "yes" ] && [ "$KEEP_DOCS" != "yes" ]; then
    # Nothing preserved — remove the whole directory
    rm -rf "${INSTALL_DIR}"
    echo -e "  ${GREEN}✓${NC} Installation directory removed"
elif [ "$REMAINING" -le "2" ]; then
    echo -e "  ${YELLOW}!${NC} ${REMAINING} items remain in ${INSTALL_DIR}/"
    ls -la "${INSTALL_DIR}/" 2>/dev/null | tail -5
else
    echo -e "  ${YELLOW}!${NC} ${REMAINING} items remain in ${INSTALL_DIR}/"
fi

echo ""
echo -ne "${GREEN}"
box_rule "╔" "═" "╗"
box_center "ClawNex has been uninstalled."
box_rule "╚" "═" "╝"
echo -e "${NC}"
echo ""
if [ "$KEEP_BACKUPS" = "yes" ] || [ "$KEEP_DOCS" = "yes" ]; then
    echo -e "Preserved:"
    [ "$KEEP_BACKUPS" = "yes" ] && echo -e "  ${YELLOW}${INSTALL_DIR}/backups/${NC}"
    [ "$KEEP_DOCS" = "yes" ] && echo -e "  ${YELLOW}${INSTALL_DIR}/docs/${NC}"
    echo ""
    echo -e "To fully remove everything: ${RED}rm -rf ${INSTALL_DIR}${NC}"
else
    echo "All ClawNex files have been removed."
fi
if [ "$STARTED_INSIDE_INSTALL" -eq 1 ]; then
    echo ""
    echo -e "${YELLOW}!${NC} Your shell was launched from inside the removed install directory."
    echo "  Run this now to return to a valid directory:"
    echo -e "    ${CYAN}cd ~${NC}"
fi
echo ""
