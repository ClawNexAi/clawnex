"""
Auto-loaded by LiteLLM proxy on startup via PYTHONPATH.
Registers ClawNex shield callback.
"""
import litellm
from clawnex_logger import ClawNexLogger

_logger = ClawNexLogger()
litellm.success_callback.append(_logger)
litellm.failure_callback.append(_logger)
print(f"[ClawNex] Callbacks injected: success={len(litellm.success_callback)} failure={len(litellm.failure_callback)}")
