#!/bin/bash
# =============================================================================
# ClawNex — Deployment Package Creator (canonical artifact for OSS launch)
#
# Builds a clean, self-contained deployment tarball from the current source
# tree. The tarball is the package any operator can transfer to a fresh
# host and run setup.sh + (optionally) deploy/install-prod.sh against.
#
# What's IN the tarball:
#   - src/, public/ (without dev artifacts)
#   - litellm/ — minus the local Python venv + pycache + personal config.yaml
#     (gets replaced with config.template.yaml so no secrets leak)
#   - scripts/ — including uninstall.sh
#   - third_party/clawkeeper/ — pinned host-security scanner fallback
#   - deploy/install-prod.sh — the Linux/Caddy production layer
#   - setup.sh, package.json, package-lock.json, tsconfig.json,
#     next.config.mjs, tailwind.config.ts, postcss.config.mjs, .gitignore,
#     .env.example
#   - README.md, CHANGELOG.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md,
#     SECURITY.md, SUPPORT.md
#   - Operator-facing docs: 06 basic-user-manual, 07 advanced-user-manual,
#     08 support-ops-manual, 12 deployment-guide, 15 vps-quickstart,
#     17 troubleshooting-guide, 22 keyboard-shortcuts
#   - DEPLOY.md inside the tarball — quick "extract → setup.sh → done"
#
# What's NOT in the tarball (excluded for size + security):
#   - node_modules/ (run `npm ci` after extract)
#   - .next/ (rebuilt during setup)
#   - .git/ (operator doesn't need our commit history)
#   - sentinel.db, *.db-wal, *.db-shm (each install creates its own)
#   - .env, .env.local (each install generates its own SETUP_SECRET etc.)
#   - logs/, backups/ (per-install runtime state)
#   - litellm/venv/, litellm/__pycache__/ (each install rebuilds via pip)
#   - litellm/config.yaml (replaced with template before packaging)
#   - litellm/start.sh (may contain operator-specific paths)
#   - training-video-prototype/ (marketing assets, not runtime)
#   - deploy/clawnex-v*.tar.gz (previous builds, no recursion)
#
# Version: read from package.json on every run, so this script never goes
# stale the way the v0.5.3-hardcoded earlier version did.
#
# Usage: bash deploy/package.sh
# Output: deploy/clawnex-v<version>-deploy.tar.gz
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Pull version from package.json — single source of truth. Fail loudly if
# the file is missing or version line can't be parsed; better than silently
# packaging the wrong version label.
if [ ! -f "$INSTALL_DIR/package.json" ]; then
    echo -e "${RED}✗${NC} package.json not found at ${INSTALL_DIR}/package.json"
    exit 1
