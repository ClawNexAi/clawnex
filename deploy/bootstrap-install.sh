#!/usr/bin/env bash
# =============================================================================
# ClawNex authenticated release bootstrap
#
# Fetches a private GitHub release asset, verifies its SHA256, extracts it, and
# hands off to the bundled installer. For public releases, the same shape can be
# simplified by removing the Authorization header requirement.
#
# Usage:
#   export CLAWNEX_GITHUB_TOKEN=github_pat_...
#   curl -fsSL \
#     -H "Authorization: Bearer $CLAWNEX_GITHUB_TOKEN" \
#     -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/ClawNexAi/clawnex/contents/deploy/bootstrap-install.sh?ref=v0.15.0-alpha.3" \
#     | bash -s -- --mode vps --domain qa.example.com --provider skip --clean --yes
# =============================================================================

set -euo pipefail

REPO="${CLAWNEX_REPO:-ClawNexAi/clawnex}"
TAG="${CLAWNEX_RELEASE_TAG:-v0.15.0-alpha.3}"
PACKAGE_DIR="${CLAWNEX_PACKAGE_DIR:-clawnex-v0.15.0-alpha-deploy}"
TARBALL="${CLAWNEX_TARBALL:-clawnex-v0.15.0-alpha-deploy-7ea12c2-7b5ffd84.tar.gz}"
TARBALL_SHA256="${CLAWNEX_TARBALL_SHA256:-7b5ffd8440b57c3e8bf8e5bccdfd9f1f6d225b6bbd0d0227f5f4459b1240a0d8}"
API="${GITHUB_API_URL:-https://api.github.com}"
INSTALL_PARENT="${CLAWNEX_INSTALL_PARENT:-$HOME}"
TOKEN="${CLAWNEX_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"

red='\033[0;31m'
green='\033[0;32m'
cyan='\033[0;36m'
bold='\033[1m'
nc='\033[0m'

die() { printf "%b\n" "${red}x${nc} $*" >&2; exit 1; }
ok() { printf "%b\n" "  ${green}ok${nc} $*"; }
info() { printf "%b\n" "  ${cyan}-${nc} $*"; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar >/dev/null 2>&1 || die "tar is required"
command -v shasum >/dev/null 2>&1 || die "shasum is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required for private GitHub release asset lookup"
[ -n "$TOKEN" ] || die "Set CLAWNEX_GITHUB_TOKEN to a GitHub token with Contents: read access to $REPO"

printf "%b\n" "${cyan}${bold}ClawNex private alpha installer${nc}"
info "Repo: $REPO"
info "Release tag: $TAG"
info "Install parent: $INSTALL_PARENT"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

RELEASE_JSON="$TMP_DIR/release.json"
ASSET_OUT="$TMP_DIR/$TARBALL"

curl_json_headers=(
  -H "Authorization: Bearer $TOKEN"
  -H "Accept: application/vnd.github+json"
  -H "X-GitHub-Api-Version: 2022-11-28"
)

info "Fetching private release metadata"
curl -fsSL "${curl_json_headers[@]}" "$API/repos/$REPO/releases/tags/$TAG" -o "$RELEASE_JSON"

ASSET_ID="$(python3 - "$RELEASE_JSON" "$TARBALL" <<'PY'
import json
import sys

release_path, asset_name = sys.argv[1], sys.argv[2]
with open(release_path, "r", encoding="utf-8") as handle:
    data = json.load(handle)

for asset in data.get("assets", []):
    if asset.get("name") == asset_name:
        print(asset.get("id"))
        break
PY
)"
[ -n "$ASSET_ID" ] || die "Release asset not found: $TARBALL"

info "Downloading deployment tarball"
curl -fL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/octet-stream" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$API/repos/$REPO/releases/assets/$ASSET_ID" \
  -o "$ASSET_OUT"

info "Verifying SHA256"
ACTUAL_SHA="$(shasum -a 256 "$ASSET_OUT" | awk '{print $1}')"
[ "$ACTUAL_SHA" = "$TARBALL_SHA256" ] || die "SHA256 mismatch. Expected $TARBALL_SHA256, got $ACTUAL_SHA"
ok "SHA256 verified: $ACTUAL_SHA"

mkdir -p "$INSTALL_PARENT"
info "Extracting to $INSTALL_PARENT"
tar -xzf "$ASSET_OUT" -C "$INSTALL_PARENT"

TARGET_DIR="$INSTALL_PARENT/$PACKAGE_DIR"
[ -f "$TARGET_DIR/install.sh" ] || die "Extracted installer missing: $TARGET_DIR/install.sh"
chmod +x "$TARGET_DIR/install.sh" 2>/dev/null || true
ok "Extracted: $TARGET_DIR"

cd "$TARGET_DIR"
exec bash ./install.sh "$@"
