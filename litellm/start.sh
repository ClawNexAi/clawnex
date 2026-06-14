#!/bin/bash
# ClawNex LiteLLM Proxy Launcher
#
# Pre-flight guard: if port 4001 is already bound, abort without forking.
# This prevents the 145-orphan-worker incident documented in
# docs/security-audit-2026-04-22.md §10 (2026-04-22). Without the guard,
# uvicorn/gunicorn preforks workers BEFORE the bind failure is detected, and
# those workers orphan to PPID=1 in uninterruptible sleep when the supervisor
# exits.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LITELLM_PORT="${LITELLM_PORT:-4001}"
LITELLM_HOST="${LITELLM_HOST:-127.0.0.1}"

# Pre-flight: fail fast if port already owned by another process
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PID="$(lsof -ti "tcp:${LITELLM_PORT}" -sTCP:LISTEN 2>/dev/null | head -1)"
  if [ -n "${EXISTING_PID:-}" ]; then
    echo "[start.sh] port ${LITELLM_PORT} already bound by PID ${EXISTING_PID}. Aborting to avoid orphan workers." >&2
    exit 0
  fi
fi

# Activate the bundled venv
# shellcheck disable=SC1091
source "$SCRIPT_DIR/venv/bin/activate"

# Source secrets from .env.local if present; do NOT hardcode keys in start.sh
if [ -f "$SCRIPT_DIR/../.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/../.env.local"
  set +a
fi

export CLAWNEX_API_URL="${CLAWNEX_API_URL:-http://127.0.0.1:5001}"
export PYTHONPATH="$SCRIPT_DIR:${PYTHONPATH:-}"
export CLAWNEX_LITELLM_CONFIG="$SCRIPT_DIR/config.yaml"
export LITELLM_NUM_WORKERS=1

# Start LiteLLM in-process so the success/failure callbacks we register below
# survive into the serving worker. Guards:
#   - num_workers enforced three ways (CLI, env var, this script)
#   - port-bind check inside python catches races the lsof check above misses
exec python3 -c "
import sys, os, socket

sys.path.insert(0, os.environ.get('PYTHONPATH','').split(':')[0])

host = os.environ.get('LITELLM_HOST', '127.0.0.1')
port = int(os.environ.get('LITELLM_PORT', '4001'))

# Race-safe port check: between lsof and now, something may have claimed it
_s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    _s.settimeout(0.5)
    _s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        _s.bind((host, port))
    except OSError:
        print(f'[ClawNex] Port {host}:{port} already in use — aborting.', file=sys.stderr)
        sys.exit(0)
finally:
    _s.close()

# Register ClawNex callback in the litellm module BEFORE server starts
import litellm
from clawnex_logger import ClawNexLogger
_logger = ClawNexLogger()
litellm.success_callback.append(_logger)
litellm.failure_callback.append(_logger)
print(f'[ClawNex] Callbacks injected: success={len(litellm.success_callback)} failure={len(litellm.failure_callback)}')

config_path = os.environ.get('CLAWNEX_LITELLM_CONFIG', 'config.yaml')
sys.argv = [
    'litellm',
    '--config', config_path,
    '--port', str(port),
    '--host', host,
    '--num_workers', '1',
]
from litellm.proxy.proxy_cli import run_server
run_server()
" 2>&1
