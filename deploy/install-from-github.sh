#!/usr/bin/env bash
# =============================================================================
# ClawNex public source bootstrap
#
# Idempotent entrypoint for normal users:
#   curl -fsSL https://raw.githubusercontent.com/ClawNexAi/clawnex/main/deploy/install-from-github.sh | bash
#
# This script owns the source checkout step. It clones ClawNex on first run,
# updates an existing clean checkout on retry, and refuses to overwrite
# unrelated or dirty directories unless the operator explicitly agrees.
# install.sh still owns the actual ClawNex installation cleanup/services.
# =============================================================================
set -euo pipefail

REPO_URL="${CLAWNEX_REPO_URL:-https://github.com/ClawNexAi/clawnex.git}"
BRANCH="${CLAWNEX_BRANCH:-main}"
TARGET_DIR="${CLAWNEX_SOURCE_DIR:-$HOME/clawnex}"
REPLACE_SOURCE=0
YES=0
INSTALL_ARGS=()

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[1;33m'
cyan='\033[0;36m'
bold='\033[1m'
nc='\033[0m'

die() { printf "%b\n" "${red}x${nc} $*" >&2; exit 1; }
ok() { printf "%b\n" "  ${green}ok${nc} $*"; }
info() { printf "%b\n" "  ${cyan}-${nc} $*"; }
warn() { printf "%b\n" "  ${yellow}!${nc} $*"; }

usage() {
    cat <<USAGE
ClawNex source bootstrap

Usage:
  install-from-github.sh [bootstrap flags] [-- install.sh flags]

Bootstrap flags:
  --source-dir PATH     Checkout directory (default: \$HOME/clawnex)
  --branch NAME         Git branch to use (default: main)
  --replace-source      Move an unrelated/dirty source dir aside without prompting
  --yes                 Non-interactive for safe choices; install.sh also receives --yes
  -h, --help            Show this help

Examples:
  curl -fsSL https://raw.githubusercontent.com/ClawNexAi/clawnex/main/deploy/install-from-github.sh | bash
  curl -fsSL https://raw.githubusercontent.com/ClawNexAi/clawnex/main/deploy/install-from-github.sh | bash -s -- -- --mode linux-local --provider skip --yes
USAGE
}

can_prompt() {
    [ -t 0 ] && return 0
    [ -c /dev/tty ] && { : >/dev/tty; } 2>/dev/null
}

prompt() {
    local message="$1"
    local var_name="$2"
    if [ -t 0 ]; then
        printf "%s" "$message"
        IFS= read -r "$var_name"
    elif [ -c /dev/tty ] && { : >/dev/tty; } 2>/dev/null; then
        printf "%s" "$message" > /dev/tty
        IFS= read -r "$var_name" < /dev/tty
    else
        die "Need operator input but no TTY is available. Re-run with explicit flags."
    fi
}

is_clawnex_remote() {
    local remote="$1"
    case "$remote" in
        https://github.com/ClawNexAi/clawnex|https://github.com/ClawNexAi/clawnex.git) return 0 ;;
        git@github.com:ClawNexAi/clawnex.git|ssh://git@github.com/ClawNexAi/clawnex.git) return 0 ;;
        *) return 1 ;;
    esac
}

is_empty_dir() {
    [ -d "$1" ] || return 1
    [ -z "$(find "$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]
}

move_existing_source_aside() {
    local existing="$1"
    local stamp backup
    stamp="$(date +%Y%m%d-%H%M%S)"
    backup="${existing}-source-backup-${stamp}"
    mv "$existing" "$backup"
    ok "Moved existing source directory aside: $backup"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --source-dir)
            TARGET_DIR="${2:-}"
            [ -n "$TARGET_DIR" ] || die "--source-dir requires a path"
            shift 2
            ;;
        --branch)
            BRANCH="${2:-}"
            [ -n "$BRANCH" ] || die "--branch requires a value"
            shift 2
            ;;
        --replace-source)
            REPLACE_SOURCE=1
            shift
            ;;
        --yes|-y)
            YES=1
            INSTALL_ARGS+=("$1")
            shift
            ;;
        --)
            shift
            INSTALL_ARGS+=("$@")
            break
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            INSTALL_ARGS+=("$1")
            shift
            ;;
    esac
