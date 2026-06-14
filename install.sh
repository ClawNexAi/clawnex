#!/bin/bash
# =============================================================================
# ClawNex Installer — single entry point for every supported target.
#
# Modes:
#   vps         Linux VPS — systemd + Caddy + Let's Encrypt + UFW
#   mac-local   macOS — launchd keep-alive, dashboard on localhost
#   mac-server  macOS — launchd + Homebrew Caddy + domain TLS
#
# Interactive: bash install.sh
# Non-interactive (QA/CI):
#   bash install.sh --mode vps|mac-local|mac-server --domain X \
#        --provider openrouter|anthropic|openai|nvidia|skip \
#        [--provider-url URL] [--provider-model MODEL] [--provider-key-env VAR] \
#        [--local-auth rbac|off] [--clean] [--yes]
#
# Phase 0 detects prior ClawNex artifacts and — only with consent
# (interactive y, or --clean) — removes them via scripts/uninstall.sh,
# archiving any database to ~/clawnex-pre-install-backup-* first.
# =============================================================================

set -euo pipefail

# ---- Colors -----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---- Helpers ---------------------------------------------------------------

die() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
ok()  { echo -e "  ${GREEN}✓${NC} $*"; }
warn(){ echo -e "  ${YELLOW}!${NC} $*"; }
info(){ echo -e "  ${CYAN}•${NC} $*"; }

# Read prompts robustly across three invocation shapes:
#   1. Direct invocation in a terminal           — stdin is a TTY, just use stdin/stdout
#   2. Piped invocation in a terminal (curl|bash) — stdin is the pipe, but /dev/tty works
#   3. Non-interactive (CI / headless SSH)         — no TTY anywhere, read from stdin
_tty_read() {
    local _prompt="$1"
    local _var="$2"
    if [ -t 0 ]; then
        printf "%s" "$_prompt"
        IFS= read -r "$_var"
    elif [ -c /dev/tty ] && { : >/dev/tty; } 2>/dev/null; then
        printf "%s" "$_prompt" > /dev/tty
        IFS= read -r "$_var" < /dev/tty
    else
        printf "%s" "$_prompt"
        IFS= read -r "$_var"
    fi
}

_can_prompt() {
    [ -t 0 ] && return 0
    [ -c /dev/tty ] && { : >/dev/tty; } 2>/dev/null
}

# Port-in-use probe: ss on Linux (lsof misses binds on Ubuntu 24), lsof on macOS.
_port_in_use() {
    local _port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${_port}\$"
    else
        lsof -ti :"$_port" >/dev/null 2>&1
    fi
}

_p0_macos_stop_clawnex_launchd() {
    [ "${OS:-}" = "macos" ] || return 0
    local _uid _label _plist
    _uid="$(id -u)"
    for _label in io.clawnex.dashboard io.clawnex.litellm; do
        _plist="$HOME/Library/LaunchAgents/${_label}.plist"
        # Different macOS releases accept different bootout targets. Try the
        # loaded service label first, then the plist path, then legacy unload.
        # Remove the plist afterward so KeepAlive cannot resurrect the process.
        launchctl bootout "gui/${_uid}/${_label}" 2>/dev/null || true
        if [ -f "$_plist" ]; then
            launchctl bootout "gui/${_uid}" "$_plist" 2>/dev/null \
                || launchctl unload "$_plist" 2>/dev/null \
                || true
            rm -f "$_plist" 2>/dev/null || true
        fi
        launchctl remove "$_label" 2>/dev/null || true
    done
}

_p0_macos_kill_install_port_owners() {
    [ "${OS:-}" = "macos" ] || return 0
    local _port _pid _cwd _cmd _round
    for _round in term kill; do
        for _port in 5001 4001; do
            while IFS= read -r _pid; do
                [ -n "$_pid" ] || continue
                _cwd="$(lsof -a -p "$_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
                _cmd="$(ps -p "$_pid" -o command= 2>/dev/null || true)"
                if [ "$_cwd" = "$INSTALL_DIR" ] || printf '%s\n' "$_cmd" | grep -Fq "$INSTALL_DIR/"; then
                    if [ "$_round" = "term" ]; then
                        kill "$_pid" 2>/dev/null || true
                    else
                        kill -9 "$_pid" 2>/dev/null || true
                    fi
                fi
            done < <(lsof -ti :"$_port" 2>/dev/null || true)
        done
        sleep 1
    done
}

