#!/usr/bin/env bash
# Generate Software Bill of Materials for ClawNex
# Output: sbom.json (CycloneDX format) + sbom.txt (human-readable)
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[SBOM] Generating CycloneDX SBOM for Node deps..."
npm sbom --sbom-format=cyclonedx --omit=dev > sbom.json 2>/dev/null
echo "[SBOM] Node deps SBOM written to sbom.json"
if [ -f litellm/requirements.txt ]; then
  echo "[SBOM] Python deps:"
  {
    echo "# Python dependencies (ClawNex v$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0-unknown"))"
    cat litellm/requirements.txt
  } > sbom-python.txt
  echo "[SBOM] Python deps SBOM written to sbom-python.txt"
fi
echo "[SBOM] Done. Review sbom.json and sbom-python.txt, then optionally attach to GitHub release."