done

command -v git >/dev/null 2>&1 || die "git is required"

printf "%b\n" "${cyan}${bold}ClawNex source bootstrap${nc}"
info "Repo: $REPO_URL"
info "Branch: $BRANCH"
info "Source dir: $TARGET_DIR"

if [ -e "$TARGET_DIR" ] && [ ! -d "$TARGET_DIR" ]; then
    die "$TARGET_DIR exists but is not a directory"
fi

if [ -d "$TARGET_DIR/.git" ]; then
    remote="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null || true)"
    if ! is_clawnex_remote "$remote"; then
        warn "$TARGET_DIR is a git repo, but origin is not ClawNex: ${remote:-none}"
        if [ "$REPLACE_SOURCE" = "1" ]; then
            move_existing_source_aside "$TARGET_DIR"
        elif can_prompt; then
            choice=""
            prompt "  Move this directory aside and clone ClawNex fresh? (y/N): " choice
            case "${choice:-N}" in
                y|Y|yes|YES) move_existing_source_aside "$TARGET_DIR" ;;
                *) die "Aborted. Existing directory was left untouched." ;;
            esac
        else
            die "Existing non-ClawNex git repo at $TARGET_DIR. Use --replace-source to move it aside."
        fi
    else
        if [ -n "$(git -C "$TARGET_DIR" status --porcelain)" ]; then
            warn "$TARGET_DIR has local source changes"
            if [ "$REPLACE_SOURCE" = "1" ]; then
                move_existing_source_aside "$TARGET_DIR"
            elif can_prompt; then
                choice=""
                prompt "  Move this dirty checkout aside and clone ClawNex fresh? (y/N): " choice
                case "${choice:-N}" in
                    y|Y|yes|YES) move_existing_source_aside "$TARGET_DIR" ;;
                    *) die "Aborted. Existing dirty checkout was left untouched." ;;
                esac
            else
                die "Existing checkout has local changes. Use --replace-source to move it aside."
            fi
        else
            info "Updating existing ClawNex checkout"
            git -C "$TARGET_DIR" fetch --prune origin "$BRANCH"
            git -C "$TARGET_DIR" checkout "$BRANCH" >/dev/null 2>&1 || git -C "$TARGET_DIR" checkout -b "$BRANCH" "origin/$BRANCH"
            git -C "$TARGET_DIR" pull --ff-only origin "$BRANCH"
            ok "Checkout updated"
        fi
    fi
elif [ -d "$TARGET_DIR" ] && ! is_empty_dir "$TARGET_DIR"; then
    warn "$TARGET_DIR exists and is not empty"
    if [ "$REPLACE_SOURCE" = "1" ]; then
        move_existing_source_aside "$TARGET_DIR"
    elif can_prompt; then
        choice=""
        prompt "  Move this directory aside and clone ClawNex fresh? (y/N): " choice
        case "${choice:-N}" in
            y|Y|yes|YES) move_existing_source_aside "$TARGET_DIR" ;;
            *) die "Aborted. Existing directory was left untouched." ;;
        esac
    else
        die "Existing non-empty directory at $TARGET_DIR. Use --replace-source to move it aside."
    fi
fi

if [ ! -d "$TARGET_DIR/.git" ]; then
    mkdir -p "$(dirname "$TARGET_DIR")"
    info "Cloning ClawNex"
    git clone --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
    ok "Cloned into $TARGET_DIR"
fi

cd "$TARGET_DIR"
[ -f install.sh ] || die "install.sh not found in $TARGET_DIR"
chmod +x install.sh 2>/dev/null || true

info "Launching installer"
exec bash ./install.sh "${INSTALL_ARGS[@]}"
