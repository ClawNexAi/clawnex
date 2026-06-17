#!/bin/bash
# =============================================================================
# ClawNex Setup Script
#
# Detects environment, locates OpenClaw, installs dependencies, configures
# model provider, sets up OpenClaw routing, and starts the platform. The
# version is read dynamically from package.json a few lines below — no
# version numbers hardcoded in this header so it doesn't drift on bumps.
#
# Usage: bash setup.sh
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

CLAWNEX_VERSION="$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0-unknown")"
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LITELLM_VERSION="1.83.0"
MIN_NODE_MAJOR=18
MIN_PYTHON_MAJOR=3
MIN_PYTHON_MINOR=10
DASHBOARD_PORT=5001
LITELLM_PORT=4001

# ---- Orchestration switches (single-installer, 2026-06) ---------------------
# --preseeded : every _tty_read/read_api_key prompt resolves from
#               CLAWNEX_ANSWER_<VARNAME> env vars (empty → caller default).
#               install.sh exports the answer map; setup.sh stays usable
#               standalone when the flag is absent.
# --no-start  : build everything but start nothing — a service manager
#               (systemd / launchd) owns process lifecycle. Also suppresses
#               the install-prod.sh chain offer at the end.
CLAWNEX_PRESEEDED="${CLAWNEX_PRESEEDED:-0}"
CLAWNEX_NO_START="${CLAWNEX_NO_START:-0}"
for _arg in "$@"; do
    case "$_arg" in
        --preseeded) CLAWNEX_PRESEEDED=1 ;;
        --no-start)  CLAWNEX_NO_START=1 ;;
    esac
done
export CLAWNEX_PRESEEDED

# ---- yes/no helpers ---------------------------------------------------------
# is_yes accepts y / Y / yes / YES / true / 1 — all common forms an operator
# might type. Strict equality `[ "$x" = "yes" ]` silently rejects "y" and is
# a UX trap; use is_yes everywhere.
is_yes() {
    local v="${1,,}"
    [ "$v" = "y" ] || [ "$v" = "yes" ] || [ "$v" = "true" ] || [ "$v" = "1" ]
}

# ---- terminal-aware prompt helper -------------------------------------------
# Drop-in replacement for `read -p "PROMPT" VAR` that always reads from the
# operator's controlling terminal (/dev/tty), not stdin. This matters under
# `curl ... | bash` where stdin is the install pipe — a bare `read` would
# silently consume bytes from the script source instead of the operator's
# keyboard. Every interactive prompt in this script funnels through here so
# the install survives both `bash setup.sh` and curl-pipe invocations.
#
# Usage:
#   _tty_read "  Some question: " ANSWER
#   _tty_read "  API key: " SECRET secret      # no-echo, for passwords
#
# Falls back to plain stdin when /dev/tty isn't readable (no controlling
# terminal at all). In that case the script is genuinely non-interactive
# and the caller's defaults will kick in for blank input.
_tty_read() {
    local _prompt="$1" _var="$2" _mode="${3:-}"
    # Preseeded mode: answer comes from CLAWNEX_ANSWER_<VARNAME>; unset
    # answers resolve to "" so each call site's `${VAR:-default}` applies.
    if [ "${CLAWNEX_PRESEEDED:-0}" = "1" ]; then
        local _ans_name="CLAWNEX_ANSWER_${_var}"
        printf -v "$_var" '%s' "${!_ans_name:-}"
        return 0
    fi
    if [ -r /dev/tty ]; then
        printf "%s" "$_prompt" > /dev/tty 2>/dev/null
        if [ "$_mode" = "secret" ]; then
            IFS= read -rs "$_var" < /dev/tty
            printf '\n' > /dev/tty 2>/dev/null
        else
            IFS= read -r "$_var" < /dev/tty
        fi
    else
        printf "%s" "$_prompt"
        if [ "$_mode" = "secret" ]; then
            IFS= read -rs "$_var"
            echo
        else
            IFS= read -r "$_var"
        fi
    fi
}

# ---- API key prompt helper --------------------------------------------------
# read_api_key VAR_NAME label
#   Reads an API key into VAR_NAME with -s (no echo). After Enter, prints
#   "✓ Received N characters" — length-only confirmation so a successful
#   paste vs. an accidental blank Enter is unambiguous WITHOUT exposing the
#   key value. Empty input enters a retry/skip loop.
#
# Returns 0 if a key was captured (VAR_NAME is set to the value).
# Returns 1 if the operator chose to skip (VAR_NAME is empty). Callers
# branch on the return code to decide whether to write provider config.
read_api_key() {
    local _varname="$1"
    local _label="$2"
    local _key _action _ch
    # Preseeded mode: key (if any) arrives via CLAWNEX_ANSWER_API_KEY.
    # Non-empty → captured (return 0); empty → operator chose skip (return 1).
    if [ "${CLAWNEX_PRESEEDED:-0}" = "1" ]; then
        if [ -n "${CLAWNEX_ANSWER_API_KEY:-}" ]; then
            printf -v "$_varname" '%s' "$CLAWNEX_ANSWER_API_KEY"
            return 0
        fi
        printf -v "$_varname" '%s' ""
        return 1
    fi
    # Write directly to /dev/tty so the operator sees feedback immediately,
    # bypassing any tee/pipe buffering between us and the terminal. We DON'T
    # also echo to stdout because that flows through tee → terminal too,
    # which double-prints. Cost: this message won't appear in /tmp/setup.log,
    # but interactive feedback like "✓ Received N characters" is for the
    # human's eye in the moment, not for post-install diagnostics. If
    # /dev/tty isn't writable (no controlling terminal), fall back to stdout.
    _emit_to_user() {
        echo -e "$1" > /dev/tty 2>/dev/null || echo -e "$1"
    }

    while true; do
        # Write prompt directly to /dev/tty so it's immediate (avoids tee
        # buffering of the prompt itself).
        printf "  %s API key: " "$_label" > /dev/tty 2>/dev/null
        _key=""
        # Read one character at a time and print an asterisk for each.
        # `read -rsn 1` reads exactly one char in raw mode with no echo —
        # we control all display ourselves. The asterisk-per-char makes a
        # paste visible as it lands ("****************") so the operator
        # can see input being captured. `read -s` alone is invisible and
        # operators routinely think nothing was pasted.
        while IFS= read -rsn 1 _ch; do
            case "$_ch" in
                "")
                    # Empty = Enter pressed → done
                    break
                    ;;
                $'\x7f'|$'\b')
                    # Backspace / DEL — pop last char and erase the asterisk
                    if [ -n "$_key" ]; then
                        _key="${_key%?}"
                        printf '\b \b' > /dev/tty 2>/dev/null
                    fi
                    ;;
                *)
                    _key="${_key}${_ch}"
                    printf '*' > /dev/tty 2>/dev/null
                    ;;
            esac
        done
        printf '\n' > /dev/tty 2>/dev/null

        if [ -n "$_key" ]; then
            _emit_to_user "  ${GREEN}✓${NC} Received ${#_key} characters"
            printf -v "$_varname" '%s' "$_key"
            return 0
        fi
        _emit_to_user "  ${YELLOW}⚠${NC} No key entered (paste may have been missed)."
        _emit_to_user "    [r] retry — paste again"
        _emit_to_user "    [s] skip — continue without configuring this provider"
        _tty_read "  Select [r/s] [r]: " _action
        _action="${_action:-r}"
        case "${_action,,}" in
            s|skip) printf -v "$_varname" '%s' ""; return 1 ;;
            *) ;;
        esac
    done
}

# ---- box-drawing helpers ----------------------------------------------------
# Wrapping content in a clean ╔══╗ box requires knowing the visible width of
# each line. Bash's ${#str} counts UTF-8 characters correctly (em-dash, box
# chars, etc. all = 1 char), but we still need to strip ANSI color escapes
# before measuring or the padding goes wrong by N invisible bytes.
# Caller wraps the whole block in color (echo -ne "$CYAN$BOLD"; box_*; echo -e "$NC").
BOX_W=70

box_top() { local w="${1:-$BOX_W}"; printf '╔'; printf '═%.0s' $(seq 1 "$w"); printf '╗\n'; }
box_bot() { local w="${1:-$BOX_W}"; printf '╚'; printf '═%.0s' $(seq 1 "$w"); printf '╝\n'; }
box_sep() { local w="${1:-$BOX_W}"; printf '║'; printf ' %.0s' $(seq 1 "$w"); printf '║\n'; }
# Horizontal rule — for sections that contain variable-length URLs / paths
# where a closed box would overflow on long content.
rule()    { local w="${1:-$BOX_W}"; printf '═%.0s' $(seq 1 "$w"); printf '\n'; }
box_line() {
    # box_line "  content"   [width=BOX_W]
    local content="$1"
    local w="${2:-$BOX_W}"
    # Strip ANSI escapes for length calculation
    local visible="${content//$'\033'\[[0-9;]*m/}"
    local len=${#visible}
    local pad=$(( w - len ))
    [ "$pad" -lt 0 ] && pad=0
    printf '║%s%*s║\n' "$content" "$pad" ""
}

echo ""
echo -ne "${CYAN}${BOLD}"
box_top 54
box_line "        ClawNex v${CLAWNEX_VERSION} — Setup" 54
box_line "        One nexus. Total control." 54
box_line "        A ProBizSystems Product" 54
box_bot 54
echo -e "${NC}"
echo ""

# =============================================================================
# [1/10] Detect Environment
# =============================================================================
echo -e "${BOLD}[1/10] Detecting environment...${NC}"

# OS
OS_TYPE=$(uname -s)
OS_ARCH=$(uname -m)
OS_VERSION=$(uname -r)
echo -e "  ${GREEN}✓${NC} $OS_TYPE $OS_VERSION ($OS_ARCH)"

if [ "$OS_TYPE" != "Darwin" ] && [ "$OS_TYPE" != "Linux" ]; then
    echo -e "  ${YELLOW}⚠${NC} Untested OS. ClawNex is optimized for macOS and Linux."
fi

# Node.js
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ]; then
        echo -e "  ${GREEN}✓${NC} Node.js v${NODE_VERSION}"
    else
        echo -e "  ${RED}✗${NC} Node.js v${NODE_VERSION} — minimum v${MIN_NODE_MAJOR} required"
        echo "    Install (macOS):  brew install node@22"
        echo "    Install (Linux):  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs"
        echo "    Other:            https://nodejs.org"
        exit 1
    fi
else
    echo -e "  ${RED}✗${NC} Node.js not found"
    echo "    Install: brew install node (macOS) or see https://nodejs.org"
    exit 1
fi

# npm
if command -v npm &>/dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "  ${GREEN}✓${NC} npm v${NPM_VERSION}"
else
    echo -e "  ${RED}✗${NC} npm not found (should come with Node.js)"
    exit 1
fi

# Python — LiteLLM requires Python 3.10+. macOS often reports Apple's
# /usr/bin/python3 (3.9.x) first even when Homebrew Python 3.12 is installed,
# so do not blindly use `python3`; scan explicit modern interpreters first.
_python_version() {
    "$1" --version 2>&1 | awk '{print $2}'
}

