#!/usr/bin/env python3
"""ClawNex LiteLLM Proxy with shield callback — uses startup hook.

Pre-flight guards prevent the fork-bomb / orphan-worker pattern documented in
docs/security-audit-2026-04-22.md §10 (150-process incident, 2026-04-22):

1. Port-bind check: if 4001 is already owned by another process, exit cleanly
   before importing LiteLLM. Without this, launchd KeepAlive=true respawns us
   every ThrottleInterval seconds and each attempt can prefork workers that
   orphan when the supervisor exits on bind failure.
2. Environment override: LITELLM_PORT / LITELLM_HOST allow tests to run on an
   alternate port without editing this file.
"""

import sys
import os
import socket

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

# --- Load .env.local so secrets (OPENROUTER_API_KEY, etc.) don't have to live
#     in the launchd plist's EnvironmentVariables in plaintext. The plist kept
#     a duplicate of keys that were also in .env.local, doubling the secret-
#     sprawl surface (docs/security-audit-2026-04-22.md §10 follow-up).
#     Only plain KEY=VALUE lines with optional quotes are parsed; anything that
#     looks odd is skipped silently to avoid breaking launchd startup.
_env_local = os.path.join(os.path.dirname(script_dir), ".env.local")
if os.path.exists(_env_local):
    try:
        with open(_env_local, "r", encoding="utf-8") as _fh:
            for _line in _fh:
                _s = _line.strip()
                if not _s or _s.startswith("#") or "=" not in _s:
                    continue
                _k, _, _v = _s.partition("=")
                _k = _k.strip()
                _v = _v.strip()
                if not _k:
                    continue
                # Strip surrounding quotes if balanced
                if (len(_v) >= 2 and _v[0] == _v[-1] and _v[0] in ('"', "'")):
                    _v = _v[1:-1]
                # Do NOT overwrite already-set env vars — plist / shell env wins.
                os.environ.setdefault(_k, _v)
    except OSError:
        pass

# --- Pre-flight guard 1: port availability ---
_host = os.environ.get("LITELLM_HOST", "127.0.0.1")
try:
    _port = int(os.environ.get("LITELLM_PORT", "4001"))
except (TypeError, ValueError):
    _port = 4001

def _port_in_use(host: str, port: int) -> bool:
    """Return True if `host:port` already has a listener we cannot bind to."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.5)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return False
        except OSError:
            return True
    finally:
        s.close()

if _port_in_use(_host, _port):
    print(
        f"[ClawNex] Port {_host}:{_port} already in use — another LiteLLM proxy "
        f"appears to own it. Exiting cleanly (this avoids orphan worker forks "
        f"under launchd KeepAlive).",
        file=sys.stderr,
    )
    sys.exit(0)

# Monkey-patch litellm to include our callback in the known list
# This runs before the proxy server initializes
import litellm

# Add our callback name to the known list so the config loader accepts it
litellm._known_custom_logger_compatible_callbacks.append("clawnex")

# Patch the init function to return our logger
_original_init = None
try:
    from litellm.litellm_core_utils.litellm_logging import _init_custom_logger_compatible_class as _orig
    _original_init = _orig
except ImportError:
    pass

if _original_init:
    def _patched_init(callback_name, internal_usage_cache=None, llm_router=None):
        if callback_name == "clawnex":
            from clawnex_logger import ClawNexLogger
            return ClawNexLogger()
        return _original_init(callback_name, internal_usage_cache, llm_router)

    import litellm.litellm_core_utils.litellm_logging as logging_mod
    logging_mod._init_custom_logger_compatible_class = _patched_init
    print("[ClawNex] Patched litellm to recognize 'clawnex' callback")

# Start LiteLLM server.
# num_workers=1 is enforced THREE ways because LiteLLM's arg precedence is
# surprising: (a) CLI flag, (b) config.yaml general_settings.num_workers,
# (c) env var LITELLM_NUM_WORKERS. Any default > 1 triggers uvicorn worker
# preforks, which is the root cause of the 145-orphan incident.
config_path = os.path.join(script_dir, "config.yaml")
os.environ.setdefault("LITELLM_NUM_WORKERS", "1")
sys.argv = [
    "litellm",
    "--config", config_path,
    "--port", str(_port),
    "--host", _host,
    "--num_workers", "1",
]
from litellm.proxy.proxy_cli import run_server
run_server()