fi
VERSION=$(grep -E '^\s*"version"' "$INSTALL_DIR/package.json" | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
if [ -z "$VERSION" ]; then
    echo -e "${RED}✗${NC} Could not parse version from package.json"
    exit 1
fi

PACKAGE_NAME="clawnex-v${VERSION}-deploy"
STAGING_DIR=$(mktemp -d)
BUNDLE_DIR="$STAGING_DIR/$PACKAGE_NAME"
OUTPUT_TARBALL="$INSTALL_DIR/deploy/${PACKAGE_NAME}.tar.gz"

# Ensure staging cleans up on any exit (success, error, ctrl-c).
trap 'rm -rf "$STAGING_DIR"' EXIT

echo ""
echo -e "${CYAN}${BOLD}ClawNex v${VERSION} — Deployment Package Creator${NC}"
echo -e "${CYAN}A ClawNex Project${NC}"
echo ""

mkdir -p "$BUNDLE_DIR"

# -----------------------------------------------------------------------------
# [1/5] Stage the runtime tree.
# -----------------------------------------------------------------------------
echo -e "[1/5] ${BOLD}Staging runtime files...${NC}"

# Core source dirs. Use rsync rather than `cp -r` so we can apply excludes
# inline (skip .DS_Store, pycache, etc. without a separate cleanup pass).
rsync -a \
    --exclude='node_modules/' \
    --exclude='.next/' \
    --exclude='.DS_Store' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='venv/' \
    --exclude='clawkeeper-build/' \
    "$INSTALL_DIR/src/" "$BUNDLE_DIR/src/"
echo -e "  ${GREEN}✓${NC} src/"

if [ -d "$INSTALL_DIR/public" ]; then
    rsync -a --exclude='.DS_Store' "$INSTALL_DIR/public/" "$BUNDLE_DIR/public/"
    echo -e "  ${GREEN}✓${NC} public/"
fi

# data/ ships bundled JSON manifests the runtime reads at startup
# (litellm-model-prices.json for the Token & Cost Intel panel,
# recommended-models.json for the Quick Setup Card). Was missed before —
# dashboards on fresh installs logged ENOENT on /api/health.
if [ -d "$INSTALL_DIR/data" ]; then
    rsync -a --exclude='.DS_Store' "$INSTALL_DIR/data/" "$BUNDLE_DIR/data/"
    echo -e "  ${GREEN}✓${NC} data/"
fi

if [ -d "$INSTALL_DIR/litellm" ]; then
    rsync -a \
        --exclude='venv/' \
        --exclude='__pycache__/' \
        --exclude='*.pyc' \
        --exclude='config.yaml' \
        --exclude='start.sh' \
        --exclude='.DS_Store' \
        "$INSTALL_DIR/litellm/" "$BUNDLE_DIR/litellm/"
    # Substitute the personal config.yaml with the shipped template — same
    # pattern the previous package.sh used; it's the cleanest way to ensure
    # no API keys / proxy URLs leak into a deploy artifact.
    if [ -f "$BUNDLE_DIR/litellm/config.template.yaml" ]; then
        cp "$BUNDLE_DIR/litellm/config.template.yaml" "$BUNDLE_DIR/litellm/config.yaml"
    fi
    echo -e "  ${GREEN}✓${NC} litellm/ (config.yaml replaced with template, venv/pycache stripped)"
fi

if [ -d "$INSTALL_DIR/scripts" ]; then
    rsync -a --exclude='.DS_Store' "$INSTALL_DIR/scripts/" "$BUNDLE_DIR/scripts/"
    echo -e "  ${GREEN}✓${NC} scripts/"
fi

if [ -d "$INSTALL_DIR/third_party" ]; then
    rsync -a \
        --exclude='.DS_Store' \
        "$INSTALL_DIR/third_party/" "$BUNDLE_DIR/third_party/"
    chmod +x "$BUNDLE_DIR/third_party/clawkeeper/clawkeeper.sh" 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} third_party/ (host security scanner)"
fi

# Platform service layers — stay in deploy/ inside the tarball. install.sh
# invokes the right one per mode (Linux: install-prod.sh, macOS: lib-macos.sh).
mkdir -p "$BUNDLE_DIR/deploy"
if [ -f "$INSTALL_DIR/deploy/install-prod.sh" ]; then
    cp "$INSTALL_DIR/deploy/install-prod.sh" "$BUNDLE_DIR/deploy/"
    chmod +x "$BUNDLE_DIR/deploy/install-prod.sh"
    echo -e "  ${GREEN}✓${NC} deploy/install-prod.sh"
fi
if [ -f "$INSTALL_DIR/deploy/lib-macos.sh" ]; then
    cp "$INSTALL_DIR/deploy/lib-macos.sh" "$BUNDLE_DIR/deploy/"
    chmod +x "$BUNDLE_DIR/deploy/lib-macos.sh"
    echo -e "  ${GREEN}✓${NC} deploy/lib-macos.sh"
fi

# -----------------------------------------------------------------------------
# [2/5] Stage root-level config + setup files.
# -----------------------------------------------------------------------------
echo -e "[2/5] ${BOLD}Staging root-level files...${NC}"

ROOT_FILES=(
    package.json
    package-lock.json
    tsconfig.json
    next.config.mjs
    tailwind.config.ts
    postcss.config.mjs
    .gitignore
    .env.example
    setup.sh
    install.sh
    clawnex
    CLAUDE.md
    README.md
    CHANGELOG.md
    CODE_OF_CONDUCT.md
    CONTRIBUTING.md
    SECURITY.md
    SUPPORT.md
    LICENSE
    DCO
)
for f in "${ROOT_FILES[@]}"; do
    if [ -f "$INSTALL_DIR/$f" ]; then
        cp "$INSTALL_DIR/$f" "$BUNDLE_DIR/"
    fi
done
chmod +x "$BUNDLE_DIR/setup.sh" 2>/dev/null || true
chmod +x "$BUNDLE_DIR/install.sh" 2>/dev/null || true
chmod +x "$BUNDLE_DIR/clawnex" 2>/dev/null || true

echo -e "  ${GREEN}✓${NC} root configs + setup.sh + install.sh + readme/license/changelog"