_python_meets_min() {
    local cmd="$1" ver major minor
    ver="$(_python_version "$cmd")"
    major="$(echo "$ver" | cut -d. -f1)"
    minor="$(echo "$ver" | cut -d. -f2)"
    [ -n "$major" ] && [ -n "$minor" ] || return 1
    [ "$major" -gt "$MIN_PYTHON_MAJOR" ] || {
        [ "$major" -eq "$MIN_PYTHON_MAJOR" ] && [ "$minor" -ge "$MIN_PYTHON_MINOR" ]
    }
}

_find_modern_python() {
    local candidates=()
    candidates+=(python3.13 python3.12 python3.11 python3.10)
    if [ "$OS_TYPE" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
        local brew_py
        brew_py="$(brew --prefix python@3.12 2>/dev/null || true)"
        [ -n "$brew_py" ] && candidates+=("$brew_py/bin/python3.12")
    fi
    candidates+=(python3 python)

    local cand
    for cand in "${candidates[@]}"; do
        [ -n "$cand" ] || continue
        if command -v "$cand" >/dev/null 2>&1 && _python_meets_min "$cand"; then
            command -v "$cand"
            return 0
        fi
    done
    return 1
}

_install_or_upgrade_python312() {
    if [ "$OS_TYPE" != "Darwin" ] || ! command -v brew >/dev/null 2>&1; then
        return 1
    fi
    if brew list python@3.12 >/dev/null 2>&1; then
        echo "  Upgrading Homebrew Python 3.12 for LiteLLM..."
        brew upgrade python@3.12 || brew reinstall python@3.12
    else
        echo "  Installing Homebrew Python 3.12 for LiteLLM..."
        brew install python@3.12
    fi
}

PYTHON_CMD="$(_find_modern_python || true)"
if [ -n "$PYTHON_CMD" ]; then
    PYTHON_VERSION="$(_python_version "$PYTHON_CMD")"
    if command -v python3 >/dev/null 2>&1 && ! _python_meets_min python3; then
        DEFAULT_PYTHON_VERSION="$(_python_version python3)"
        echo -e "  ${YELLOW}⚠${NC} python3 is ${DEFAULT_PYTHON_VERSION}; LiteLLM requires ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+"
        echo -e "  ${GREEN}✓${NC} Using $PYTHON_CMD (${PYTHON_VERSION}) for LiteLLM"
    else
        echo -e "  ${GREEN}✓${NC} Python ${PYTHON_VERSION}"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} No Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ found — LiteLLM proxy requires it"
    if [ "$OS_TYPE" = "Darwin" ] && command -v brew &>/dev/null; then
        _tty_read "  Install/upgrade Python 3.12 via Homebrew for LiteLLM? (yes/no) [yes]: " INSTALL_PYTHON
        INSTALL_PYTHON=${INSTALL_PYTHON:-yes}
        if is_yes "$INSTALL_PYTHON"; then
            _install_or_upgrade_python312
            PYTHON_CMD="$(_find_modern_python || true)"
            if [ -n "$PYTHON_CMD" ]; then
                echo -e "  ${GREEN}✓${NC} Using $PYTHON_CMD ($(_python_version "$PYTHON_CMD")) for LiteLLM"
            else
                echo -e "  ${RED}✗${NC} Python 3.12 install/upgrade completed but no usable python3.12 was found"
                echo "    Check: brew --prefix python@3.12"
            fi
        fi
    elif [ "$OS_TYPE" = "Darwin" ]; then
        echo "    Install manually: brew install python@3.12"
    else
        echo "    Install manually: sudo apt-get install python3.12 (Ubuntu/Debian)"
    fi
fi

# Git
if command -v git &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Git $(git --version | awk '{print $3}')"
else
    echo -e "  ${YELLOW}⚠${NC} Git not found — recommended for version tracking"
fi

echo ""

# =============================================================================
# [2/10] Locate OpenClaw
# =============================================================================
echo -e "${BOLD}[2/10] Locating OpenClaw...${NC}"

OPENCLAW_PATH=""
OPENCLAW_TOKEN=""

# Check common locations
SEARCH_PATHS=(
    "$HOME/.openclaw"
    "$HOME/.config/openclaw"
    "/opt/openclaw"
    "$HOME/openclaw"
)

# Check env var first
if [ -n "$OPENCLAW_HOME" ] && [ -f "$OPENCLAW_HOME/openclaw.json" ]; then
    OPENCLAW_PATH="$OPENCLAW_HOME"
    echo -e "  ${GREEN}✓${NC} Found via \$OPENCLAW_HOME: ${OPENCLAW_PATH}"
fi

# Check CLI
if [ -z "$OPENCLAW_PATH" ] && command -v openclaw &>/dev/null; then
    OC_CLI_DIR=$(openclaw --config-dir 2>/dev/null || echo "")
    if [ -n "$OC_CLI_DIR" ] && [ -f "$OC_CLI_DIR/openclaw.json" ]; then
        OPENCLAW_PATH="$OC_CLI_DIR"
        echo -e "  ${GREEN}✓${NC} Found via CLI: ${OPENCLAW_PATH}"
    fi
fi

# Search common paths
if [ -z "$OPENCLAW_PATH" ]; then
    for sp in "${SEARCH_PATHS[@]}"; do
        if [ -f "$sp/openclaw.json" ]; then
            OPENCLAW_PATH="$sp"
            echo -e "  ${GREEN}✓${NC} Found at: ${OPENCLAW_PATH}"
            break
        fi
    done
fi

if [ -z "$OPENCLAW_PATH" ]; then
    echo -e "  ${YELLOW}⚠${NC} OpenClaw installation not found in standard locations."
    _tty_read "  Enter the path to your OpenClaw directory (or press Enter to skip): " CUSTOM_PATH
    if [ -n "$CUSTOM_PATH" ] && [ -f "$CUSTOM_PATH/openclaw.json" ]; then
        OPENCLAW_PATH="$CUSTOM_PATH"
        echo -e "  ${GREEN}✓${NC} OpenClaw found at: ${OPENCLAW_PATH}"
    elif [ -n "$CUSTOM_PATH" ]; then
        echo -e "  ${RED}✗${NC} openclaw.json not found at ${CUSTOM_PATH}"
        echo "  Continuing without OpenClaw integration (session watcher will be disabled)"
    else
        echo "  Continuing without OpenClaw integration"
    fi
fi

# Validate OpenClaw installation
if [ -n "$OPENCLAW_PATH" ]; then
    # Validate openclaw.json exists
    if [ -f "$OPENCLAW_PATH/openclaw.json" ]; then
        echo -e "  ${GREEN}✓${NC} openclaw.json validated"
    fi

    AGENT_COUNT=$(ls -d "$OPENCLAW_PATH/agents/"*/ 2>/dev/null | wc -l | tr -d ' ')
    SESSION_COUNT=$(find "$OPENCLAW_PATH/agents" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')
    OC_VERSION=$(cat "$OPENCLAW_PATH/openclaw.json" 2>/dev/null | grep -o '"lastTouchedVersion"[^,]*' | cut -d'"' -f4)
    echo -e "  ${CYAN}•${NC} OpenClaw version: ${OC_VERSION:-unknown}"
    echo -e "  ${CYAN}•${NC} Agents: ${AGENT_COUNT}"
    echo -e "  ${CYAN}•${NC} Session files: ${SESSION_COUNT}"

    # Read gateway token from openclaw.json — path is gateway.auth.token
    OPENCLAW_TOKEN=$(OPENCLAW_JSON="$OPENCLAW_PATH/openclaw.json" python3 -c "import json, os; d=json.load(open(os.environ['OPENCLAW_JSON'])); print(d.get('gateway',{}).get('auth',{}).get('token',''))" 2>/dev/null)
    if [ -n "$OPENCLAW_TOKEN" ]; then
        echo -e "  ${GREEN}✓${NC} Gateway token found"
    else
        echo -e "  ${YELLOW}⚠${NC} Gateway token not found in openclaw.json"
        _tty_read "  Enter gateway token manually (or press Enter to skip): " MANUAL_TOKEN secret
        echo
        if [ -n "$MANUAL_TOKEN" ]; then
            OPENCLAW_TOKEN="$MANUAL_TOKEN"
            echo -e "  ${GREEN}✓${NC} Token set manually"
        fi
    fi

    # Test if OpenClaw gateway is running
    OC_GATEWAY_RUNNING=false
    if lsof -ti :18789 &>/dev/null 2>&1; then
        OC_GATEWAY_RUNNING=true
        echo -e "  ${GREEN}✓${NC} OpenClaw gateway is running (port 18789)"
    elif curl -s --max-time 2 http://127.0.0.1:18789 &>/dev/null 2>&1; then
        OC_GATEWAY_RUNNING=true
        echo -e "  ${GREEN}✓${NC} OpenClaw gateway is running (port 18789)"
    else
        echo -e "  ${YELLOW}⚠${NC} OpenClaw gateway not detected on port 18789 — not required but recommended"
    fi

    echo ""
    _tty_read "  Is this the correct OpenClaw installation? (yes/no): " CONFIRM_OC
    if ! is_yes "$CONFIRM_OC"; then
        _tty_read "  Enter the correct path: " OPENCLAW_PATH
    fi
fi

echo ""

# =============================================================================
# [3/10] Installation Mode
# =============================================================================
echo -e "${BOLD}[3/10] Installation mode...${NC}"

INSTALL_MODE="fresh"
EXISTING_DB=false

if [ -f "$INSTALL_DIR/sentinel.db" ]; then
    EXISTING_DB=true
    DB_SIZE=$(du -h "$INSTALL_DIR/sentinel.db" | awk '{print $1}')
    echo -e "  ${YELLOW}!${NC} Existing ClawNex installation detected"
    echo -e "  ${CYAN}•${NC} Database: sentinel.db (${DB_SIZE})"
    echo ""
    echo "  Select mode:"
    echo "    [1] Update — keep database, update code"
    echo "    [2] Fresh install — archive existing DB, start clean"
    echo "    [3] Import migration package"
    echo ""
    _tty_read "  Select (1/2/3) [2]: " MODE_SELECT
    MODE_SELECT="${MODE_SELECT:-2}"
    case "$MODE_SELECT" in
        1) INSTALL_MODE="update" ;;
        2) INSTALL_MODE="fresh"
           BACKUP_DIR="$INSTALL_DIR/backups"
           mkdir -p "$BACKUP_DIR"
           TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
           # Existing DB may not exist on a recently-wiped install; only
           # archive if it's there.
           # `rm -f` so missing -shm/-wal companion files don't die under
           # `set -e` (real incident on Crucible 2026-04-25 — sentinel.db
           # existed without its WAL companions, the rm exited 1, and set -e
           # killed setup.sh silently right after this block).
           if [ -f "$INSTALL_DIR/sentinel.db" ]; then
               cp "$INSTALL_DIR/sentinel.db" "$BACKUP_DIR/sentinel-pre-setup-${TIMESTAMP}.db"
               # DAST 2026-05-15 H2 (Run 2): pre-setup backup carries
               # the same hashed creds/sessions as the live DB. cp
               # inherits umask (typically 644) — narrow to 600 so
               # the backup isn't world-readable.
               chmod 600 "$BACKUP_DIR/sentinel-pre-setup-${TIMESTAMP}.db" 2>/dev/null || true
               echo -e "  ${GREEN}✓${NC} Existing DB archived to backups/sentinel-pre-setup-${TIMESTAMP}.db"
               rm -f "$INSTALL_DIR/sentinel.db" "$INSTALL_DIR/sentinel.db-shm" "$INSTALL_DIR/sentinel.db-wal"
           fi
           # Same for v0.9+ rebrand path
           if [ -f "$INSTALL_DIR/clawnex.db" ]; then
               cp "$INSTALL_DIR/clawnex.db" "$BACKUP_DIR/clawnex-pre-setup-${TIMESTAMP}.db"
               chmod 600 "$BACKUP_DIR/clawnex-pre-setup-${TIMESTAMP}.db" 2>/dev/null || true
               echo -e "  ${GREEN}✓${NC} Existing DB archived to backups/clawnex-pre-setup-${TIMESTAMP}.db"
               rm -f "$INSTALL_DIR/clawnex.db" "$INSTALL_DIR/clawnex.db-shm" "$INSTALL_DIR/clawnex.db-wal"
           fi
           ;;
        3) INSTALL_MODE="migrate"
           _tty_read "  Path to migration package (.tar.gz): " MIGRATE_PATH
           if [ ! -f "$MIGRATE_PATH" ]; then
               echo -e "  ${RED}✗${NC} File not found: ${MIGRATE_PATH}"
               exit 1
           fi
           echo -e "  ${GREEN}✓${NC} Migration package found"
           ;;
        *) echo -e "  ${RED}✗${NC} Invalid selection: '${MODE_SELECT}'. Re-run setup.sh and pick 1, 2, or 3."; exit 1 ;;
    esac
