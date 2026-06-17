#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

check_no_match() {
  local label="$1"
  local pattern="$2"
  shift 2
  local tmp
  tmp="$(mktemp)"
  if rg -n "$pattern" "$@" >"$tmp"; then
    echo "  ✗ ${label}"
    cat "$tmp"
    fail=1
  else
    echo "  ✓ ${label}"
  fi
  rm -f "$tmp"
}

existing_paths() {
  local path
  for path in "$@"; do
    if [[ -e "$path" ]]; then
      printf '%s\n' "$path"
    fi
  done
}

echo "[host-security-copy] operator-facing source"
source_string_pattern='("[^"]*(Clawkeeper|ClawKeeper|ClawKepper)|'\''[^'\'']*(Clawkeeper|ClawKeeper|ClawKepper)|`[^`]*(Clawkeeper|ClawKeeper|ClawKepper)|Clawkeeper:)'
check_no_match "dashboard/UI/API copy does not expose legacy scanner name" \
  "$source_string_pattern" \
  src/components \
  src/app/api/chat \
  src/app/api/security \
  setup.sh \
  --glob '!**/node_modules/**'

check_no_match "dashboard/UI/API copy uses ClawNex Shield Rules, not the old rule-pack label" \
  "DefenseClaw Rules|DefenseClaw rules|Defense Claw" \
  src/components \
  src/app/api/chat \
  src/app/api/security \
  setup.sh \
  --glob '!**/node_modules/**'

echo "[host-security-copy] current docs"
doc_targets=()
while IFS= read -r doc_target; do
  doc_targets+=("$doc_target")
done < <(existing_paths \
  docs/01-infrastructure-design.md \
  docs/03-low-level-architecture.md \
  docs/04-product-requirements.md \
  docs/06-basic-user-manual.md \
  docs/07-advanced-user-manual.md \
  docs/12-deployment-guide.md \
  docs/13-release-notes.md \
  docs/14-data-dictionary.md \
  docs/15-vps-deployment-quickstart.md \
  docs/16-deployment-test-walkthrough.md \
  docs/17-troubleshooting-guide.md \
  docs/18-developer-manual.md \
  docs/20-product-roadmap.md \
  docs/qa-test-battery.md \
  docs/qs-connector-guide-matrix.md \
  docs/clawnex-brochure.md \
  docs/go-live-checklist.md \
  docs/simple-install-validation-plan.md \
  docs/video-production-plan.md \
  docs/coordination \
  docs/training-scripts \
  docs/training-workbooks \
  docs/registers)
check_no_match "current manuals and training docs use Host Security naming" \
  "Clawkeeper|ClawKeeper|ClawKepper|Clawkeeper:" \
  "${doc_targets[@]}" \
  --glob '!**/node_modules/**'

check_no_match "current manuals and training docs use ClawNex Shield Rules naming" \
  "DefenseClaw Rules|DefenseClaw rules|Defense Claw" \
  "${doc_targets[@]}" \
  --glob '!**/node_modules/**'

exit "$fail"
