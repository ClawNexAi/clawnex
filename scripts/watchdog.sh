#!/bin/bash
# ClawNex Watchdog — monitors ClawNex Dashboard (5001) and LiteLLM Proxy (4001)
# Cron name: clawnex-watchdog
# Schedule: every 5 minutes
#
# Checks health endpoints. If a service is down:
#   1. Attempts restart
#   2. Logs the event
#   3. Posts alert to ClawNex API (if dashboard is up)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SENTINEL_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$SENTINEL_DIR/logs/watchdog.log"
DASHBOARD_URL="http://127.0.0.1:5001"
LITELLM_URL="http://127.0.0.1:4001"

mkdir -p "$(dirname "$LOG_FILE")"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  echo "[$(timestamp)] $1" >> "$LOG_FILE"
}

post_alert() {
  local title="$1"
  local description="$2"
  local severity="$3"
  curl -s -X POST "$DASHBOARD_URL/api/alerts" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$title\",\"description\":\"$description\",\"severity\":\"$severity\",\"source\":\"watchdog\"}" \
    > /dev/null 2>&1
}

# --- Check ClawNex Dashboard (port 5001) ---
check_dashboard() {
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$DASHBOARD_URL/api/health" 2>/dev/null)

  if [ "$response" = "200" ]; then
    return 0
  else
    log "ALERT: ClawNex Dashboard is DOWN (HTTP $response)"

    # Attempt restart
    log "Attempting Dashboard restart..."
    cd "$SENTINEL_DIR" || return 1

    # Kill existing process
    local pid
    pid=$(lsof -ti :5001 2>/dev/null)
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null
      sleep 2
    fi

    # Clear stale build cache
    rm -rf "$SENTINEL_DIR/.next"

    # Restart in background
    nohup npm run dev > "$SENTINEL_DIR/logs/dashboard.log" 2>&1 &
    local new_pid=$!
    log "Dashboard restart initiated (PID: $new_pid)"

    # Wait for it to come up
    sleep 10
    response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$DASHBOARD_URL/api/health" 2>/dev/null)
    if [ "$response" = "200" ]; then
      log "Dashboard restart SUCCESSFUL"
      post_alert "Watchdog: Dashboard recovered" "ClawNex Dashboard was down and has been automatically restarted." "HIGH"
      return 0
    else
      log "Dashboard restart FAILED (HTTP $response)"
      return 1
    fi
  fi
}

# --- Check LiteLLM Proxy (port 4001) ---
check_litellm() {
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$LITELLM_URL/health" 2>/dev/null)

  if [ "$response" = "200" ]; then
    return 0
  else
    log "ALERT: LiteLLM Proxy is DOWN (HTTP $response)"

    # Attempt restart
    log "Attempting LiteLLM restart..."

    # Kill existing process
    local pid
    pid=$(lsof -ti :4001 2>/dev/null)
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null
      sleep 2
    fi

    # Restart in background
    nohup bash "$SENTINEL_DIR/litellm/start.sh" > "$SENTINEL_DIR/logs/litellm.log" 2>&1 &
    local new_pid=$!
    log "LiteLLM restart initiated (PID: $new_pid)"

    # Wait for it to come up
    sleep 8
    response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$LITELLM_URL/health" 2>/dev/null)
    if [ "$response" = "200" ]; then
      log "LiteLLM restart SUCCESSFUL"
      post_alert "Watchdog: LiteLLM recovered" "LiteLLM Proxy was down and has been automatically restarted." "HIGH"
      return 0
    else
      log "LiteLLM restart FAILED (HTTP $response)"
      post_alert "Watchdog: LiteLLM restart failed" "LiteLLM Proxy is down and automatic restart failed. Manual intervention required." "CRITICAL"
      return 1
    fi
  fi
}

# --- Main ---
dashboard_ok=true
litellm_ok=true

check_dashboard || dashboard_ok=false
check_litellm || litellm_ok=false

if $dashboard_ok && $litellm_ok; then
  # Only log healthy status once per hour to avoid log bloat
  minute=$(date '+%M')
  if [ "$minute" -lt 5 ]; then
    log "OK: All services healthy (Dashboard: 5001, LiteLLM: 4001)"
  fi
fi

exit 0