else
    echo -e "  ${CYAN}•${NC} No existing installation found — fresh install"
fi

echo -e "  ${GREEN}✓${NC} Mode: ${INSTALL_MODE}"
echo ""

# =============================================================================
# [4/10] Check Ports
# =============================================================================
echo -e "${BOLD}[4/10] Checking ports...${NC}"

check_port() {
    local port=$1
    local name=$2
    if lsof -ti :$port &>/dev/null; then
        PID=$(lsof -ti :$port | head -1)
        echo -e "  ${YELLOW}⚠${NC} Port $port ($name) in use by PID $PID"
        _tty_read "    Kill process? (yes/no): " KILL_IT
        if is_yes "$KILL_IT"; then
            kill -9 $PID 2>/dev/null
            sleep 1
            echo -e "    ${GREEN}✓${NC} Killed"
        fi
    else
        echo -e "  ${GREEN}✓${NC} Port $port ($name) available"
    fi
}

check_port $DASHBOARD_PORT "Dashboard"
check_port $LITELLM_PORT "LiteLLM"
echo ""

# =============================================================================
# [5/10] Install Dependencies
# =============================================================================
echo -e "${BOLD}[5/10] Installing dependencies...${NC}"

if [ "$INSTALL_MODE" != "update" ] || [ ! -d "$INSTALL_DIR/node_modules" ]; then
    echo "  Installing npm packages (exact pinned versions)..."
    cd "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/logs"
    NPM_INSTALL_LOG="$INSTALL_DIR/logs/npm-install.log"
    if npm install --prefer-offline >"$NPM_INSTALL_LOG" 2>&1; then
        tail -3 "$NPM_INSTALL_LOG" | sed 's/^/    /'
    else
        echo -e "  ${RED}✗${NC} npm install failed — tail of $NPM_INSTALL_LOG:"
        tail -40 "$NPM_INSTALL_LOG" | sed 's/^/    /'
        echo "    Full log: $NPM_INSTALL_LOG"
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} npm packages installed"
else
    echo -e "  ${GREEN}✓${NC} node_modules exists (update mode — skipping)"
fi

# LiteLLM
if [ -n "$PYTHON_CMD" ]; then
    # PEP 668: Ubuntu 24.04+ / modern Debian / Homebrew Python mark the
    # system interpreter as "externally-managed" and refuse pip install
    # without --break-system-packages. We're not running in a venv (yet),
    # so probe support and add the flag when needed. install-prod.sh
    # already does this — keeping setup.sh consistent.
    PIP_FLAGS=""
    if $PYTHON_CMD -m pip install --help 2>/dev/null | grep -q -- '--break-system-packages'; then
        PIP_FLAGS="--break-system-packages"
    fi

    # Upgrade pip first to avoid warnings
    echo "  Upgrading pip..."
    $PYTHON_CMD -m pip install --upgrade pip $PIP_FLAGS --quiet 2>&1 | tail -1
    echo -e "  ${GREEN}✓${NC} pip $(${PYTHON_CMD} -m pip --version 2>/dev/null | awk '{print $2}')"

    # Version check uses importlib.metadata, not litellm.__version__.
    # LiteLLM 1.83.0+ dropped the __version__ module attribute, so the
    # latter raises AttributeError even when the package is installed
    # correctly. importlib.metadata reads the package's installed-version
    # metadata directly and works regardless of module exports.
    _check_litellm_version() {
        $PYTHON_CMD -c "import importlib.metadata as m; print(m.version('litellm'))" 2>/dev/null || echo ""
    }

    LITELLM_INSTALLED="$(_check_litellm_version)"
    # Verify both the module AND the CLI binary. Past uninstall flows have
    # left the module registered (via importlib.metadata) while removing the
    # entry-point script — making this check a false positive that crashed
    # step 10 silently. We need both to skip the reinstall.
    LITELLM_BIN_PRESENT=""
    for _candidate in "$(command -v litellm 2>/dev/null)" "$HOME/.local/bin/litellm" /usr/local/bin/litellm /opt/homebrew/bin/litellm; do
        if [ -n "$_candidate" ] && [ -x "$_candidate" ]; then LITELLM_BIN_PRESENT=1; break; fi
    done
    if [ "$LITELLM_INSTALLED" = "$LITELLM_VERSION" ] && [ -n "$LITELLM_BIN_PRESENT" ]; then
        echo -e "  ${GREEN}✓${NC} LiteLLM ${LITELLM_VERSION} already installed"
    else
        # If the module is at the right version but the BIN is missing, pip
        # would otherwise see "Requirement already satisfied" and skip,
        # leaving the entry-point script unrecreated. Force the reinstall
        # in that case so the script lands at ~/.local/bin/litellm. This
        # is the recovery path after an uninstall.sh that removed the bin
        # but couldn't remove the module (PEP 668 refusal pre-fix).
        REINSTALL_FLAGS=""
        if [ "$LITELLM_INSTALLED" = "$LITELLM_VERSION" ] && [ -z "$LITELLM_BIN_PRESENT" ]; then
            echo "  LiteLLM module present but binary missing — forcing reinstall to recreate entry point..."
            REINSTALL_FLAGS="--force-reinstall"
        else
            echo "  Installing LiteLLM ${LITELLM_VERSION}..."
        fi
        # Drop --quiet so install errors (PEP 668 refusal, network failures,
        # missing build deps) are visible. tail -3 keeps the noise bounded.
        if ! $PYTHON_CMD -m pip install "litellm[proxy]==$LITELLM_VERSION" $PIP_FLAGS $REINSTALL_FLAGS 2>&1 | tail -3; then
            echo -e "  ${RED}✗${NC} pip install failed — see output above"
        fi
        # Re-verify after install. Past "successful" pip exits have left a
        # broken state where the package can't be imported (e.g. binary deps
        # failed to compile silently). importlib.metadata.version is the
        # right check — it confirms the package is registered AND visible
        # to the same interpreter we'll launch later.
        LITELLM_INSTALLED="$(_check_litellm_version)"
        if [ "$LITELLM_INSTALLED" = "$LITELLM_VERSION" ]; then
            echo -e "  ${GREEN}✓${NC} LiteLLM ${LITELLM_VERSION} installed (verified)"
        else
            echo -e "  ${RED}✗${NC} LiteLLM install attempted but version check failed."
            echo -e "    Got: '${LITELLM_INSTALLED:-(metadata not found)}', expected: ${LITELLM_VERSION}"
            echo -e "    To retry: ${PYTHON_CMD} -m pip install 'litellm[proxy]==${LITELLM_VERSION}' ${PIP_FLAGS}"
            exit 1
        fi
    fi
fi
echo ""

# =============================================================================
# [6/10] Configure Model Provider
# =============================================================================
echo -e "${BOLD}[6/10] Configure model provider...${NC}"

echo ""
echo "  How will your agents access AI models?"
echo ""
echo "    [1] OpenRouter (cloud)   — pay-per-use, multiple models"
echo "    [2] Anthropic (Claude)   — Claude models via Anthropic API"
echo "    [3] OpenAI (GPT)         — GPT models via OpenAI API"
echo "    [4] NVIDIA NIM           — NVIDIA-hosted models via NIM API"
echo "    [5] Skip                 — configure later via dashboard"
echo ""
_tty_read "  Select (1/2/3/4/5) [5]: " PROVIDER_SELECT
PROVIDER_SELECT=${PROVIDER_SELECT:-5}

LITELLM_CONFIG_DIR="$INSTALL_DIR/litellm"
mkdir -p "$LITELLM_CONFIG_DIR"
LITELLM_CONFIG_FILE="$LITELLM_CONFIG_DIR/config.yaml"
LITELLM_HAS_VALID_CONFIG=false

## Track provider details for the dashboard-DB registration that runs at the
## end of step 10. Without this the operator types their key here, sees
## "✓ Received N characters", LiteLLM gets configured — but Configuration →
## Model Providers UI shows an empty list because nothing wrote to the DB.
PROVIDER_REG_NAME=""
PROVIDER_REG_TYPE=""
PROVIDER_REG_BASE_URL=""
PROVIDER_REG_API_KEY=""
PROVIDER_REG_MODEL_ID=""
NVIDIA_DEFAULT_MODEL="nvidia/llama-3.3-nemotron-super-49b-v1"
NVIDIA_DEFAULT_BASE_URL="https://integrate.api.nvidia.com/v1"

case "$PROVIDER_SELECT" in
    1)
        read_api_key OPENROUTER_KEY "OpenRouter" || true
        if [ -n "$OPENROUTER_KEY" ]; then
            PROVIDER_REG_NAME="OpenRouter"
            PROVIDER_REG_TYPE="openrouter"
            PROVIDER_REG_BASE_URL="https://openrouter.ai/api/v1"
            PROVIDER_REG_API_KEY="$OPENROUTER_KEY"
            cat > "$LITELLM_CONFIG_FILE" << EOF
# ClawNex v${CLAWNEX_VERSION} — LiteLLM Configuration
# Provider: OpenRouter
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