# ---- Re-exec under modern bash (stock macOS ships bash 3.2) -----------------
# This script AND the engine use bash-4 features. Critically, install.sh's
# own body has $(case ... ) command substitutions whose `)` case-patterns
# bash 3.2's parser mishandles ("syntax error near unexpected token newline").
# Re-exec the WHOLE installer under a brew/MacPorts bash >=4, located by
# absolute path so the operator never has to repair PATH. BASH_VERSINFO guards
# against a re-exec loop (the second pass is already >=4). 3.2 parses commands
# incrementally, so it reaches this exec before ever parsing the line-377
# construct that breaks it.
if [ "$(uname -s)" = "Darwin" ] && [ "${BASH_VERSINFO:-0}" -lt 4 ]; then
    for _cand in /opt/homebrew/bin/bash /usr/local/bin/bash /opt/local/bin/bash; do
        if [ -x "$_cand" ] && [ "$("$_cand" -c 'echo "${BASH_VERSINFO[0]}"' 2>/dev/null || echo 0)" -ge 4 ]; then
            exec "$_cand" "$0" "$@"
        fi
    done
    echo -e "${RED}✗${NC} bash 4+ required (stock macOS ships 3.2)." >&2
    if command -v brew >/dev/null 2>&1; then
        echo "  Fix: brew install bash   — then re-run: bash install.sh" >&2
    else
        echo "  Fix (two steps):" >&2
        echo "    1. Install Homebrew (also used for ClawNex dependencies):" >&2
        echo '         /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' >&2
        echo "       ...then run the two 'eval' lines it prints." >&2
        echo "    2. brew install bash   — then re-run: bash install.sh" >&2
    fi
    exit 1
fi

# ---- Banner + OS detect ----------------------------------------------------

echo -e "${CYAN}${BOLD}"
cat <<'EOF'
╔══════════════════════════════════════════════════════╗
║         ClawNex Installer                            ║
║         A ProBizSystems Product                      ║
╚══════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

case "$(uname -s)" in
    Linux)  OS=linux ;;
    Darwin) OS=macos ;;
    *)      die "Unsupported OS: $(uname -s). Need Linux or macOS." ;;
esac

cd "$(dirname "$0")"
INSTALL_DIR="$(pwd)"
[ -f package.json ]  || die "Not in a ClawNex source dir ($INSTALL_DIR). Missing package.json."
[ -f .env.example ]  || die ".env.example missing — incomplete source tree."
[ -f setup.sh ]      || die "setup.sh missing — incomplete source tree."

# Past the re-exec gate above we are guaranteed bash >= 4. The engine and
# service layers still spawn `bash` from PATH (3.2 on macOS), so hand them
# the modern bash we're actually running under.
ENGINE_BASH="${BASH:-bash}"

# ---- Flags -------------------------------------------------------------------
FLAG_MODE=""; FLAG_DOMAIN=""; FLAG_PROVIDER=""; FLAG_PROVIDER_URL=""; FLAG_PROVIDER_MODEL=""; FLAG_KEY_ENV=""; FLAG_LOCAL_AUTH=""
FLAG_CLEAN=0; FLAG_YES=0
while [ $# -gt 0 ]; do
    case "$1" in
        --mode)             FLAG_MODE="${2:-}"; shift 2 ;;
        --domain)           FLAG_DOMAIN="${2:-}"; shift 2 ;;
        --provider)         FLAG_PROVIDER="${2:-}"; shift 2 ;;
        --provider-url)     FLAG_PROVIDER_URL="${2:-}"; shift 2 ;;
        --provider-model)   FLAG_PROVIDER_MODEL="${2:-}"; shift 2 ;;
        --provider-key-env) FLAG_KEY_ENV="${2:-}"; shift 2 ;;
        --local-auth)       FLAG_LOCAL_AUTH="${2:-}"; shift 2 ;;
        --clean)            FLAG_CLEAN=1; shift ;;
        --yes|-y)           FLAG_YES=1; shift ;;
        -h|--help)
            sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown flag: $1 (see --help)" ;;
    esac
done

# ---- Phase 0: clean-slate preflight -------------------------------------------
# Rule: if ClawNex installed it, remove it; if ClawNex did not, leave it
# alone. Removal is scripts/uninstall.sh — the ONE removal code path — which
# also restores OpenClaw routing from its first-touch backup. Never silent:
# interactive consent or an explicit --clean flag is required.
echo -e "${BOLD}[0/5] Clean-slate preflight${NC}"