# -----------------------------------------------------------------------------
# [3/5] Stage operator-facing docs. Governance + policies + registers are
# included because the in-product Governance panel renders them via
# /api/docs (whitelist in src/app/api/docs/route.ts). Internal specs /
# proposals / dev-only design docs still stay out of the artifact.
# -----------------------------------------------------------------------------
echo -e "[3/5] ${BOLD}Staging operator docs...${NC}"

mkdir -p "$BUNDLE_DIR/docs"
OPERATOR_DOCS=(
    06-basic-user-manual.md
    07-advanced-user-manual.md
    08-support-operations-manual.md
    12-deployment-guide.md
    15-vps-deployment-quickstart.md
    17-troubleshooting-guide.md
    22-keyboard-shortcuts.md
)
for d in "${OPERATOR_DOCS[@]}"; do
    if [ -f "$INSTALL_DIR/docs/$d" ]; then
        cp "$INSTALL_DIR/docs/$d" "$BUNDLE_DIR/docs/"
    fi
done

# Governance — top-level summaries surfaced by the Governance panel.
GOVERNANCE_TOP_DOCS=(
    governance-index.md
    governance-one-pager.md
    policy-evidence-checklist.md
)
for d in "${GOVERNANCE_TOP_DOCS[@]}"; do
    if [ -f "$INSTALL_DIR/docs/$d" ]; then
        cp "$INSTALL_DIR/docs/$d" "$BUNDLE_DIR/docs/"
    fi
done

# Governance — full policies/ + registers/ subtrees. Whole-tree copy is
# safe because both directories contain only the artifacts the API
# whitelist already allows; nothing internal-only lives in either path.
GOVERNANCE_TREE_COUNT=0
if [ -d "$INSTALL_DIR/docs/policies" ]; then
    mkdir -p "$BUNDLE_DIR/docs/policies"
    cp "$INSTALL_DIR/docs/policies/"*.md "$BUNDLE_DIR/docs/policies/" 2>/dev/null && \
        GOVERNANCE_TREE_COUNT=$((GOVERNANCE_TREE_COUNT + $(ls "$BUNDLE_DIR/docs/policies/"*.md 2>/dev/null | wc -l)))
fi
if [ -d "$INSTALL_DIR/docs/registers" ]; then
    mkdir -p "$BUNDLE_DIR/docs/registers"
    cp "$INSTALL_DIR/docs/registers/"*.md "$BUNDLE_DIR/docs/registers/" 2>/dev/null && \
        GOVERNANCE_TREE_COUNT=$((GOVERNANCE_TREE_COUNT + $(ls "$BUNDLE_DIR/docs/registers/"*.md 2>/dev/null | wc -l)))