model_list:
  - model_name: "openrouter/auto"
    litellm_params:
      model: "openrouter/auto"
      api_key: "${OPENROUTER_KEY}"

litellm_settings:
  callbacks: ["clawnex_logger.ClawNexLogger"]
  drop_params: true
  request_timeout: 120
EOF
            chmod 600 "$LITELLM_CONFIG_FILE" 2>/dev/null || true
            echo -e "  ${GREEN}✓${NC} LiteLLM configured for OpenRouter"
            LITELLM_HAS_VALID_CONFIG=true
        else
            echo -e "  ${YELLOW}⚠${NC} No API key provided — skipping LiteLLM configuration"
        fi
        ;;
    2)
        read_api_key ANTHROPIC_KEY "Anthropic" || true
        if [ -n "$ANTHROPIC_KEY" ]; then
            PROVIDER_REG_NAME="Anthropic"
            PROVIDER_REG_TYPE="anthropic"
            PROVIDER_REG_BASE_URL="https://api.anthropic.com"
            PROVIDER_REG_API_KEY="$ANTHROPIC_KEY"
            cat > "$LITELLM_CONFIG_FILE" << EOF
# ClawNex v${CLAWNEX_VERSION} — LiteLLM Configuration
# Provider: Anthropic (Claude)
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

model_list:
  - model_name: "claude-sonnet"
    litellm_params:
      model: "anthropic/claude-sonnet-4-20250514"
      api_key: "${ANTHROPIC_KEY}"

litellm_settings:
  callbacks: ["clawnex_logger.ClawNexLogger"]
  drop_params: true
  request_timeout: 120
EOF
            chmod 600 "$LITELLM_CONFIG_FILE" 2>/dev/null || true
            echo -e "  ${GREEN}✓${NC} LiteLLM configured for Anthropic (Claude)"
            LITELLM_HAS_VALID_CONFIG=true
        else
            echo -e "  ${YELLOW}⚠${NC} No API key provided — skipping LiteLLM configuration"
        fi
        ;;
    3)
        read_api_key OPENAI_KEY "OpenAI" || true
        if [ -n "$OPENAI_KEY" ]; then
            PROVIDER_REG_NAME="OpenAI"
            PROVIDER_REG_TYPE="openai"
            PROVIDER_REG_BASE_URL="https://api.openai.com/v1"
            PROVIDER_REG_API_KEY="$OPENAI_KEY"
            cat > "$LITELLM_CONFIG_FILE" << EOF
# ClawNex v${CLAWNEX_VERSION} — LiteLLM Configuration
# Provider: OpenAI (GPT)
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

model_list:
  - model_name: "gpt-4o"
    litellm_params:
      model: "openai/gpt-4o"
      api_key: "${OPENAI_KEY}"

litellm_settings:
  callbacks: ["clawnex_logger.ClawNexLogger"]
  drop_params: true
  request_timeout: 120
EOF
            chmod 600 "$LITELLM_CONFIG_FILE" 2>/dev/null || true
            echo -e "  ${GREEN}✓${NC} LiteLLM configured for OpenAI (GPT)"
            LITELLM_HAS_VALID_CONFIG=true
        else
            echo -e "  ${YELLOW}⚠${NC} No API key provided — skipping LiteLLM configuration"
        fi
        ;;
    4)
        echo ""
        echo "  Get an NVIDIA API key: https://build.nvidia.com/models"
        read_api_key NVIDIA_KEY "NVIDIA NIM" || true
        if [ -n "$NVIDIA_KEY" ]; then
            _tty_read "  NVIDIA model [${NVIDIA_DEFAULT_MODEL}]: " NVIDIA_MODEL
            NVIDIA_MODEL=${NVIDIA_MODEL:-$NVIDIA_DEFAULT_MODEL}
            _tty_read "  NVIDIA API base [${NVIDIA_DEFAULT_BASE_URL}]: " NVIDIA_BASE_URL
            NVIDIA_BASE_URL=${NVIDIA_BASE_URL:-$NVIDIA_DEFAULT_BASE_URL}
            PROVIDER_REG_NAME="NVIDIA NIM"
            PROVIDER_REG_TYPE="nvidia-nim"
            PROVIDER_REG_BASE_URL="$NVIDIA_BASE_URL"
            PROVIDER_REG_API_KEY="$NVIDIA_KEY"
            PROVIDER_REG_MODEL_ID="$NVIDIA_MODEL"
            cat > "$LITELLM_CONFIG_FILE" << EOF
# ClawNex v${CLAWNEX_VERSION} — LiteLLM Configuration
# Provider: NVIDIA NIM
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

model_list:
  - model_name: "${NVIDIA_MODEL}"
    litellm_params:
      model: "nvidia_nim/${NVIDIA_MODEL}"
      api_base: "${NVIDIA_BASE_URL}"
      api_key: "${NVIDIA_KEY}"

litellm_settings:
  callbacks: ["clawnex_logger.ClawNexLogger"]
  drop_params: true
  request_timeout: 120
EOF
            chmod 600 "$LITELLM_CONFIG_FILE" 2>/dev/null || true
            echo -e "  ${GREEN}✓${NC} LiteLLM configured for NVIDIA NIM (${NVIDIA_MODEL})"
            LITELLM_HAS_VALID_CONFIG=true
        else
            echo -e "  ${YELLOW}⚠${NC} No API key provided — skipping LiteLLM configuration"
        fi
        ;;
    5|*)
        # Create minimal placeholder config
        cat > "$LITELLM_CONFIG_FILE" << EOF
# ClawNex v${CLAWNEX_VERSION} — LiteLLM Configuration
# Provider: Not configured — set up via dashboard or re-run setup.sh
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

model_list: []

litellm_settings:
  callbacks: ["clawnex_logger.ClawNexLogger"]
  drop_params: true
  request_timeout: 120
EOF
        chmod 600 "$LITELLM_CONFIG_FILE" 2>/dev/null || true
        echo -e "  ${CYAN}•${NC} Skipped — configure model provider later via Configuration tab"
        ;;
esac

# Generate LiteLLM master key for authenticated proxy access
if [ -f "$LITELLM_CONFIG_FILE" ]; then
    LITELLM_MASTER_KEY=$(python3 -c "import secrets; print('sk-' + secrets.token_hex(24))")
    # Append general_settings with master_key to the config
    cat >> "$LITELLM_CONFIG_FILE" << MKEOF

general_settings:
  master_key: "${LITELLM_MASTER_KEY}"
MKEOF
    echo -e "  ${GREEN}✓${NC} LiteLLM master key generated"
fi

echo ""

# =============================================================================
# [7/10] Configure OpenClaw Routing
# =============================================================================
echo -e "${BOLD}[7/10] Configure OpenClaw routing...${NC}"

if [ -n "$OPENCLAW_PATH" ] && [ -f "$OPENCLAW_PATH/openclaw.json" ]; then
    echo ""
    echo "  Route OpenClaw traffic through ClawNex shield?"
    echo "  This changes the apiBase in openclaw.json to point to the LiteLLM proxy"
    echo "  on port ${LITELLM_PORT}, enabling prompt scanning and traffic monitoring."
    echo ""
    _tty_read "  Route OpenClaw traffic through ClawNex shield? (yes/no) [yes]: " ROUTE_OPENCLAW
    ROUTE_OPENCLAW=${ROUTE_OPENCLAW:-yes}

    if is_yes "$ROUTE_OPENCLAW"; then
        OC_JSON="$OPENCLAW_PATH/openclaw.json"
        # First-touch backup: only create if absent. Overwriting on every
        # run clobbers the true pre-ClawNex state, so uninstall would
        # "restore" an already-routed config (revert-via-original-backups
        # contract; found on Crucible 2026-06-13).
        if [ ! -f "${OC_JSON}.bak" ]; then
            cp "$OC_JSON" "${OC_JSON}.bak"
            echo -e "  ${GREEN}✓${NC} Backup: openclaw.json.bak (first touch)"
        else
            echo -e "  ${CYAN}•${NC} Keeping existing openclaw.json.bak (first-touch backup wins)"
        fi

        NEW_API_BASE="http://127.0.0.1:${LITELLM_PORT}/v1"

        # Use Python to update all provider baseUrl fields (nested under models.providers.*.baseUrl)
        python3 << PYEOF
import json, sys

try:
    with open("$OC_JSON", "r") as f:
        data = json.load(f)

    providers = data.get("models", {}).get("providers", {})
    changed = 0
    for pid, prov in providers.items():
        old_url = prov.get("baseUrl", "")
        # Empty baseUrl: a prior ClawNex uninstall without a first-touch
        # backup clears proxied baseUrls (it cannot know the original).
        # Treat those as routable — re-pointing them at the proxy restores
        # the pre-uninstall state (live gap found on Crucible 2026-06-13).
        if not old_url:
            print(f"  {pid}: (empty — cleared by prior uninstall) → ${NEW_API_BASE}")
            prov["baseUrl"] = "${NEW_API_BASE}"
            changed += 1
        elif "127.0.0.1:${LITELLM_PORT}" not in old_url and "localhost:${LITELLM_PORT}" not in old_url:
            # Skip external APIs that shouldn't be routed locally (Google, NVIDIA, etc.)
            if any(ext in old_url for ext in ["googleapis.com", "nvidia.com", "openai.com", "anthropic.com"]) and "openrouter" not in pid.lower():
                print(f"  Skipped {pid}: {old_url} (external API)")
                continue
            print(f"  {pid}: {old_url} → ${NEW_API_BASE}")
            prov["baseUrl"] = "${NEW_API_BASE}"
            changed += 1

    if changed > 0:
        with open("$OC_JSON", "w") as f:
            json.dump(data, f, indent=2)
        print(f"  Updated {changed} provider(s)")
    else:
        print("  No local providers found to route")
