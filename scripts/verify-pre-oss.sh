#!/usr/bin/env bash
# verify-pre-oss.sh
#
# Purpose:
#   Lightweight smoke-test for key ClawNex API routes. Hits a fixed set of
#   endpoints, measures wall-time, and flags PASS / FAIL / AUTH per route.
#   This is deliberately not a test harness — it is a reproducible sanity
#   gate so operators can confirm the dashboard is breathing before an
#   OSS release, after a deploy, or after a config change.
#
# Usage:
#   ./scripts/verify-pre-oss.sh [base_url] [--verbose]
#
#   base_url   Optional. Defaults to http://127.0.0.1:5001
#   --verbose  Optional. Also prints the first 200 chars of each response body.
#
# Exit codes:
#   0   All routes either PASS or AUTH (route reachable, just needs a session).
#   1   At least one route FAILED (5xx, timeout, or exceeded its latency budget).
#
# When to run:
#   - Pre-release: before cutting an OSS tag or release candidate.
#   - Post-deploy: after shipping to any environment (local dev host / staging host / demo host).
#   - Post-config change: after editing providers, gateways, or correlation rules.
#
# Portability:
#   Plain bash + curl + awk. Works on macOS and Ubuntu. No jq, no python.

set -uo pipefail

BASE_URL="${1:-http://127.0.0.1:5001}"
VERBOSE=0
if [[ "${2:-}" == "--verbose" || "${2:-}" == "-v" ]]; then
  VERBOSE=1
fi
# Also allow --verbose as the first arg when no base URL is given.
if [[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]]; then
  VERBOSE=1
  BASE_URL="http://127.0.0.1:5001"
fi

# Route -> latency budget in ms. Exceeding the budget is a FAIL.
ROUTES=(
  "/api/health"
  "/api/fleet"
  "/api/correlations"
  "/api/correlations/evaluate"
  "/api/correlations/rules"
  "/api/trust-audit"
  "/api/config/providers"
  "/api/config/gateways"
  "/api/config/defaults"
  "/api/policies"
  "/api/threat-intel"
  "/api/permissiveness"
  "/api/risk-acceptances"
)

threshold_for() {
  case "$1" in
    "/api/health"|"/api/fleet"|"/api/correlations"|"/api/correlations/rules")
      echo 3000 ;;
    "/api/config/providers"|"/api/config/gateways"|"/api/config/defaults")
      echo 3000 ;;
    "/api/correlations/evaluate"|"/api/trust-audit"|"/api/permissiveness")
      echo 8000 ;;
    "/api/risk-acceptances")
      echo 3000 ;;
    "/api/threat-intel"|"/api/policies")
      echo 2000 ;;
    *)
      echo 3000 ;;
  esac
}

PASS_COUNT=0
FAIL_COUNT=0
AUTH_COUNT=0
ROWS=()

# Health endpoint MUST be 200 — no AUTH exception.
check_route() {
  local route="$1"
  local url="${BASE_URL}${route}"
  local budget
  budget=$(threshold_for "$route")

  local body_file
  body_file=$(mktemp -t clawnex-verify.XXXXXX)

  # --max-time is a hard network timeout; set to 2x the budget in seconds, min 10.
  local budget_sec=$(( budget / 1000 ))
  local max_time=$(( budget_sec * 2 ))
  if (( max_time < 10 )); then max_time=10; fi

  # -w gives us "HTTP_CODE TIME_TOTAL_SECONDS"
  local metrics
  metrics=$(curl -sS -o "$body_file" --max-time "$max_time" \
    -w "%{http_code} %{time_total}" "$url" 2>/dev/null || echo "000 0")

  local status time_sec time_ms verdict
  status=$(echo "$metrics" | awk '{print $1}')
  time_sec=$(echo "$metrics" | awk '{print $2}')
  # Convert float seconds -> integer ms.
  time_ms=$(awk -v s="$time_sec" 'BEGIN { printf "%d", s * 1000 }')

  if [[ "$status" == "000" ]]; then
    verdict="FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  elif [[ "$route" == "/api/health" ]]; then
    if [[ "$status" == "200" && "$time_ms" -lt "$budget" ]]; then
      verdict="PASS"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      verdict="FAIL"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  elif [[ "$status" == "401" || "$status" == "403" ]]; then
    verdict="AUTH"
    AUTH_COUNT=$((AUTH_COUNT + 1))
  elif [[ "$status" =~ ^2 ]] && [[ "$time_ms" -lt "$budget" ]]; then
    verdict="PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [[ "$status" =~ ^2 ]]; then
    # 2xx but too slow
    verdict="FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    verdict="FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  ROWS+=("$(printf '%-32s | %-6s | %7s | %-4s (budget %sms)' "$route" "$status" "$time_ms" "$verdict" "$budget")")

  if [[ "$VERBOSE" -eq 1 ]]; then
    local snippet
    snippet=$(head -c 200 "$body_file" 2>/dev/null | tr '\n' ' ')
    printf '  body[0..200]: %s\n' "$snippet"
  fi

  rm -f "$body_file"
}

echo "== ClawNex pre-OSS smoke check =="
echo "base=$BASE_URL  verbose=$VERBOSE"
echo

for route in "${ROUTES[@]}"; do
  check_route "$route"
done

echo
printf '%-32s | %-6s | %7s | %s\n' "route" "status" "time_ms" "verdict"
printf '%-32s-+-%-6s-+-%7s-+-%s\n' "--------------------------------" "------" "-------" "-------"
for row in "${ROWS[@]}"; do
  echo "$row"
done

echo
echo "Summary: ${PASS_COUNT} PASS, ${FAIL_COUNT} FAIL, ${AUTH_COUNT} AUTH"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "Result: FAIL (exit 1)"
  exit 1
fi

echo "Result: OK (exit 0)"
exit 0
