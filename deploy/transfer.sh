#!/bin/bash
# ============================================================================
# ClawNex Transfer Script — Package and SCP to VPS
# ============================================================================
#
# Usage:
#   bash transfer.sh ubuntu@<vps-ip>
#   bash transfer.sh ubuntu@100.x.x.x          # Tailscale IP
#   bash transfer.sh ubuntu@<tailscale-hostname>  # Tailscale hostname
#
# What it does:
#   1. Creates a clean tarball (excludes node_modules, venv, .next, db, etc.)
#   2. SCPs it to the VPS
#   3. SSHs in and extracts it
#   4. Prints next steps
#
# ============================================================================

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash transfer.sh user@host"
  echo "Example: bash transfer.sh ubuntu@100.64.0.5"
  exit 1
fi

TARGET="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ARCHIVE="/tmp/clawnex-deploy.tar.gz"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}━━━ ClawNex Transfer ━━━${NC}"
echo ""

# Step 1: Create clean tarball
echo -e "${GREEN}[1/4]${NC} Packaging project..."
cd "$(dirname "$PROJECT_DIR")"
tar czf "$ARCHIVE" \
  --exclude='sentinel/node_modules' \
  --exclude='sentinel/.next' \
  --exclude='sentinel/litellm/venv' \
  --exclude='sentinel/litellm/__pycache__' \
  --exclude='sentinel/sentinel.db' \
  --exclude='sentinel/sentinel.db-wal' \
  --exclude='sentinel/sentinel.db-shm' \
  --exclude='sentinel/logs/*' \
  --exclude='sentinel/.DS_Store' \
  --exclude='sentinel/.env.local' \
  --exclude='sentinel/tsconfig.tsbuildinfo' \
  "sentinel/"

SIZE=$(ls -lh "$ARCHIVE" | awk '{print $5}')
echo -e "  Archive: $ARCHIVE ($SIZE)"

# Step 2: SCP to VPS
echo -e "${GREEN}[2/4]${NC} Transferring to $TARGET..."
scp "$ARCHIVE" "$TARGET:/tmp/clawnex-deploy.tar.gz"

# Step 3: Extract on VPS
echo -e "${GREEN}[3/4]${NC} Extracting on VPS..."
ssh "$TARGET" "cd ~ && tar xzf /tmp/clawnex-deploy.tar.gz && rm /tmp/clawnex-deploy.tar.gz"

# Step 4: Clean up local archive
rm -f "$ARCHIVE"

echo -e "${GREEN}[4/4]${NC} Done."
echo ""
echo -e "${CYAN}━━━ Next Steps ━━━${NC}"
echo ""
echo -e "  SSH into the VPS:"
echo -e "    ssh $TARGET"
echo ""
echo -e "  Run the deployment script:"
echo -e "    cd ~/sentinel/deploy"
echo -e "    bash deploy.sh --openrouter-key YOUR_KEY"
echo ""
echo -e "  Or run without OpenRouter key (configure later):"
echo -e "    bash deploy.sh"
echo ""