except Exception as e:
    print(f"  Error: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF

        if [ $? -eq 0 ]; then
            echo -e "  ${GREEN}✓${NC} openclaw.json updated — traffic will flow through ClawNex shield"
        else
            echo -e "  ${YELLOW}⚠${NC} Could not update openclaw.json automatically"
            echo "  Manually set baseUrl in each provider to ${NEW_API_BASE}"
        fi
    else
        echo -e "  ${YELLOW}⚠${NC} OpenClaw traffic will NOT be scanned by ClawNex shield"
        echo "  To enable later, update provider baseUrl in openclaw.json to http://127.0.0.1:${LITELLM_PORT}/v1"
    fi
else
    echo -e "  ${CYAN}•${NC} Skipped — no OpenClaw installation detected"
fi

echo ""

# =============================================================================
# [8/10] Optional Services
# =============================================================================
echo -e "${BOLD}[8/10] Optional services...${NC}"

# Handle migration imports
if [ "$INSTALL_MODE" = "migrate" ]; then
    echo "  Importing migration package..."
    MIGRATE_DIR=$(mktemp -d)
    tar -xzf "$MIGRATE_PATH" -C "$MIGRATE_DIR" 2>/dev/null || cp "$MIGRATE_PATH" "$MIGRATE_DIR/"

    MIGRATED_DB=$(find "$MIGRATE_DIR" -name "sentinel.db" -type f | head -1)
    if [ -n "$MIGRATED_DB" ]; then
        cp "$MIGRATED_DB" "$INSTALL_DIR/sentinel.db"
        # DAST 2026-05-15 H2 defense-in-depth: tighten perms on the
        # imported DB immediately. The runtime DB-open path in
        # src/lib/db/index.ts re-chmods on first connection, but the
        # window between import and first dashboard launch can be
        # hours. cp inherits the destination umask (typically 644);
        # narrow to 600 so the operator credentials hash + session
        # token hash + audit log can't be read by other host users.
        chmod 600 "$INSTALL_DIR/sentinel.db" 2>/dev/null || true
        echo -e "  ${GREEN}✓${NC} Database imported from migration package"
    fi

    MIGRATED_ENV=$(find "$MIGRATE_DIR" -name ".env" -type f | head -1)
    if [ -n "$MIGRATED_ENV" ]; then
        cp "$MIGRATED_ENV" "$INSTALL_DIR/.env"
        echo -e "  ${GREEN}✓${NC} Environment file imported"
    fi

    MIGRATED_LITELLM=$(find "$MIGRATE_DIR" -name "config.yaml" -type f | head -1)
    if [ -n "$MIGRATED_LITELLM" ]; then
        cp "$MIGRATED_LITELLM" "$INSTALL_DIR/litellm/"
        echo -e "  ${GREEN}✓${NC} LiteLLM config imported"
    fi

    rm -rf "$MIGRATE_DIR"
fi

# Generate .env with detected paths
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ] || [ "$INSTALL_MODE" = "fresh" ]; then
    echo "  Generating .env configuration..."
    cat > "$ENV_FILE" << EOF
# ClawNex v${CLAWNEX_VERSION} Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# OpenClaw Integration
OPENCLAW_HOME=${OPENCLAW_PATH:-$HOME/.openclaw}
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_TOKEN}
OPENCLAW_SESSIONS_PATH=${OPENCLAW_PATH:-$HOME/.openclaw}/agents/main/sessions
OPENCLAW_WORKSPACE_PATH=${OPENCLAW_PATH:-$HOME/.openclaw}/workspace

# Ports
PORT=${DASHBOARD_PORT}
LITELLM_PORT=${LITELLM_PORT}

# Session Watcher
SESSION_WATCHER_ENABLED=true
SESSION_WATCHER_INTERVAL_MS=10000

# LiteLLM (pinned for supply chain safety)
LITELLM_VERSION=${LITELLM_VERSION}

# LiteLLM shared secret (generated by setup.sh)
LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
EOF
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} .env generated"
else
    echo -e "  ${GREEN}✓${NC} .env exists (preserving)"
    if [ -n "$OPENCLAW_PATH" ]; then
        # Cross-platform sed -i (BSD vs GNU); see SED_INPLACE setup below
        if [ "$OS_TYPE" = "Darwin" ]; then
            sed -i '' "s|OPENCLAW_HOME=.*|OPENCLAW_HOME=${OPENCLAW_PATH}|" "$ENV_FILE" 2>/dev/null || true
        else
            sed -i "s|OPENCLAW_HOME=.*|OPENCLAW_HOME=${OPENCLAW_PATH}|" "$ENV_FILE" 2>/dev/null || true
        fi
    fi
fi

# Session Watcher
# Cross-platform sed -i: BSD/macOS requires `sed -i ''`, GNU/Linux uses `sed -i`.
# `|| true` keeps `set -e` from killing the script if the pattern doesn't match.
if [ "$OS_TYPE" = "Darwin" ]; then SED_INPLACE=(sed -i '' -e); else SED_INPLACE=(sed -i -e); fi

if [ -n "$OPENCLAW_PATH" ]; then
    _tty_read "  Enable session watcher (scans agent session files)? (yes/no) [yes]: " ENABLE_WATCHER
    ENABLE_WATCHER=${ENABLE_WATCHER:-yes}
    if [ "$ENABLE_WATCHER" = "no" ]; then
        "${SED_INPLACE[@]}" "s|SESSION_WATCHER_ENABLED=.*|SESSION_WATCHER_ENABLED=false|" "$ENV_FILE" 2>/dev/null || true
        echo -e "  ${CYAN}•${NC} Session watcher: disabled"
    else
        echo -e "  ${GREEN}✓${NC} Session watcher: enabled"
    fi
else
    "${SED_INPLACE[@]}" "s|SESSION_WATCHER_ENABLED=.*|SESSION_WATCHER_ENABLED=false|" "$ENV_FILE" 2>/dev/null || true
    echo -e "  ${CYAN}•${NC} Session watcher: disabled (no OpenClaw found)"
fi

# Watchdog cron
_tty_read "  Install watchdog cron (auto-restarts crashed services every 5min)? (yes/no) [yes]: " ENABLE_WATCHDOG
ENABLE_WATCHDOG=${ENABLE_WATCHDOG:-yes}
if is_yes "$ENABLE_WATCHDOG" && [ -f "$INSTALL_DIR/scripts/watchdog.sh" ]; then
    if command -v crontab >/dev/null 2>&1; then
        # Stamp our cron line with an exact "# clawnex-watchdog" marker so the
        # uninstall script can target our line and only our line, not any other
        # cron entry that happens to contain the substring "watchdog" (CX-G5
        # fix from 2026-04-26 adversarial review).
        (crontab -l 2>/dev/null | grep -v "# clawnex-watchdog"; echo "*/5 * * * * bash $INSTALL_DIR/scripts/watchdog.sh >> $INSTALL_DIR/logs/watchdog.log 2>&1 # clawnex-watchdog") | crontab -
        mkdir -p "$INSTALL_DIR/logs"
        echo -e "  ${GREEN}✓${NC} Watchdog cron installed (every 5 minutes)"
    else
        echo -e "  ${YELLOW}!${NC} Watchdog skipped — 'crontab' not installed."
        echo "    To enable later: sudo apt install -y cron && re-run setup.sh"
    fi
else
    echo -e "  ${CYAN}•${NC} Watchdog: skipped"
fi

# Daily backup cron
_tty_read "  Enable daily database backup (3:00 AM)? (yes/no) [no]: " ENABLE_BACKUP
ENABLE_BACKUP=${ENABLE_BACKUP:-no}
if is_yes "$ENABLE_BACKUP"; then
    if command -v crontab >/dev/null 2>&1; then
        (crontab -l 2>/dev/null | grep -v "system/archive"; echo "0 3 * * * curl -s -X POST http://127.0.0.1:${DASHBOARD_PORT}/api/system/archive > /dev/null 2>&1") | crontab -
        echo -e "  ${GREEN}✓${NC} Daily backup cron installed (3:00 AM)"
    else
        echo -e "  ${YELLOW}!${NC} Daily backup skipped — 'crontab' not installed."
        echo "    To enable later: sudo apt install -y cron && re-run setup.sh"
    fi
else
    echo -e "  ${CYAN}•${NC} Daily backup: skipped (can enable later from Configuration)"
fi

# Host security scanner
if [ -x "$INSTALL_DIR/third_party/clawkeeper/clawkeeper.sh" ]; then
    echo -e "  ${GREEN}✓${NC} Host security scanner bundled with ClawNex"
else
    echo -e "  ${YELLOW}!${NC} Bundled host security scanner missing — Security Posture scans will be unavailable"
fi

# CVE sync
_tty_read "  Sync CVE database from GitHub now? (yes/no) [yes]: " SYNC_CVE
SYNC_CVE=${SYNC_CVE:-yes}
echo ""

# =============================================================================
# [9/10] Configure Authentication + Generate Secrets + Write .env.local
#
# CRITICAL ORDERING: this step MUST run before [10/10] build. Next.js's
# optimizer evaluates `process.env.X === 'string'` expressions at build
# time and bakes the result into the compiled bundle. If we build before
# .env.local exists, RBAC_ENABLED gets baked as `false` regardless of
# what runtime sees later. (Caught the hard way on Crucible 2026-04-25.)
# =============================================================================
echo -e "${BOLD}[9/10] Configuring authentication + generating secrets...${NC}"

ENV_LOCAL_PATH="$INSTALL_DIR/.env.local"

# Topology choice — single highest-leverage UX decision in the whole
# installer. Most operators want Local (laptop, single user, no DNS,
# no Caddy); some want Public-facing (multi-operator, HTTPS, Caddy,
# RBAC, magic-URL admin setup). Local mode asks a second auth-posture
# question so operators can choose first-admin RBAC or simpler localhost-only
# no-RBAC behavior. Asking this upfront lets us skip irrelevant prompts AND
# set the right env so the Edge middleware bakes RBAC correctly on the next
# build step.
echo ""
echo "  Will this be:"
echo "    [1] Local — laptop or single-operator host. Localhost only,"
echo "                no domain or DNS. You'll choose auth posture next."
echo "    [2] Public-facing — multi-operator. RBAC on, public domain, HTTPS via"
echo "                        Caddy. You'll need a domain pointed at this server"
echo "                        and run ./deploy/install-prod.sh after this finishes."
echo ""

# Explicit-answer required — no silent topology default. The local auth
# posture has its own prompt below because "Local" can legitimately mean
# RBAC-on first-admin setup or RBAC-off localhost-only operation.
while true; do
    _tty_read "  Select [1] Local or [2] Public-facing (no default — must pick): " INSTALL_TOPOLOGY
    case "$INSTALL_TOPOLOGY" in
        1|2) break ;;
        "") echo "    Please type 1 or 2 (no default — explicit answer required)." ;;
        *)  echo "    '$INSTALL_TOPOLOGY' isn't 1 or 2 — please type 1 or 2." ;;
    esac
done

# Defaults — overridden below for public-facing mode. install-prod.sh later
# patches AUTH_RP_ID + AUTH_EXPECTED_ORIGIN to the real public domain too,
# so even a "public" answer here is fine — install-prod is the source of
# truth for domain config in production.
DEFAULT_RP_ID="localhost"
DEFAULT_RP_ORIGIN="http://localhost:${DASHBOARD_PORT}"
RBAC_ENABLED_VAL="true"
NEXT_PUBLIC_RBAC_ENABLED_VAL="true"
INSTALL_TOPOLOGY_LABEL="Local (RBAC on, localhost only)"
PUBLIC_DOMAIN=""

if [ "$INSTALL_TOPOLOGY" = "1" ]; then
    echo ""
    echo "  Local authentication:"
    echo "    [1] RBAC on  — first-admin setup, operators, sessions (recommended)"
    echo "    [2] RBAC off — localhost-only, no login/setup wizard"
    echo ""
    while true; do
        _tty_read "  Select local auth mode [1/2] [1]: " LOCAL_AUTH_MODE
        LOCAL_AUTH_MODE="${LOCAL_AUTH_MODE:-1}"
        case "$LOCAL_AUTH_MODE" in
            1)
                INSTALL_TOPOLOGY_LABEL="Local (RBAC on, localhost only)"
                RBAC_ENABLED_VAL="true"
                NEXT_PUBLIC_RBAC_ENABLED_VAL="true"
                break
                ;;
            2)
                INSTALL_TOPOLOGY_LABEL="Local (RBAC off, localhost only)"
                RBAC_ENABLED_VAL="false"
                NEXT_PUBLIC_RBAC_ENABLED_VAL="false"
                break
                ;;
            *) echo "    '$LOCAL_AUTH_MODE' isn't 1 or 2 — please type 1 or 2." ;;
        esac
    done