fi
TOTAL_DOCS=$((${#OPERATOR_DOCS[@]} + ${#GOVERNANCE_TOP_DOCS[@]} + GOVERNANCE_TREE_COUNT))
echo -e "  ${GREEN}✓${NC} docs/ (${#OPERATOR_DOCS[@]} operator manuals, ${#GOVERNANCE_TOP_DOCS[@]} governance summaries, ${GOVERNANCE_TREE_COUNT} policy + register files = ${TOTAL_DOCS} total)"

# -----------------------------------------------------------------------------
# [4/5] Add an inline DEPLOY.md so a recipient can extract the tarball and
# install without opening a browser tab. Generated fresh every run so
# version + date stamps stay current.
# -----------------------------------------------------------------------------
echo -e "[4/5] ${BOLD}Generating DEPLOY.md...${NC}"

cat > "$BUNDLE_DIR/DEPLOY.md" <<DEPLOY_EOF
# ClawNex v${VERSION} — Deployment Quick Start

This tarball contains everything needed to run ClawNex on a fresh host
(macOS or Linux). No external sources are downloaded except the npm and pip
packages declared in \`package.json\` and \`litellm/requirements.txt\`.

## 1. Extract + install

\`\`\`bash
tar -xzf clawnex-v${VERSION}-deploy.tar.gz
cd clawnex-v${VERSION}-deploy
./setup.sh
\`\`\`

\`setup.sh\` will ask whether this is a **Local** install (laptop, single
operator, RBAC off, ready in 60s) or **Public-facing** (multi-operator,
HTTPS via Caddy, RBAC on). The default is Local. Pick whichever matches
how you're going to use ClawNex.

## 2. (Public-facing only) Run the production layer

\`\`\`bash
./deploy/install-prod.sh <your-public-domain>
\`\`\`

Installs Caddy + systemd unit + Let's Encrypt cert. Requires sudo and a
DNS A record pointing the public domain at this server.

## 3. Open the dashboard

- **Local:** http://localhost:5001
- **Public-facing:** https://your-public-domain — \`setup.sh\` prints a
  one-time admin URL with an embedded \`SETUP_SECRET\` you'll click on
  the first visit. After your admin account is created the secret is inert.

## What's in this package

| Path | Purpose |
|---|---|
| \`src/\`, \`public/\` | Next.js application source + assets |
| \`litellm/\` | LiteLLM proxy + ClawNex logger plugin |
| \`scripts/\` | Operational helpers including \`uninstall.sh\` |
| \`deploy/install-prod.sh\` | Linux production layer (Caddy + systemd) |
| \`setup.sh\` | Cross-platform installer (Mac + Linux) |
| \`docs/\` | Basic + advanced user manuals, ops manual, deployment + troubleshooting guides |
| \`README.md\`, \`CHANGELOG.md\`, etc. | Project meta |

## Need help?

- \`docs/17-troubleshooting-guide.md\` — common install + runtime issues
- \`docs/08-support-operations-manual.md\` — auth provider failures, mail
  config, day-2 operations
- \`docs/12-deployment-guide.md\` — full deployment walkthrough including
  staging-style VPS deploys

ClawNex by ClawNex maintainers — clawnexai.com
Apache 2.0 + DCO. See LICENSE + CONTRIBUTING.md.

Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)
DEPLOY_EOF
echo -e "  ${GREEN}✓${NC} DEPLOY.md generated"

# -----------------------------------------------------------------------------
# [5/5] Defensive secret-scrub pass + tarball.
# -----------------------------------------------------------------------------
echo -e "[5/5] ${BOLD}Secret-scrub + creating tarball...${NC}"

# Belt-and-suspenders: even if rsync somehow let one of these through,
# delete it now. Better one extra `rm` than a leaked secret.
SECRET_PATTERNS=(
    ".env"
    ".env.local"
    "sentinel.db"
    "sentinel.db-shm"
    "sentinel.db-wal"
    "clawnex.db"
    "clawnex.db-shm"
    "clawnex.db-wal"
)
for pattern in "${SECRET_PATTERNS[@]}"; do
    find "$BUNDLE_DIR" -name "$pattern" -delete 2>/dev/null
done
# Catch any rogue logs/, backups/, .next/ that may have crept in
rm -rf "$BUNDLE_DIR/logs" "$BUNDLE_DIR/backups" "$BUNDLE_DIR/.next" 2>/dev/null
# Catch nested deploy tarballs (would happen if package.sh was run earlier and
# we accidentally included its output)
find "$BUNDLE_DIR/deploy" -name 'clawnex-*.tar.gz' -delete 2>/dev/null
echo -e "  ${GREEN}✓${NC} Secret-scrub pass complete"

# Tarball it. -czf so we get a single .tar.gz; -C to root the archive at
# the bundle name so extraction creates `clawnex-vX.Y.Z-deploy/` rather
# than dumping files into the current directory.
mkdir -p "$INSTALL_DIR/deploy"
tar -czf "$OUTPUT_TARBALL" -C "$STAGING_DIR" "$PACKAGE_NAME"
TARBALL_SIZE=$(du -h "$OUTPUT_TARBALL" | awk '{print $1}')
TARBALL_BYTES=$(stat -f %z "$OUTPUT_TARBALL" 2>/dev/null || stat -c %s "$OUTPUT_TARBALL" 2>/dev/null)
echo -e "  ${GREEN}✓${NC} ${OUTPUT_TARBALL} (${TARBALL_SIZE} / ${TARBALL_BYTES} bytes)"

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ClawNex v${VERSION} deployment package ready.${NC}"
echo -e "${GREEN}${BOLD}║  ${OUTPUT_TARBALL}${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Transfer:${NC}  scp ${OUTPUT_TARBALL} user@host:~/"
echo -e "  ${CYAN}Extract:${NC}   tar -xzf $(basename ${OUTPUT_TARBALL}) && cd ${PACKAGE_NAME}"
echo -e "  ${CYAN}Install:${NC}   ./setup.sh"
echo -e "  ${CYAN}Prod (Linux only):${NC}  ./deploy/install-prod.sh <your-domain>"
echo ""
