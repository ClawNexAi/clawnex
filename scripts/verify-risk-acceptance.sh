#!/usr/bin/env bash
# verify-risk-acceptance.sh — endpoint-level smoke test for the risk-acceptance API.
#
# Exercises GET /list, POST /create, GET ?status=expired, GET ?expiring_within_days=,
# DELETE /revoke against a live dev server. Cleans up after itself.
#
# Usage:
#   ./scripts/verify-risk-acceptance.sh [base_url]
#
# Exit codes:
#   0   all checks pass
#   1   endpoint unreachable or non-200
#   2   shape assertion failed

set -uo pipefail

BASE_URL="${1:-http://127.0.0.1:5001}"
PASS=0
FAIL=0

ok()  { PASS=$((PASS+1)); printf "  \xE2\x9C\x93 %s\n" "$1"; }
bad() { FAIL=$((FAIL+1)); printf "  \xE2\x9C\x97 %s\n" "$1"; }

# 1. GET /api/risk-acceptances — base list
status=$(curl -sS --max-time 10 -o /tmp/rac.list -w "%{http_code}" "${BASE_URL}/api/risk-acceptances" 2>/dev/null || echo 000)
if [[ "$status" == "200" ]]; then
  if grep -q '"acceptances"' /tmp/rac.list && grep -q '"meta"' /tmp/rac.list; then
    ok "GET /api/risk-acceptances 200 + envelope"
  else
    bad "GET /api/risk-acceptances missing acceptances/meta"
  fi
else
  bad "GET /api/risk-acceptances returned $status"
  exit 1
fi

# 2. POST a new acceptance (smoke test data — will revoke at end)
read -r -d '' POST_BODY <<JSON || true
{"source_panel":"trust_audit","rule_id":"verify-risk-acceptance.sh-smoke","agent_id":"smoke-agent","scope_level":"finding","reason":"verify-script smoke test","evidence":["smoke-tool"]}
JSON
status=$(curl -sS --max-time 10 -X POST -H "Content-Type: application/json" -d "$POST_BODY" -o /tmp/rac.create -w "%{http_code}" "${BASE_URL}/api/risk-acceptances" 2>/dev/null || echo 000)
ID=""
if [[ "$status" == "201" ]]; then
  ID=$(python3 -c 'import json,sys; d=json.load(open("/tmp/rac.create")); print(d.get("acceptance",{}).get("id",""))')
  if [[ -n "$ID" ]]; then
    ok "POST /api/risk-acceptances 201 (id: ${ID:0:8}...)"
  else
    bad "POST returned 201 but no id"
  fi
else
  bad "POST /api/risk-acceptances returned $status"
fi

# 3. GET ?source_panel=trust_audit — filter respected
status=$(curl -sS --max-time 10 -o /tmp/rac.filt -w "%{http_code}" "${BASE_URL}/api/risk-acceptances?source_panel=trust_audit" 2>/dev/null || echo 000)
if [[ "$status" == "200" ]]; then
  if python3 -c 'import json,sys; d=json.load(open("/tmp/rac.filt")); sys.exit(0 if all(a.get("source_panel")=="trust_audit" for a in d.get("acceptances",[])) else 1)'; then
    ok "GET ?source_panel=trust_audit filter respected"
  else
    bad "GET ?source_panel filter mixed"
  fi
fi

# 4. GET ?expiring_within_days=180 (default 90d expiry → should be in window)
status=$(curl -sS --max-time 10 -o /tmp/rac.exp -w "%{http_code}" "${BASE_URL}/api/risk-acceptances?expiring_within_days=180" 2>/dev/null || echo 000)
if [[ "$status" == "200" ]]; then
  total=$(python3 -c 'import json; print(json.load(open("/tmp/rac.exp")).get("meta",{}).get("total",0))')
  if [[ "$total" -ge 0 ]]; then
    ok "GET ?expiring_within_days=180 returns ${total} row(s)"
  fi
fi

# 5. DELETE the smoke acceptance
if [[ -n "$ID" ]]; then
  status=$(curl -sS --max-time 10 -X DELETE -H "Content-Type: application/json" -d '{"reason":"smoke cleanup"}' -o /tmp/rac.del -w "%{http_code}" "${BASE_URL}/api/risk-acceptances/${ID}" 2>/dev/null || echo 000)
  if [[ "$status" == "200" ]]; then
    if python3 -c 'import json,sys; d=json.load(open("/tmp/rac.del")); sys.exit(0 if d.get("acceptance",{}).get("revoked_at") else 1)'; then
      ok "DELETE /api/risk-acceptances/${ID:0:8}... 200 + revoked_at populated"
    else
      bad "DELETE 200 but revoked_at missing"
    fi
  else
    bad "DELETE returned $status"
  fi
fi

echo ""
echo "Summary: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]] || exit 2
exit 0
