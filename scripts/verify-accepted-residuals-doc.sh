#!/usr/bin/env bash
# =============================================================================
# verify-accepted-residuals-doc.sh — DAST 2026-05-15 #10 fix guard.
#
# Asserts docs/qa/accepted-residuals.md exists and carries the
# required structure for AR-001 (CSP style-src-attr accepted residual):
#   - severity classification
#   - acceptance owner + date
#   - linked risk-register row
#   - rationale section
#   - compensating controls section
#   - retest condition section (at least one objective trigger + annual rotation)
#   - evidence section
#
# Also asserts the risk register cross-link is intact so an auditor
# following R-036 → AR-001 → retest conditions doesn't dead-end.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$REPO_ROOT/docs/qa/accepted-residuals.md"
RISK_REGISTER="$REPO_ROOT/docs/registers/risk-register.md"

fail=0
pass() { printf "  PASS  %s\n" "$1"; }
flag() { printf "  FAIL  %s\n" "$1"; fail=1; }

# --- Existence + structure ----------------------------------------------
if [[ ! -f "$DOC" ]]; then
  echo "FAIL — $DOC does not exist"
  exit 1
fi

grep -q "^# ClawNex Accepted-Residual" "$DOC" && pass "doc has expected H1 title" || flag "doc missing H1 title"
grep -q "^## AR-001 — CSP \`style-src-attr 'unsafe-inline'\`" "$DOC" && pass "AR-001 heading present" || flag "AR-001 heading missing"

# --- AR-001 required fields --------------------------------------------
grep -q "Severity (DAST classification)" "$DOC" && pass "severity field present" || flag "severity field missing"
grep -q "Accepted by" "$DOC" && pass "acceptance owner field present" || flag "acceptance owner missing"
grep -qE "First observed.*DAST" "$DOC" && pass "first-observed reference present" || flag "first-observed reference missing"
grep -q "Linked risk-register row" "$DOC" && pass "risk-register cross-link field present" || flag "risk-register cross-link missing"
grep -q "Implementation file" "$DOC" && pass "implementation-file pointer present" || flag "implementation-file pointer missing"

# --- AR-001 narrative sections -----------------------------------------
grep -q "### Rationale for acceptance" "$DOC" && pass "rationale section present" || flag "rationale section missing"
grep -q "### Compensating controls" "$DOC" && pass "compensating controls section present" || flag "compensating controls section missing"
grep -q "### Retest condition" "$DOC" && pass "retest condition section present" || flag "retest condition section missing"
grep -q "### Evidence" "$DOC" && pass "evidence section present" || flag "evidence section missing"

# --- Retest must have at least one objective trigger + annual rotation -
# "Annual rotation" is the backstop the doc's own intro requires.
grep -qE "Annual rotation|2027-05-15" "$DOC" && pass "retest has annual-rotation backstop" || flag "retest missing annual-rotation backstop"

# Count the numbered retest triggers (1. 2. 3. 4. ...). Doc spec
# requires at least one OBJECTIVE trigger in addition to the annual
# rotation, so ≥ 2 numbered entries inside the Retest section.
TRIGGER_COUNT="$(awk '
  /^### Retest condition/ { capture=1; next }
  capture && /^### /       { capture=0 }
  capture && /^[0-9]+\. /  { print }
' "$DOC" | wc -l | tr -d ' ')"

if [[ "$TRIGGER_COUNT" -ge 2 ]]; then
  pass "retest has ≥ 2 numbered triggers ($TRIGGER_COUNT total)"
else
  flag "retest needs ≥ 2 numbered triggers (found $TRIGGER_COUNT)"
fi

# --- Cross-link from risk register -------------------------------------
if grep -q "AR-001" "$RISK_REGISTER"; then
  pass "risk register references AR-001"
else
  flag "risk register does NOT reference AR-001 — auditor trail broken"
fi

if grep -q "accepted-residuals.md" "$RISK_REGISTER"; then
  pass "risk register links to accepted-residuals.md"
else
  flag "risk register does NOT link to accepted-residuals.md"
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "PASS — AR-001 doc + cross-link structure intact"
  exit 0
fi
echo "FAIL — accepted-residuals doc or its cross-link is missing required structure"
exit 1