P0_FOUND=()
P0_EXISTING_DIR=""
P0_CURRENT_ARTIFACTS=()
P0_STALE_PATHS=()
# systemd units (Linux). Capture-then-test: `grep -q` directly on a
# systemctl pipe SIGPIPEs systemctl under pipefail and silently reads as
# "no units" (live false-negative on the first Crucible run, 2026-06-13).
if [ "$OS" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
    P0_UNITS="$(systemctl list-unit-files --no-pager --no-legend 2>/dev/null | awk '/^clawnex/{print $1}' | tr '\n' ' ' || true)"
    if [ -n "${P0_UNITS// /}" ]; then
        P0_FOUND+=("systemd units: $P0_UNITS")
        P0_EXISTING_DIR="$(systemctl cat clawnex-dashboard 2>/dev/null | grep -m1 '^WorkingDirectory=' | cut -d= -f2 || true)"
    fi
fi
# launchd agents (macOS)
if [ "$OS" = "macos" ]; then
    for pl in "$HOME/Library/LaunchAgents"/io.clawnex.*.plist; do
        [ -f "$pl" ] || continue
        P0_FOUND+=("launchd agent: $pl")
        if [ -z "$P0_EXISTING_DIR" ]; then
            P0_EXISTING_DIR="$(/usr/libexec/PlistBuddy -c 'Print WorkingDirectory' "$pl" 2>/dev/null || true)"
        fi
    done
fi
# CLI symlink created by setup.sh. If it points at a prior install, that target
# is install evidence even when launchd plists are gone. If it is broken, it is
# still a ClawNex artifact and should be removed during clean-slate.
P0_CLI="$HOME/.local/bin/clawnex"
if [ -e "$P0_CLI" ] || [ -L "$P0_CLI" ]; then
    P0_CLI_TARGET="$(readlink "$P0_CLI" 2>/dev/null || true)"
    if [ -n "$P0_CLI_TARGET" ]; then
        case "$P0_CLI_TARGET" in
            /*) ;;
            *) P0_CLI_TARGET="$(cd "$(dirname "$P0_CLI")" 2>/dev/null && cd "$(dirname "$P0_CLI_TARGET")" 2>/dev/null && pwd)/$(basename "$P0_CLI_TARGET")" ;;
        esac
        P0_CLI_DIR="$(cd "$(dirname "$P0_CLI_TARGET")" 2>/dev/null && pwd || true)"
        if [ -n "$P0_CLI_DIR" ] && [ "$P0_CLI_DIR" != "$INSTALL_DIR" ] && [ -f "$P0_CLI_DIR/setup.sh" ] && grep -qi 'clawnex' "$P0_CLI_DIR/setup.sh" 2>/dev/null; then
            [ -z "$P0_EXISTING_DIR" ] && P0_EXISTING_DIR="$P0_CLI_DIR"
            P0_FOUND+=("clawnex CLI symlink: $P0_CLI -> $P0_CLI_TARGET")
        elif [ ! -e "$P0_CLI_TARGET" ]; then
            P0_STALE_PATHS+=("$P0_CLI")
            P0_FOUND+=("stale clawnex CLI symlink: $P0_CLI -> $P0_CLI_TARGET")
        fi
    else
        P0_STALE_PATHS+=("$P0_CLI")
        P0_FOUND+=("clawnex CLI artifact: $P0_CLI")
    fi
fi

# well-known install dirs (covers service-less prior installs).
# Keep this conservative. A developer source checkout named ~/sentinel with a
# .env.local is not proof that the single installer owns that directory. Service
# metadata above still detects real legacy installs that launchd/systemd points
# at, including old ~/sentinel installs.
for _wkd in "$HOME/clawnex" "$HOME"/clawnex-v*-deploy "$HOME"/clawnex-v*-macos; do
    [ -d "$_wkd" ] || continue
    if [ -z "$P0_EXISTING_DIR" ] && [ -f "$_wkd/.env.local" ] && [ "$_wkd" != "$INSTALL_DIR" ]; then
        P0_EXISTING_DIR="$_wkd"
    fi
done
# Last-resort: derive the install dir from whoever owns port 5001 — the
# running service knows where it lives (/proc/PID/cwd). Linux only.
if [ -z "$P0_EXISTING_DIR" ] && [ "$OS" = "linux" ]; then
    P0_PID="$(ss -tlnp 2>/dev/null | awk '/:5001 /{match($0,/pid=[0-9]+/); if (RSTART) print substr($0,RSTART+4,RLENGTH-4)}' | head -1 || true)"
    if [ -n "$P0_PID" ] && [ -e "/proc/$P0_PID/cwd" ]; then
        P0_CWD="$(readlink "/proc/$P0_PID/cwd" 2>/dev/null || true)"
        if [ -n "$P0_CWD" ] && [ -f "$P0_CWD/.env.local" ] && [ "$P0_CWD" != "$INSTALL_DIR" ]; then
            P0_EXISTING_DIR="$P0_CWD"
        fi
    fi
fi
# Same last-resort for macOS when launchd metadata is missing but a previous
# dashboard still owns :5001. lsof can tell us the cwd of the process.
if [ -z "$P0_EXISTING_DIR" ] && [ "$OS" = "macos" ]; then
    P0_PID="$(lsof -ti :5001 2>/dev/null | head -1 || true)"
    if [ -n "$P0_PID" ]; then
        P0_CWD="$(lsof -a -p "$P0_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
        if [ -n "$P0_CWD" ] && [ -f "$P0_CWD/.env.local" ] && [ "$P0_CWD" != "$INSTALL_DIR" ]; then
            P0_EXISTING_DIR="$P0_CWD"
        fi
    fi
fi
if [ -n "$P0_EXISTING_DIR" ] && [ -d "$P0_EXISTING_DIR" ]; then
    P0_FOUND+=("install dir: $P0_EXISTING_DIR")
fi
# Current extracted tree: preserve source files, but treat runtime leftovers
# from a failed/partial install as dirty. The Mac retry path can otherwise say
# "Host is clean" while logs/, .env.local, node_modules/, or a half-built .next/
# are still sitting beside install.sh.
for _rel in .env .env.local .next node_modules logs sentinel.db clawnex.db sentinel.db-wal sentinel.db-shm clawnex.db-wal clawnex.db-shm; do
    if [ -e "$INSTALL_DIR/$_rel" ]; then
        P0_CURRENT_ARTIFACTS+=("$_rel")
    fi
done
# listeners
for p in 5001 4001; do
    if _port_in_use "$p"; then P0_FOUND+=("port $p in use"); fi
done
# Caddyfile marker block
P0_CADDY_CANDIDATES="/etc/caddy/Caddyfile"
if [ "$OS" = "macos" ] && command -v brew >/dev/null 2>&1; then
    P0_CADDY_CANDIDATES="$P0_CADDY_CANDIDATES $(brew --prefix)/etc/Caddyfile"
fi
for cf in $P0_CADDY_CANDIDATES; do
    [ -f "$cf" ] || continue
    if grep -q 'CLAWNEX MANAGED BLOCK\|# ClawNex' "$cf" 2>/dev/null; then
        P0_FOUND+=("Caddyfile block: $cf")
    fi
done

IN_PLACE=0
if [ -n "$P0_EXISTING_DIR" ] && [ "$P0_EXISTING_DIR" = "$INSTALL_DIR" ]; then IN_PLACE=1; fi
if [ -f "$INSTALL_DIR/sentinel.db" ] || [ -f "$INSTALL_DIR/clawnex.db" ]; then IN_PLACE=1; fi
if [ "${#P0_CURRENT_ARTIFACTS[@]}" -gt 0 ]; then IN_PLACE=1; fi

if [ "${#P0_FOUND[@]}" -eq 0 ] && [ "$IN_PLACE" = "0" ]; then
    ok "Host is clean — no prior ClawNex artifacts"
else
    echo "  Existing ClawNex artifacts detected:"
    if [ "${#P0_FOUND[@]}" -gt 0 ]; then
        for f in "${P0_FOUND[@]}"; do echo "    • $f"; done
    fi
    if [ "${#P0_CURRENT_ARTIFACTS[@]}" -gt 0 ]; then
        echo "    • runtime artifacts in THIS directory: ${P0_CURRENT_ARTIFACTS[*]}"
    elif [ "$IN_PLACE" = "1" ]; then
        echo "    • database in THIS directory (in-place reinstall)"
    fi
    echo ""
    P0_CONSENT="N"
    if [ "$FLAG_CLEAN" = "1" ]; then
        P0_CONSENT="y"
    elif [ "$FLAG_YES" = "1" ]; then
        die "Artifacts found but --clean not passed. Re-run with --clean to consent to removal."
    else
        _tty_read "  Remove existing ClawNex and continue? (y/N): " P0_CONSENT
    fi
    case "${P0_CONSENT:-N}" in
        y|Y|yes|YES) ;;
        *) die "Aborted — host not clean and no consent to remove. Nothing was changed." ;;
    esac

    # Archive any DB OUTSIDE the install tree (uninstall --force-clean nukes
    # the in-tree backups/ dir, so an in-tree archive would die with it).
    TS="$(date +%Y-%m-%d_%H-%M-%S)"
    for dbdir in "$P0_EXISTING_DIR" "$INSTALL_DIR"; do
        [ -n "$dbdir" ] || continue
        [ -d "$dbdir" ] || continue
        for db in sentinel.db clawnex.db; do
            if [ -f "$dbdir/$db" ]; then
                cp "$dbdir/$db" "$HOME/clawnex-pre-install-backup-${TS}-${db}"
                chmod 600 "$HOME/clawnex-pre-install-backup-${TS}-${db}"
                ok "DB archived → ~/clawnex-pre-install-backup-${TS}-${db}"
            fi
        done
    done

    if [ "$IN_PLACE" = "1" ] && { [ -z "$P0_EXISTING_DIR" ] || [ "$P0_EXISTING_DIR" = "$INSTALL_DIR" ]; }; then
        # Installing over the same extracted tree: do NOT uninstall (it would
        # delete the very files we're installing from). Stop services, archive
        # any DB above, then remove runtime artifacts so failed installs cannot
        # poison the next run. Source dirs/scripts stay intact.
        if [ "$OS" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
            sudo systemctl stop clawnex-dashboard clawnex-litellm 2>/dev/null || true
        fi
        if [ "$OS" = "macos" ]; then
            _p0_macos_stop_clawnex_launchd
            _p0_macos_kill_install_port_owners
        fi
        rm -rf \
            "$INSTALL_DIR/.next" \
            "$INSTALL_DIR/node_modules" \
            "$INSTALL_DIR/logs" \
            "$INSTALL_DIR/.env" \
            "$INSTALL_DIR/.env.local"
        rm -f \
            "$INSTALL_DIR/sentinel.db" "$INSTALL_DIR/sentinel.db-wal" "$INSTALL_DIR/sentinel.db-shm" \
            "$INSTALL_DIR/clawnex.db" "$INSTALL_DIR/clawnex.db-wal" "$INSTALL_DIR/clawnex.db-shm"
        ok "In-place retry: runtime artifacts removed; source tree preserved"
    elif [ -n "$P0_EXISTING_DIR" ] && [ -d "$P0_EXISTING_DIR" ]; then
        # Always THIS tree's uninstall.sh: newest removal logic (incl.
        # SUDO_PASSWORD support) against the detected install. Tolerate a
        # nonzero exit — older artifact mixes can fail individual steps;
        # Phase 0 success is decided by the re-scan below, not this rc.
        info "Removing prior install via uninstall.sh (--force-clean)..."
        "$ENGINE_BASH" "$INSTALL_DIR/scripts/uninstall.sh" --force-clean "$P0_EXISTING_DIR" \
            || warn "uninstall exited nonzero — privileged sweep + re-scan validate the end state"
    fi

    for stale_path in "${P0_STALE_PATHS[@]}"; do
        rm -f "$stale_path" 2>/dev/null || true
    done

    # Privileged sweep: older uninstalls can't sudo non-interactively
    # (sudo -n timestamps are tty-keyed and a detached installer has no
    # tty), which leaves systemd units running. When SUDO_PASSWORD is
    # available, finish that job here — only ClawNex-named artifacts.
    if [ "$OS" = "linux" ] && command -v systemctl >/dev/null 2>&1 && [ -n "${SUDO_PASSWORD:-}" ]; then
        _p0_sudo() { printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' "$@" 2>/dev/null; }
        for u in clawnex-dashboard clawnex-litellm; do
            _p0_sudo systemctl stop "$u" || true
            _p0_sudo systemctl disable "$u" || true
            _p0_sudo rm -f "/etc/systemd/system/${u}.service" || true
        done
        _p0_sudo systemctl daemon-reload || true
        ok "Privileged sweep: clawnex systemd units stopped + removed"
    fi

    # Re-scan: ports free AND no leftover install tree
    sleep 2
    for p in 5001 4001; do
        if _port_in_use "$p"; then
            die "Port $p still in use after cleanup — investigate before reinstalling (lsof -i :$p)"
        fi
    done
    if [ "$IN_PLACE" = "0" ] && [ -n "$P0_EXISTING_DIR" ] && [ -f "$P0_EXISTING_DIR/.env.local" ]; then
        die "Prior install tree still present at $P0_EXISTING_DIR after cleanup — investigate before reinstalling"
    fi
    for stale_path in "${P0_STALE_PATHS[@]}"; do
        if [ -e "$stale_path" ] || [ -L "$stale_path" ]; then
            die "Stale ClawNex artifact still present after cleanup: $stale_path"
        fi
    done
    ok "Clean-slate verified"
fi

# ---- [1/5] Mode ----------------------------------------------------------------
echo ""
echo -e "${BOLD}[1/5] Install mode${NC}"
echo "  Detected OS: $OS"
if [ -n "$FLAG_MODE" ]; then
    MODE="$FLAG_MODE"
else
    echo ""
    if [ "$OS" = "linux" ]; then
        echo "  Suggested deployment approach:"
        echo "    [1] VPS server — systemd + Caddy + Let's Encrypt + UFW"
        echo ""
        if [ "$FLAG_YES" = "1" ]; then
            info "--yes supplied; accepting suggested VPS server install"
            MODE="vps"
        elif _can_prompt; then
            MODE_CONFIRM=""
            _tty_read "  Use this approach? (Y/n): " MODE_CONFIRM
            case "${MODE_CONFIRM:-Y}" in
                y|Y|yes|YES) MODE="vps" ;;
                n|N|no|NO)
                    echo "  Cancelled. Re-run with --mode vps when you want the VPS server install."
                    exit 0
                    ;;
                *) die "Invalid choice: $MODE_CONFIRM. Enter Y or n." ;;
            esac
        else
            die "No TTY available to confirm detected Linux install mode. Re-run with --mode vps for automation."
        fi
    else
        echo "  How should ClawNex run on this Mac?"
        echo "    [1] Local   — dashboard on localhost, launchd keep-alive (most operators)"
        echo "    [2] Server  — public domain + Caddy + TLS on this Mac"
        echo ""
        MAC_PICK=""
        _tty_read "  Select (1/2) [1]: " MAC_PICK
        case "${MAC_PICK:-1}" in
            2) MODE="mac-server" ;;
            *) MODE="mac-local" ;;
        esac
    fi
fi
case "$MODE" in
    vps)        [ "$OS" = "linux" ] || die "--mode vps requires Linux (you're on $OS)" ;;
    mac-local|mac-server) [ "$OS" = "macos" ] || die "--mode $MODE requires macOS (you're on $OS)" ;;
    *) die "Invalid mode: $MODE (vps|mac-local|mac-server)" ;;
esac
ok "Mode: $MODE"

LOCAL_AUTH_MODE="1"
LOCAL_AUTH_LABEL="RBAC on"
if [ -n "$FLAG_LOCAL_AUTH" ] && [ "$MODE" != "mac-local" ]; then
    die "--local-auth only applies to --mode mac-local"
fi
if [ "$MODE" = "mac-local" ]; then
    if [ -n "$FLAG_LOCAL_AUTH" ]; then
        case "$FLAG_LOCAL_AUTH" in
            rbac|on|yes|true|1) LOCAL_AUTH_MODE="1"; LOCAL_AUTH_LABEL="RBAC on" ;;
            off|none|no|false|0) LOCAL_AUTH_MODE="2"; LOCAL_AUTH_LABEL="RBAC off" ;;
            *) die "--local-auth must be rbac|off" ;;
        esac
    elif [ "$FLAG_YES" = "1" ]; then
        info "--yes supplied; using Local auth default: RBAC on"
        LOCAL_AUTH_MODE="1"
        LOCAL_AUTH_LABEL="RBAC on"
    else
        echo ""
        echo "  Local authentication:"
        echo "    [1] RBAC on  — first-admin setup, operators, sessions (recommended)"
        echo "    [2] RBAC off — localhost-only, no login/setup wizard"
        echo ""
        LOCAL_AUTH_PICK=""
        _tty_read "  Select local auth mode (1/2) [1]: " LOCAL_AUTH_PICK
        case "${LOCAL_AUTH_PICK:-1}" in
            1) LOCAL_AUTH_MODE="1"; LOCAL_AUTH_LABEL="RBAC on" ;;
            2) LOCAL_AUTH_MODE="2"; LOCAL_AUTH_LABEL="RBAC off" ;;
            *) die "Invalid local auth mode: $LOCAL_AUTH_PICK. Enter 1 or 2." ;;
        esac
    fi
    ok "Local auth: $LOCAL_AUTH_LABEL"
fi

# ---- [2/5] Domain + provider ----------------------------------------------------
echo ""
echo -e "${BOLD}[2/5] Configuration${NC}"
DOMAIN=""
if [ -n "$FLAG_DOMAIN" ]; then
    DOMAIN="$FLAG_DOMAIN"
elif [ "$MODE" = "mac-local" ]; then
    DOMAIN="localhost"
else
    echo ""
    echo "  Public DNS name for this install (Caddy will obtain HTTPS for it)."
    echo "  Examples: clawnex.example.com · myhost.tail1234.ts.net"
    _tty_read "  Domain: " DOMAIN
fi
[ -n "$DOMAIN" ] || die "Domain is required"
ok "Domain: $DOMAIN"

PROVIDER_SELECT=5
PROVIDER_KEY=""
NVIDIA_DEFAULT_MODEL="nvidia/llama-3.3-nemotron-super-49b-v1"
NVIDIA_DEFAULT_BASE_URL="https://integrate.api.nvidia.com/v1"
NVIDIA_MODEL="${FLAG_PROVIDER_MODEL:-$NVIDIA_DEFAULT_MODEL}"
NVIDIA_BASE_URL="${FLAG_PROVIDER_URL:-$NVIDIA_DEFAULT_BASE_URL}"
if [ -n "$FLAG_PROVIDER" ]; then
    case "$FLAG_PROVIDER" in
        openrouter)          PROVIDER_SELECT=1 ;;
        anthropic)           PROVIDER_SELECT=2 ;;
        openai)              PROVIDER_SELECT=3 ;;
        nvidia|nvidia-nim|nim) PROVIDER_SELECT=4 ;;
        skip)       PROVIDER_SELECT=5 ;;
        *) die "--provider must be openrouter|anthropic|openai|nvidia|skip" ;;
    esac
    if [ -n "$FLAG_PROVIDER_URL" ] && [ "$PROVIDER_SELECT" != "4" ]; then
        die "--provider-url currently applies only to --provider nvidia"
    fi
    if [ -n "$FLAG_PROVIDER_MODEL" ] && [ "$PROVIDER_SELECT" != "4" ]; then
        die "--provider-model currently applies only to --provider nvidia"
    fi
    if [ -n "$FLAG_KEY_ENV" ]; then
        # Indirect expansion only after validating the name — never eval
        # operator-supplied strings (same class as the CX-G6 domain guard).
        case "$FLAG_KEY_ENV" in
            *[!A-Za-z0-9_]*|[0-9]*) die "--provider-key-env must be a valid env var name (got: $FLAG_KEY_ENV)" ;;
        esac
        PROVIDER_KEY="${!FLAG_KEY_ENV:-}"
        [ -n "$PROVIDER_KEY" ] || die "--provider-key-env $FLAG_KEY_ENV is empty/unset"
    fi
else
    echo ""
    echo "  AI Provider (changeable later via the dashboard):"
    echo "    [1] OpenRouter"
    echo "    [2] Anthropic (Claude)"
    echo "    [3] OpenAI (GPT)"
    echo "    [4] NVIDIA NIM"
    echo "    [5] Skip"
    _tty_read "  Select (1/2/3/4/5) [5]: " PROVIDER_SELECT
    PROVIDER_SELECT="${PROVIDER_SELECT:-5}"
    case "$PROVIDER_SELECT" in
        1) _tty_read "  OpenRouter API key (sk-or-v1-...): " PROVIDER_KEY ;;
        2) _tty_read "  Anthropic API key (sk-ant-...): " PROVIDER_KEY ;;
        3) _tty_read "  OpenAI API key (sk-...): " PROVIDER_KEY ;;
        4)
            echo ""
            echo "  Get an NVIDIA API key: https://build.nvidia.com/models"
            _tty_read "  NVIDIA API key: " PROVIDER_KEY
            _tty_read "  NVIDIA model [${NVIDIA_MODEL}]: " NVIDIA_MODEL_IN
            NVIDIA_MODEL="${NVIDIA_MODEL_IN:-$NVIDIA_MODEL}"
            _tty_read "  NVIDIA API base [${NVIDIA_BASE_URL}]: " NVIDIA_BASE_URL_IN
            NVIDIA_BASE_URL="${NVIDIA_BASE_URL_IN:-$NVIDIA_BASE_URL}"
            ;;
        *) PROVIDER_SELECT=5; PROVIDER_KEY="" ;;
    esac
fi
case "$PROVIDER_SELECT" in
    1) PROVIDER_LABEL="OpenRouter" ;;
    2) PROVIDER_LABEL="Anthropic" ;;
    3) PROVIDER_LABEL="OpenAI" ;;
    4) PROVIDER_LABEL="NVIDIA NIM" ;;
    *) PROVIDER_LABEL="Skipped" ;;
esac
ok "Provider: $PROVIDER_LABEL"

if [ "$FLAG_YES" != "1" ]; then
    echo ""
    echo "  About to install:  mode=$MODE  domain=$DOMAIN"
    CONFIRM=""
    _tty_read "  Continue? (yes/no) [yes]: " CONFIRM
    CONFIRM="${CONFIRM:-yes}"
    case "$CONFIRM" in y|yes) ;; *) echo "  Cancelled."; exit 0 ;; esac
fi

# ---- [3/5] Engine: setup.sh -------------------------------------------------------
echo ""
echo -e "${BOLD}[3/5] Engine (setup.sh)${NC}"

# install.sh and setup.sh intentionally use the same provider numbering:
# 1 OpenRouter · 2 Anthropic · 3 OpenAI · 4 NVIDIA NIM · 5 Skip.
SETUP_PROVIDER="$PROVIDER_SELECT"

export CLAWNEX_PRESEEDED=1 CLAWNEX_NO_START=1
export CLAWNEX_ANSWER_CONFIRM_OC="yes"
export CLAWNEX_ANSWER_MODE_SELECT="2"
export CLAWNEX_ANSWER_PROVIDER_SELECT="$SETUP_PROVIDER"
export CLAWNEX_ANSWER_API_KEY="$PROVIDER_KEY"
export CLAWNEX_ANSWER_NVIDIA_MODEL="$NVIDIA_MODEL"
export CLAWNEX_ANSWER_NVIDIA_BASE_URL="$NVIDIA_BASE_URL"
export CLAWNEX_ANSWER_ROUTE_OPENCLAW="yes"
export CLAWNEX_ANSWER_ENABLE_WATCHER="yes"
export CLAWNEX_ANSWER_ENABLE_WATCHDOG="no"     # systemd/launchd own restarts
export CLAWNEX_ANSWER_INSTALL_CLAWKEEPER="yes"
export CLAWNEX_ANSWER_SYNC_CVE="yes"
export CLAWNEX_ANSWER_INSTALL_SYMLINK="yes"
export CLAWNEX_ANSWER_RUN_INSTALL_PROD="no"    # orchestrator owns service layer
if [ "$MODE" = "mac-local" ]; then
    export CLAWNEX_ANSWER_INSTALL_TOPOLOGY="1"
    export CLAWNEX_ANSWER_LOCAL_AUTH_MODE="$LOCAL_AUTH_MODE"
else
    export CLAWNEX_ANSWER_INSTALL_TOPOLOGY="2"
    export CLAWNEX_ANSWER_PUBLIC_DOMAIN="$DOMAIN"
fi

"$ENGINE_BASH" setup.sh --preseeded --no-start

# ---- [4/5] Service layer ----------------------------------------------------------
echo ""
echo -e "${BOLD}[4/5] Service layer${NC}"
case "$MODE" in
    vps)
        bash deploy/install-prod.sh "$DOMAIN"
        ;;
    mac-local)
        MAC_MODE=local "$ENGINE_BASH" deploy/lib-macos.sh
        ;;
    mac-server)
        MAC_MODE=server DOMAIN="$DOMAIN" "$ENGINE_BASH" deploy/lib-macos.sh
        ;;
esac

# ---- [5/5] Verify + banner ---------------------------------------------------------
echo ""
echo -e "${BOLD}[5/5] Verify${NC}"
HEALTHY=0
for i in $(seq 1 60); do
    if curl -sf -m 3 "http://127.0.0.1:5001/api/health" >/dev/null 2>&1; then
        HEALTHY=1; ok "Dashboard healthy"; break
    fi
    sleep 2
done
[ "$HEALTHY" = "1" ] || die "Dashboard not healthy in 120s — see logs (journalctl -u clawnex-dashboard / logs/dashboard.log)"
# LiteLLM start lags the dashboard under systemd/launchd — retry, don't
# single-shot (false "not responding" on the first Crucible pass).
LITELLM_OK=0
for i in $(seq 1 30); do
    if curl -s -m 3 "http://127.0.0.1:4001/" >/dev/null 2>&1; then
        LITELLM_OK=1; ok "LiteLLM responding"; break
    fi
    sleep 2
done
[ "$LITELLM_OK" = "1" ] || warn "LiteLLM not responding after 60s — dashboard Configuration tab can finish this later"

AUTH_STATUS="$(curl -s -m 8 "http://127.0.0.1:5001/api/auth/status" 2>/dev/null || true)"
if [ "$MODE" = "mac-local" ] && [ "$LOCAL_AUTH_MODE" = "2" ]; then
    if echo "$AUTH_STATUS" | grep -q '"rbacEnabled":false' && echo "$AUTH_STATUS" | grep -q '"needsSetup":false'; then
        ok "Local RBAC-off mode active"
    else
        echo "$AUTH_STATUS" | sed 's/^/  auth-status: /'
        die "Local RBAC-off mode did not take effect — check .env.local and rebuild output"
    fi
else
    # A clean RBAC-on install must land on the first-admin setup gate. This
    # catches the exact failure mode where stale DB/operator state survived
    # cleanup and the browser shows /login instead of /setup.
    if echo "$AUTH_STATUS" | grep -q '"needsSetup":true'; then
        ok "First-run setup gate active"
    else
        echo "$AUTH_STATUS" | sed 's/^/  auth-status: /'
        die "First-run setup gate is not active — stale operator/auth state likely survived cleanup"
    fi
fi

# Deferred engine steps that need a RUNNING dashboard (setup.sh skipped them
# under --no-start): provider DB registration + CVE sync.
if [ "$PROVIDER_SELECT" != "5" ] && [ -f scripts/register-provider.cjs ]; then
    REG_NAME=""
    REG_TYPE=""
    REG_BASE=""
    REG_KEY="$PROVIDER_KEY"
    REG_MODEL=""
    case "$PROVIDER_SELECT" in
        1) REG_NAME="OpenRouter"; REG_TYPE="openrouter"; REG_BASE="https://openrouter.ai/api/v1" ;;
        2) REG_NAME="Anthropic";  REG_TYPE="anthropic";  REG_BASE="https://api.anthropic.com" ;;
        3) REG_NAME="OpenAI";     REG_TYPE="openai";     REG_BASE="https://api.openai.com/v1" ;;
        4) REG_NAME="NVIDIA NIM"; REG_TYPE="nvidia-nim"; REG_BASE="$NVIDIA_BASE_URL"; REG_MODEL="$NVIDIA_MODEL" ;;
    esac
    if [ -z "$REG_KEY" ]; then
        warn "Provider registration skipped — no API key captured"
    else
    # /api/health doesn't touch the DB; poke a DB-backed route so the lazy
    # schema initializes, then retry registration (first Crucible pass hit
    # "database not found" because nothing had opened the DB yet).
    curl -s -m 8 "http://127.0.0.1:5001/api/fleet" >/dev/null 2>&1 || true
    info "Registering ${REG_NAME} in dashboard providers..."
    REG_DONE=0
    for i in 1 2 3 4 5; do
        if DATABASE_PATH="$INSTALL_DIR/clawnex.db" \
           PROVIDER_NAME="$REG_NAME" PROVIDER_TYPE="$REG_TYPE" \
           PROVIDER_BASE_URL="$REG_BASE" PROVIDER_API_KEY="$REG_KEY" \
           PROVIDER_MODEL_ID="$REG_MODEL" \
           node scripts/register-provider.cjs 2>/dev/null; then
            REG_DONE=1; ok "${REG_NAME} registered"; break
        fi
        sleep 3
        curl -s -m 8 "http://127.0.0.1:5001/api/fleet" >/dev/null 2>&1 || true
    done
    [ "$REG_DONE" = "1" ] || warn "Provider registration failed — add manually via Configuration → Model Providers"
    fi
fi
info "Syncing CVE database (best-effort)..."
CVE_RESULT="$(curl -s -m 30 -X POST "http://127.0.0.1:5001/api/cve/sync" 2>/dev/null || true)"
CVE_COUNT="$(echo "$CVE_RESULT" | grep -o '"synced":[0-9]*' | cut -d: -f2 || true)"
if [ -n "$CVE_COUNT" ]; then
    ok "${CVE_COUNT} CVEs synced from GitHub"
else
    warn "CVE sync deferred — run later from the Security Posture tab"
fi

SETUP_SECRET="$(grep -m1 '^SETUP_SECRET=' .env.local | cut -d= -f2-)"
if [ "$DOMAIN" = "localhost" ]; then
    DASHBOARD_URL="http://localhost:5001"
else
    DASHBOARD_URL="https://${DOMAIN}"
fi
SETUP_URL="${DASHBOARD_URL}/setup?secret=${SETUP_SECRET}"
if [ "$MODE" = "mac-local" ] && [ "$LOCAL_AUTH_MODE" = "2" ]; then
    READY_LABEL="Open the dashboard:"
    READY_URL="$DASHBOARD_URL"
else
    READY_LABEL="Create your admin account:"
    READY_URL="$SETUP_URL"
fi
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   ClawNex is ready                                   ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  ${READY_LABEL}"
echo -e "    ${CYAN}${READY_URL}${NC}"
echo ""
case "$MODE" in
    vps)
        echo "  Status:    sudo systemctl status clawnex-dashboard caddy"
        echo "  Logs:      sudo journalctl -u clawnex-dashboard -f" ;;
    mac-local|mac-server)
        echo "  Status:    launchctl print gui/\$(id -u)/io.clawnex.dashboard | head -20"
        echo "  Logs:      tail -f logs/dashboard.log" ;;
esac
echo "  Uninstall: bash scripts/uninstall.sh"