elif [ "$INSTALL_TOPOLOGY" = "2" ]; then
    INSTALL_TOPOLOGY_LABEL="Public-facing (RBAC on)"
    RBAC_ENABLED_VAL="true"
    NEXT_PUBLIC_RBAC_ENABLED_VAL="true"
    echo ""
    echo -e "  ${CYAN}Public-facing mode${NC} — DNS prerequisite check:"
    echo -e "    Before continuing, your public domain must already point at this"
    echo -e "    server's IP (A record). install-prod.sh later asks Let's Encrypt"
    echo -e "    for a cert via tls-alpn-01 — that handshake fails if DNS isn't"
    echo -e "    resolving. You can still bake the install with the wrong domain"
    echo -e "    and re-run install-prod.sh once DNS is fixed."
    echo ""
    _tty_read "  Public domain (e.g. clawnex.example.com): " PUBLIC_DOMAIN
    # CX-G6 fix (2026-04-26 adversarial review): validate the domain before
    # writing it into .env.local. An unvalidated input could embed newlines /
    # control chars and inject extra env-var lines (or, in install-prod.sh,
    # extra Caddy directives running under sudo).
    #
    # Allowed: letters, digits, dots, hyphens. Reject leading dot/hyphen.
    # Anything else (whitespace, control chars, quotes, slashes, semicolons,
    # backticks, $) is refused.
    if [ -n "$PUBLIC_DOMAIN" ]; then
        if ! [[ "$PUBLIC_DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
            echo -e "  ${RED}✗${NC} Invalid domain '${PUBLIC_DOMAIN}' — must contain only letters, digits, dots, hyphens (no whitespace, no scheme, no path). Refusing to bake."
            exit 1
        fi
        DEFAULT_RP_ID="$PUBLIC_DOMAIN"
        DEFAULT_RP_ORIGIN="https://${PUBLIC_DOMAIN}"
        echo -e "  ${GREEN}✓${NC} AUTH_RP_ID + AUTH_EXPECTED_ORIGIN will be set for ${PUBLIC_DOMAIN}"
    else
        echo -e "  ${YELLOW}⚠${NC} No domain entered — defaulting to localhost. Re-run setup.sh or install-prod.sh later to fix."
    fi
fi
echo -e "  ${GREEN}✓${NC} Topology: ${INSTALL_TOPOLOGY_LABEL}"
echo ""

# If .env.local already exists with secrets, preserve them (don't rotate
# on every re-run). Otherwise generate new ones.
EXISTING_SETUP_SECRET=""
EXISTING_INGEST_SECRET=""
EXISTING_SESSION_SECRET=""
if [ -f "$ENV_LOCAL_PATH" ]; then
    EXISTING_SETUP_SECRET=$(grep -E "^SETUP_SECRET=" "$ENV_LOCAL_PATH" | head -1 | cut -d= -f2-)
    EXISTING_INGEST_SECRET=$(grep -E "^CLAWNEX_INGEST_SECRET=" "$ENV_LOCAL_PATH" | head -1 | cut -d= -f2-)
    EXISTING_SESSION_SECRET=$(grep -E "^SESSION_SECRET=" "$ENV_LOCAL_PATH" | head -1 | cut -d= -f2-)
fi

SETUP_SECRET="${EXISTING_SETUP_SECRET:-$(openssl rand -hex 32)}"
INGEST_SECRET="${EXISTING_INGEST_SECRET:-$(openssl rand -hex 32)}"
# DAST 2026-05-15 C1: SESSION_SECRET keys the CSRF HMAC binding (see
# src/lib/auth/csrf-hmac.ts). Rotating it invalidates every existing
# session's CSRF capability — operators stay logged in but every
# mutation 403s until the dashboard remounts and pulls a fresh token
# from /api/auth/csrf. Preserve across re-runs so a benign setup re-
# invocation doesn't disrupt an active operator.
SESSION_SECRET="${EXISTING_SESSION_SECRET:-$(openssl rand -hex 32)}"

if [ -n "$EXISTING_SETUP_SECRET" ]; then
    if [ "$RBAC_ENABLED_VAL" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Reusing existing SETUP_SECRET from .env.local (no rotation on re-run)"
    else
        echo -e "  ${GREEN}✓${NC} Reusing existing SETUP_SECRET from .env.local (inactive while RBAC is off)"
    fi
else
    if [ "$RBAC_ENABLED_VAL" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} Fresh SETUP_SECRET generated (64 hex chars)"
    else
        echo -e "  ${GREEN}✓${NC} Fresh SETUP_SECRET generated (inactive while RBAC is off)"
    fi
fi
if [ -n "$EXISTING_SESSION_SECRET" ]; then
    echo -e "  ${GREEN}✓${NC} Reusing existing SESSION_SECRET from .env.local"
else
    echo -e "  ${GREEN}✓${NC} Fresh SESSION_SECRET generated (64 hex chars)"
fi

# Optional: prompt for GitHub OAuth credentials. Only public-facing setup asks
# here; local RBAC installs can configure OAuth later from Authentication
# Methods, and local RBAC-off installs have no login surface.
GH_CLIENT_ID=""
GH_CLIENT_SECRET=""
GH_CALLBACK_URL=""
CONFIGURE_GITHUB_OAUTH="no"
if [ "$INSTALL_TOPOLOGY" = "2" ]; then
    echo ""
    echo -e "  ${CYAN}GitHub OAuth (optional)${NC} — pre-seed credentials from a registered OAuth app."
    echo -e "  ${CYAN}Register at:${NC} https://github.com/settings/developers/new"
    echo -e "  ${CYAN}Callback URL to register:${NC} ${DEFAULT_RP_ORIGIN}/api/auth/github/callback"
    _tty_read "  Configure GitHub OAuth now? (yes/no) [no]: " CONFIGURE_GITHUB_OAUTH
    CONFIGURE_GITHUB_OAUTH=${CONFIGURE_GITHUB_OAUTH:-no}
fi

if is_yes "$CONFIGURE_GITHUB_OAUTH"; then
    _tty_read "  GitHub OAuth Client ID (Iv1.xxxx...): " GH_CLIENT_ID
    _tty_read "  GitHub OAuth Client Secret: " GH_CLIENT_SECRET
    _tty_read "  Callback URL [${DEFAULT_RP_ORIGIN}/api/auth/github/callback]: " GH_CALLBACK_URL
    GH_CALLBACK_URL=${GH_CALLBACK_URL:-${DEFAULT_RP_ORIGIN}/api/auth/github/callback}
    # CX-G6 fix: validate GitHub OAuth inputs before they get written into
    # .env.local. Client ID format is documented by GitHub as Iv1.xxxxxxxx
    # (legacy) or Ov23xxxxxxxxxx (newer App-style); both are alphanumeric
    # plus the leading "Iv1." or "Ov23". Secret is always alphanumeric.
    # Callback URL must be a valid http(s):// URL with no whitespace.
    if [ -n "$GH_CLIENT_ID" ] && ! [[ "$GH_CLIENT_ID" =~ ^[A-Za-z0-9.]+$ ]]; then
        echo -e "  ${RED}✗${NC} Invalid GitHub Client ID format. Refusing to bake."
        exit 1
    fi
    if [ -n "$GH_CLIENT_SECRET" ] && ! [[ "$GH_CLIENT_SECRET" =~ ^[A-Za-z0-9_]+$ ]]; then
        echo -e "  ${RED}✗${NC} Invalid GitHub Client Secret format. Refusing to bake."
        exit 1
    fi
    if [ -n "$GH_CALLBACK_URL" ] && ! [[ "$GH_CALLBACK_URL" =~ ^https?://[A-Za-z0-9.:/_-]+$ ]]; then
        echo -e "  ${RED}✗${NC} Invalid GitHub callback URL. Must be http(s)://hostname/path with no whitespace. Refusing to bake."
        exit 1
    fi
    if [ -n "$GH_CLIENT_ID" ] && [ -n "$GH_CLIENT_SECRET" ]; then
        echo -e "  ${GREEN}✓${NC} GitHub OAuth pre-seeded"
    else
        echo -e "  ${YELLOW}⚠${NC} Incomplete GitHub OAuth input — skipped (configure later via UI)"
        GH_CLIENT_ID=""
    fi
fi

# Write .env.local. This is the SINGLE source of runtime config; Next.js
# auto-loads it at both build and runtime. Mode 0600 — operator only.
cat > "$ENV_LOCAL_PATH" <<EOF
# ClawNex .env.local — generated by setup.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Edit freely; .env.local takes precedence over .env defaults.

# RBAC (operator authentication) — value chosen by install topology above.
# Local mode → operator choice, but dashboard binds localhost only.
# Public mode → true, with public URL/TLS configured by install-prod/lib-macos.
RBAC_ENABLED=${RBAC_ENABLED_VAL}
NEXT_PUBLIC_RBAC_ENABLED=${NEXT_PUBLIC_RBAC_ENABLED_VAL}

# First-run admin gate — required to call /api/auth/setup. Use as
# ?secret=<this-value> on the /setup page URL.
SETUP_SECRET=${SETUP_SECRET}

# CSRF HMAC binding key (DAST 2026-05-15 C1). Keys the per-session
# CSRF token. Rotation invalidates every existing session's CSRF
# capability — operators stay logged in but mutations 403 until the
# dashboard remounts. Required for RBAC-on mode.
SESSION_SECRET=${SESSION_SECRET}

# Internal ingest endpoint auth (LiteLLM → ClawNex shield-scan callbacks)
CLAWNEX_INGEST_SECRET=${INGEST_SECRET}

# Multi-auth providers — WebAuthn relying party identity. Keep these
# aligned with the public URL the browser uses to reach ClawNex.
AUTH_RP_ID=${DEFAULT_RP_ID}
AUTH_RP_NAME=ClawNex
AUTH_EXPECTED_ORIGIN=${DEFAULT_RP_ORIGIN}

# GitHub OAuth (v0.9.0+). Operator can also configure via UI after install.
$(if [ -n "$GH_CLIENT_ID" ]; then
    echo "GITHUB_OAUTH_CLIENT_ID=${GH_CLIENT_ID}"
    echo "GITHUB_OAUTH_CLIENT_SECRET=${GH_CLIENT_SECRET}"
    echo "GITHUB_OAUTH_CALLBACK_URL=${GH_CALLBACK_URL}"
else
    echo "# GITHUB_OAUTH_CLIENT_ID="
    echo "# GITHUB_OAUTH_CLIENT_SECRET="
    echo "# GITHUB_OAUTH_CALLBACK_URL=${DEFAULT_RP_ORIGIN}/api/auth/github/callback"
fi)

# Magic Link sign-in token TTL (v0.9.2+). Default 15 minutes, clamped 1-60.
# MAGIC_LINK_EXPIRY_MINUTES=15

# LiteLLM proxy (local) — never exposed externally; only the dashboard
# process talks to it.
LITELLM_HOST=127.0.0.1
LITELLM_PORT=${LITELLM_PORT}

# Dashboard port. The bind host is chosen at start time based on topology:
#   Local mode         → 127.0.0.1
#   Public-facing mode → 0.0.0.0 until the service/reverse-proxy layer owns it
PORT=${DASHBOARD_PORT}
EOF

chmod 600 "$ENV_LOCAL_PATH"
echo -e "  ${GREEN}✓${NC} .env.local written ($(wc -l < "$ENV_LOCAL_PATH") lines, mode 0600)"
echo ""

# =============================================================================
# [10/10] Build and Start
# =============================================================================
echo -e "${BOLD}[10/10] Building and starting services...${NC}"

# Always clean build
echo "  Cleaning previous build..."
rm -rf "$INSTALL_DIR/.next"
echo -e "  ${GREEN}✓${NC} .next cache cleared"

# Build the application
echo "  Building for production..."
cd "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/logs"
BUILD_LOG="$INSTALL_DIR/logs/next-build.log"
if npm run build >"$BUILD_LOG" 2>&1; then
    tail -3 "$BUILD_LOG" | sed 's/^/    /'
else
    echo -e "  ${RED}✗${NC} Production build failed — tail of $BUILD_LOG:"
    tail -60 "$BUILD_LOG" | sed 's/^/    /'
    echo "    Full log: $BUILD_LOG"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Production build complete"

# Database will auto-initialize on first request (schema.ts handles it)
echo -e "  ${GREEN}✓${NC} Database will initialize on first start (16 tables)"

# Start LiteLLM
mkdir -p "$INSTALL_DIR/logs"

if [ "$CLAWNEX_NO_START" = "1" ]; then
    echo -e "  ${CYAN}•${NC} --no-start: skipping LiteLLM + Dashboard launch (service manager owns lifecycle)"
elif [ -f "$LITELLM_CONFIG_FILE" ] && [ "$LITELLM_HAS_VALID_CONFIG" = true ]; then
    echo "  Starting LiteLLM on port ${LITELLM_PORT}..."
    cd "$INSTALL_DIR"

    # Find litellm binary. `|| true` defends against bash 5.2 + set -e:
    # `which` exits 1 when the binary is missing, and a failing command
    # substitution in an assignment statement triggers errexit and silently
    # crashes the whole script. The `|| true` masks the substitution's exit
    # so the assignment always succeeds (with empty value if not found),
    # letting the fallback for-loop run and the missing-binary branch print
    # a real error message.
    LITELLM_BIN="$(command -v litellm 2>/dev/null || true)"
    if [ -z "$LITELLM_BIN" ]; then
        for candidate in /opt/homebrew/bin/litellm "$HOME/.local/bin/litellm" /usr/local/bin/litellm; do
            if [ -f "$candidate" ]; then LITELLM_BIN="$candidate"; break; fi
        done
    fi

    if [ -n "$LITELLM_BIN" ]; then
        nohup "$LITELLM_BIN" --config litellm/config.yaml --host 127.0.0.1 --port $LITELLM_PORT > logs/litellm.log 2>&1 &
        LITELLM_PID=$!
        sleep 5
        if curl -s -m 3 http://127.0.0.1:$LITELLM_PORT/ > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} LiteLLM running and responding (PID: $LITELLM_PID, port: $LITELLM_PORT)"
        elif kill -0 $LITELLM_PID 2>/dev/null; then
            echo -e "  ${YELLOW}⚠${NC} LiteLLM started (PID: $LITELLM_PID) but not responding yet — may need a few more seconds"
        else
            echo -e "  ${RED}✗${NC} LiteLLM failed to start"
            echo "  Log output:"
            tail -10 logs/litellm.log 2>/dev/null
            echo -e "  See docs/17-troubleshooting-guide.md for common issues"
        fi
    else
        echo -e "  ${RED}✗${NC} LiteLLM binary not found"
        echo "  Install with: pip install 'litellm[proxy]==1.83.0'"
        echo "  See docs/17-troubleshooting-guide.md"
    fi
else
    if [ "$LITELLM_HAS_VALID_CONFIG" = false ]; then
        echo -e "  ${YELLOW}⚠${NC} LiteLLM not started — no valid model provider configured"
        echo "  Configure a provider via Configuration tab or re-run setup.sh"
    else
        echo -e "  ${YELLOW}⚠${NC} LiteLLM config not found — skipping (proxy will not be available)"
    fi
fi

# Under --no-start the service layer (systemd/launchd) starts the dashboard
# AFTER this script exits, so everything in this gate — dashboard launch,
# health checks, and provider DB registration (needs the dashboard's first
# start to initialize the schema) — is deferred to the orchestrator.
if [ "$CLAWNEX_NO_START" != "1" ]; then
# Start Dashboard (production mode)
# Bind host follows topology: Local always stays on loopback regardless of
# RBAC posture, while Public-facing direct setup binds all interfaces before
# the production reverse-proxy layer takes over.
if [ "$INSTALL_TOPOLOGY" = "2" ]; then
    DASHBOARD_BIND="0.0.0.0"
else
    DASHBOARD_BIND="127.0.0.1"
fi
echo "  Starting Dashboard on ${DASHBOARD_BIND}:${DASHBOARD_PORT}..."
cd "$INSTALL_DIR"
nohup "$INSTALL_DIR/node_modules/.bin/next" start -p $DASHBOARD_PORT -H $DASHBOARD_BIND > logs/dashboard.log 2>&1 &
DASHBOARD_PID=$!

# Poll for the port to actually bind. Next.js takes 5-15s to fully spawn on
# slower hosts. We DON'T poll the captured PID — `nohup ... &` returns the
# shell's wrapper PID, which exits quickly when next-server takes over,
# making `kill -0 $PID` falsely report "process died" while the real server
# is alive and bringing up the port.
#
# `ss -tln` is the reliable way to detect a bound port on Linux —
# previously used `lsof -ti` which missed the bind on Ubuntu 24 even when
# next-server was running and serving fine, leading to false "✗ Dashboard
# failed to start" messages. Cross-platform fallback to lsof for macOS.
DASHBOARD_OK=""
_port_listening() {
    local port="$1"
    if command -v ss &>/dev/null; then
        ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"
    else
        lsof -ti :"$port" &>/dev/null 2>&1
    fi
}
for i in $(seq 1 60); do
    if _port_listening "$DASHBOARD_PORT"; then
        DASHBOARD_OK=1
        break
    fi
    sleep 0.5
done

if [ -n "$DASHBOARD_OK" ]; then
    echo -e "  ${GREEN}✓${NC} Dashboard running (PID: $DASHBOARD_PID, ${DASHBOARD_BIND}:${DASHBOARD_PORT})"
else
    echo -e "  ${RED}✗${NC} Dashboard failed to start — check logs/dashboard.log"
    echo -e "  See docs/17-troubleshooting-guide.md for common issues"
    echo "    Try manually: cd $INSTALL_DIR && ./node_modules/.bin/next start -p $DASHBOARD_PORT -H $DASHBOARD_BIND"
    echo -e "  ${DIM}Last 5 lines of dashboard.log:${NC}"
    tail -5 logs/dashboard.log 2>/dev/null | sed 's/^/    /'
fi

# Health check
echo ""
echo "  Running health checks..."
sleep 2
DASHBOARD_HEALTH=$(curl -s --max-time 5 http://127.0.0.1:${DASHBOARD_PORT}/api/health 2>/dev/null | grep -o '"status":"ok"' || echo "")
if [ -n "$DASHBOARD_HEALTH" ]; then
    echo -e "  ${GREEN}✓${NC} Dashboard health check passed"
else
    echo -e "  ${YELLOW}⚠${NC} Dashboard health check pending — may still be starting"
fi

if [ "$LITELLM_HAS_VALID_CONFIG" = true ]; then
    LITELLM_HEALTH=$(curl -s --max-time 5 http://127.0.0.1:${LITELLM_PORT}/health 2>/dev/null | grep -o '"healthy"' || echo "")
    if [ -n "$LITELLM_HEALTH" ]; then
        echo -e "  ${GREEN}✓${NC} LiteLLM health check passed"
    else
        echo -e "  ${YELLOW}⚠${NC} LiteLLM health check pending — may still be starting"
    fi
fi

# Register the model provider in the dashboard DB so it shows up in
# Configuration → Model Providers. setup.sh wrote the API key into
# litellm/config.yaml above (so the proxy uses it) but without this step
# the dashboard UI showed an empty providers list and the operator had
# to re-enter the same key manually. Schema is initialized by the
# dashboard's first start, which we just confirmed with the health check.
if [ -n "$PROVIDER_REG_NAME" ] && [ -f "$INSTALL_DIR/clawnex.db" -o -f "$INSTALL_DIR/sentinel.db" ]; then
    if [ -x "$INSTALL_DIR/scripts/register-provider.cjs" ] || [ -f "$INSTALL_DIR/scripts/register-provider.cjs" ]; then
        echo "  Registering ${PROVIDER_REG_NAME} in dashboard providers..."
        PROVIDER_NAME="$PROVIDER_REG_NAME" \
        PROVIDER_TYPE="$PROVIDER_REG_TYPE" \
        PROVIDER_BASE_URL="$PROVIDER_REG_BASE_URL" \
        PROVIDER_API_KEY="$PROVIDER_REG_API_KEY" \
        PROVIDER_MODEL_ID="$PROVIDER_REG_MODEL_ID" \
        node "$INSTALL_DIR/scripts/register-provider.cjs" || \
            echo -e "  ${YELLOW}⚠${NC} Provider registration failed — add manually via Configuration → Model Providers"
    fi
fi
fi  # end CLAWNEX_NO_START gate (dashboard start → health → provider registration)

# Offer to install ~/.local/bin/clawnex symlink so the operator can run
# `clawnex start` from anywhere instead of `~/clawnex/clawnex start`.
# Strictly user-local — no sudo, no system pollution. Skip if the dir
# isn't in PATH (we'd be installing into a black hole).
if [ -x "$INSTALL_DIR/clawnex" ] && ! command -v clawnex &>/dev/null; then
    USER_BIN="$HOME/.local/bin"
    case ":$PATH:" in
        *":$USER_BIN:"*)
            echo ""
            echo -e "  ${DIM}clawnex CLI: a 'clawnex' command shortcut would let you run${NC}"
            echo -e "  ${DIM}'clawnex start|stop|status' from anywhere instead of cd'ing here.${NC}"
            _tty_read "  Install symlink at $USER_BIN/clawnex? (yes/no) [yes]: " INSTALL_SYMLINK
            INSTALL_SYMLINK=${INSTALL_SYMLINK:-yes}
            if is_yes "$INSTALL_SYMLINK"; then
                mkdir -p "$USER_BIN"
                if ln -sf "$INSTALL_DIR/clawnex" "$USER_BIN/clawnex"; then
                    echo -e "  ${GREEN}✓${NC} Installed: $USER_BIN/clawnex → $INSTALL_DIR/clawnex"
                else
                    echo -e "  ${YELLOW}⚠${NC} Could not install CLI shortcut at $USER_BIN/clawnex"
                    echo -e "    Run from this directory instead: $INSTALL_DIR/clawnex"
                fi
            else
                echo -e "  ${DIM}Skipped — run via $INSTALL_DIR/clawnex instead.${NC}"
            fi
            ;;
        *)
            echo ""
            echo -e "  ${DIM}Tip: $USER_BIN is not in your PATH. To enable 'clawnex' globally:${NC}"
            echo -e "  ${DIM}  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc${NC}"
            echo -e "  ${DIM}  ln -sf $INSTALL_DIR/clawnex \$HOME/.local/bin/clawnex${NC}"
            ;;
    esac
fi

# CVE sync (after dashboard is running — deferred to orchestrator under --no-start)
if [ "$CLAWNEX_NO_START" != "1" ] && is_yes "$SYNC_CVE"; then
    echo "  Syncing CVE database..."
    sleep 3
    CVE_RESULT=$(curl -s -X POST "http://127.0.0.1:${DASHBOARD_PORT}/api/cve/sync" 2>/dev/null)
    CVE_COUNT=$(echo "$CVE_RESULT" | grep -o '"synced":[0-9]*' | cut -d: -f2)
    if [ -n "$CVE_COUNT" ]; then
        echo -e "  ${GREEN}✓${NC} ${CVE_COUNT} CVEs synced from GitHub"
    else
        echo -e "  ${YELLOW}⚠${NC} CVE sync failed — can be done later from Security Posture tab"
    fi
fi

echo ""

# =============================================================================
# Summary
# =============================================================================
if [ "$CLAWNEX_NO_START" = "1" ]; then
    SUMMARY_STATUS="setup complete"
else
    SUMMARY_STATUS="is running!"
fi
echo -ne "${GREEN}${BOLD}"
box_top 54
box_line "        ClawNex v${CLAWNEX_VERSION} ${SUMMARY_STATUS}" 54
box_line "        A ProBizSystems Product" 54
box_bot 54
echo -e "${NC}"
echo ""

# ╭──────────────────────────────────────────────────────────────────────╮
# │  Topology-aware final-message — Local mode stays localhost-only and  │
# │  may run with RBAC on or off. Public mode shows the magic URL like   │
# │  before AND reminds them install-prod.sh is the next step for Caddy  │
# │  + systemd + HTTPS.                                                  │
# ╰──────────────────────────────────────────────────────────────────────╯
if [ "$CLAWNEX_NO_START" = "1" ]; then
    echo -e "  ${CYAN}•${NC} setup.sh finished build/config only."
    echo -e "    The outer installer is about to install and start the service layer."
    echo -e "    Dashboard target after service start: ${DEFAULT_RP_ORIGIN}"
    echo ""
elif [ "$INSTALL_TOPOLOGY" = "2" ]; then
    # Public-facing mode requires Caddy + LE cert before the dashboard is
    # actually reachable at https://${PUBLIC_DOMAIN}. Without that step,
    # the operator hits "ERR_CONNECTION_TIMED_OUT" on their domain and is
    # confused. Auto-prompt the install-prod.sh chain. (Was a separate
    # step the operator had to find in docs — caught on Crucible 2026-04-27.)
    echo -e "${YELLOW}${BOLD}"
    rule 72
    echo -e "  PUBLIC-FACING MODE — one step to go for TLS"
    rule 72
    echo -e "${NC}"
    echo ""
    echo -e "  Your dashboard is running on ${BOLD}port ${DASHBOARD_PORT}${NC} but TLS isn't"
    echo -e "  set up yet. Until it is, ${BOLD}https://${PUBLIC_DOMAIN}${NC} won't resolve."
    echo ""
    echo -e "  ${BOLD}deploy/install-prod.sh${NC} finishes the production setup:"
    echo -e "    • install Caddy as a reverse proxy on :80 + :443"
    echo -e "    • acquire a Let's Encrypt cert for ${PUBLIC_DOMAIN}"
    echo -e "    • create a systemd unit so the dashboard auto-restarts"
    echo -e "    • print your final HTTPS setup URL"
    echo ""
    echo -e "  ${DIM}(Requires sudo. Pre-requisite: DNS A record for ${PUBLIC_DOMAIN} already points here.)${NC}"
    echo ""
    if [ "$CLAWNEX_NO_START" = "1" ]; then
        RUN_INSTALL_PROD="no"   # orchestrator owns the service layer
    else
        _tty_read "  Run deploy/install-prod.sh ${PUBLIC_DOMAIN} now? (yes/no) [yes]: " RUN_INSTALL_PROD
        RUN_INSTALL_PROD=${RUN_INSTALL_PROD:-yes}
    fi

    if is_yes "$RUN_INSTALL_PROD"; then
        echo ""
        echo -e "  ${CYAN}→${NC} Chaining into install-prod.sh..."
        echo ""
        # exec replaces this script with install-prod.sh; the FIRST-RUN ADMIN
        # URL is printed by install-prod.sh after Caddy + cert are up.
        exec bash "$INSTALL_DIR/deploy/install-prod.sh" "$PUBLIC_DOMAIN"
    fi

    # Operator declined — print the HTTP fallback so they can still hit
    # the dashboard for diagnostics, plus a clear "run this when ready" hint.
    LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}' | head -c 64)"
    [ -z "$LOCAL_IP" ] && LOCAL_IP="<server-ip>"
    HTTP_FALLBACK_URL="http://${LOCAL_IP}:${DASHBOARD_PORT}/setup?secret=${SETUP_SECRET}"
    echo ""
    echo -e "  ${YELLOW}Skipped install-prod.sh.${NC} When you're ready for TLS, run:"
    echo ""
    echo "bash deploy/install-prod.sh ${PUBLIC_DOMAIN}"
    echo ""
    echo "  Until then, the dashboard is reachable for diagnostics at:"
    echo ""
    # URL on its own line, no leading whitespace, no color codes — terminals
    # that wrap long lines will re-wrap at column 1 cleanly, and selection /
    # copy-paste won't pick up indentation noise. Boss saw "splitting in the
    # middle of the secret" caused by indented + colored URL output 2026-04-27.
    echo "$HTTP_FALLBACK_URL"
    echo ""
    echo -e "  ${DIM}(plain HTTP, no TLS — passkey registration won't work over this URL)${NC}"
    echo -e "  ${DIM}Recover the secret later: grep SETUP_SECRET ${ENV_LOCAL_PATH}${NC}"
    echo ""
else
    # LOCAL MODE — short URL ("http://localhost:5001"), 70 fits comfortably.
    W=70
    [ ${#DEFAULT_RP_ORIGIN} -gt 60 ] && W=$(( ${#DEFAULT_RP_ORIGIN} + 8 ))
    echo -ne "${GREEN}${BOLD}"
    box_top $W
    box_line "  LOCAL MODE — open the dashboard:" $W
    box_sep $W
    box_line "    ${DEFAULT_RP_ORIGIN}" $W
    box_sep $W
    if [ "$RBAC_ENABLED_VAL" = "true" ]; then
        box_line "  RBAC is on; create the first admin via the setup URL." $W
    else
        box_line "  RBAC is off; localhost-only dashboard, no login." $W
    fi
    box_line "  The dashboard still binds localhost only in Local mode." $W
    box_bot $W
    echo -e "${NC}"
    echo ""
fi

echo -e "  ${BOLD}Dashboard:${NC}  ${DEFAULT_RP_ORIGIN}"
echo -e "  ${BOLD}LiteLLM:${NC}    http://127.0.0.1:${LITELLM_PORT}"
echo -e "  ${BOLD}Install Dir:${NC} ${INSTALL_DIR}"
if [ -n "$OPENCLAW_PATH" ]; then
echo -e "  ${BOLD}OpenClaw:${NC}   ${OPENCLAW_PATH}"
fi
echo ""
echo -e "  ${CYAN}Logs:${NC}"
echo -e "    Dashboard: ${INSTALL_DIR}/logs/dashboard.log"
echo -e "    LiteLLM:   ${INSTALL_DIR}/logs/litellm.log"
if is_yes "$ENABLE_WATCHDOG"; then
echo -e "    Watchdog:  ${INSTALL_DIR}/logs/watchdog.log"
fi
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
if [ "$INSTALL_TOPOLOGY" = "2" ]; then
    echo -e "    1. Open the magic URL above to create your admin account"
    echo -e "    2. Walk the Welcome Wizard (Configuration → providers → Host Security → CVE → routing → shield test)"
    echo -e "    3. Run ./deploy/install-prod.sh ${PUBLIC_DOMAIN:-yourdomain.com} for Caddy + systemd + HTTPS"
    echo -e "    4. Configuration → Authentication Methods — turn on GitHub OAuth / Magic Link as desired"
else
    echo -e "    1. Open the dashboard at ${DEFAULT_RP_ORIGIN}"
    if [ "$RBAC_ENABLED_VAL" = "true" ]; then
        echo -e "    2. Create the first admin from the setup URL printed by install.sh"
        echo -e "    3. Walk the Welcome Wizard (Configuration → providers → Host Security → CVE → routing → shield test)"
    else
        echo -e "    2. Walk the Welcome Wizard (Configuration → providers → Host Security → CVE → routing → shield test)"
    fi
fi
echo ""
echo -e "  ${BOLD}Service commands:${NC}"
echo -e "    ${BOLD}clawnex start${NC}    │ ${BOLD}clawnex stop${NC}    │ ${BOLD}clawnex restart${NC}"
echo -e "    ${BOLD}clawnex status${NC}   │ ${BOLD}clawnex logs${NC}    │ ${BOLD}clawnex help${NC}"
if command -v clawnex &>/dev/null; then
    echo -e "    ${DIM}(clawnex is in your PATH — run from anywhere)${NC}"
else
    echo -e "    ${DIM}Run from this directory: ${INSTALL_DIR}/clawnex <command>${NC}"
    echo -e "    ${DIM}or symlink it: ln -s ${INSTALL_DIR}/clawnex ~/.local/bin/clawnex${NC}"
fi
echo ""
echo -e "  ${CYAN}Having issues? See docs/17-troubleshooting-guide.md${NC}"
echo ""
# Plain-text completion marker. Operator-invisible (last "real" line is the
# troubleshooting hint above), but invaluable for automation that needs to
# detect "setup.sh finished without crashing on a missing else branch" vs
# "the script silently exited mid-stream because of a set -e gotcha". Both
# the autonomous test driver and CI harnesses key off this string.
echo "=== ClawNex setup.sh complete ==="
