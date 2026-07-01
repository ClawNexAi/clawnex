"""
ClawNex Logger — CustomLogger for LiteLLM 1.84.10
Scans every LLM call through ClawNex's shield and logs to proxy_traffic.

Capabilities:
  - Pre-call blocking: Scans prompts BEFORE they reach the model.
    If shield returns BLOCK and block_mode is on, the request is rejected.
  - Post-call logging: Scans both prompt and response, logs to proxy_traffic.

Fail-closed policy (default):
  If the scan pipeline errors — dashboard unreachable, DB locked, HTTP
  timeout — this logger defaults to BLOCK rather than ALLOW. An attacker
  DoSing the dashboard MUST NOT silently disable the firewall. Override
  only with CLAWNEX_ON_SCAN_ERROR=allow (not recommended in production).
"""

import json
import hashlib
import os
import traceback
from datetime import datetime
from typing import Optional, Union

import httpx
from litellm.integrations.custom_logger import CustomLogger

CLAWNEX_API = os.environ.get("CLAWNEX_API_URL", "http://127.0.0.1:5001")

# Fail-closed policy: when the scan pipeline errors, should we BLOCK or ALLOW?
# Production should default to BLOCK. Set CLAWNEX_ON_SCAN_ERROR=allow to
# explicitly opt out (e.g., for dev or highly availability-sensitive setups).
_ON_SCAN_ERROR = os.environ.get("CLAWNEX_ON_SCAN_ERROR", "block").lower()


def _fail_closed() -> bool:
    return _ON_SCAN_ERROR != "allow"


def _scan_error_verdict(err: Exception) -> dict:
    """Synthetic BLOCK verdict returned when the scan pipeline errors."""
    return {
        "verdict": "BLOCK",
        "score": 100,
        "detections": [{
            "rule": "scan_error_fail_closed",
            "name": "scan_error_fail_closed",
            "severity": "CRITICAL",
        }],
        "error": str(err)[:200],
    }


def _extract_text(messages):
    parts = []
    if not messages:
        return ""
    for msg in messages:
        content = msg.get("content", "") if isinstance(msg, dict) else ""
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    text = block.get("text") or block.get("thinking") or ""
                    if text:
                        parts.append(text)
    return "\n".join(parts)


def _scan(text, direction="inbound"):
    try:
        resp = httpx.post(
            f"{CLAWNEX_API}/api/shield/scan",
            json={"text": text, "source": "litellm-proxy", "direction": direction},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json()
        # Non-200: shield unreachable or errored. Fail closed in production.
        err = Exception(f"shield HTTP {resp.status_code}")
        print(f"[ClawNex Logger] _scan non-200: {err}")
        if _fail_closed():
            return _scan_error_verdict(err)
        return {"verdict": "ALLOW", "score": 0, "detections": []}
    except Exception as e:
        print(f"[ClawNex Logger] _scan error: {e}")
        if _fail_closed():
            return _scan_error_verdict(e)
        return {"verdict": "ALLOW", "score": 0, "detections": []}


def _ingest(data):
    try:
        httpx.post(f"{CLAWNEX_API}/api/proxy/ingest", json=data, timeout=5)
    except Exception as e:
        print(f"[ClawNex Logger] Ingest error: {e}")


def _provider(model):
    if not model:
        return "unknown"
    m = model.lower()
    if "qwen" in m:
        return "lmstudio"
    if "claude" in m:
        return "anthropic"
    if "gpt" in m:
        return "openai"
    if "openrouter" in m:
        return "openrouter"
    if "gemini" in m:
        return "google"
    return "unknown"


def _is_block_mode_on():
    """Check if proxy_block_mode is 'on' via ClawNex API.

    Fail-closed: if the dashboard is unreachable we assume block mode is ON,
    so that a synthetic BLOCK verdict from _scan() actually rejects traffic
    rather than being downgraded to a log-only event.
    """
    try:
        resp = httpx.get(f"{CLAWNEX_API}/api/proxy/block-mode", timeout=3)
        if resp.status_code == 200:
            return resp.json().get("blockMode") == "on"
        if _fail_closed():
            print(f"[ClawNex Logger] block-mode HTTP {resp.status_code} — treating as ON (fail-closed)")
            return True
    except Exception as e:
        if _fail_closed():
            print(f"[ClawNex Logger] block-mode error — treating as ON (fail-closed): {e}")
            return True
    return False


def _is_break_glass_active():
    """Check if break-glass mode is active via ClawNex API.

    Fail-closed: break-glass is a PRIVILEGE that disables scanning. If we
    can't confirm it's active, we must assume it ISN'T — otherwise an
    attacker who can disrupt the dashboard could bypass the shield entirely.
    Errors always return False regardless of policy.
    """
    try:
        resp = httpx.get(f"{CLAWNEX_API}/api/break-glass/status", timeout=3)
        if resp.status_code == 200:
            return resp.json().get("active", False)
    except Exception as e:
        print(f"[ClawNex Logger] break-glass check error — treating as inactive: {e}")
    return False


class ClawNexLogger(CustomLogger):

    def __init__(self):
        super().__init__()
        print(f"[ClawNex Logger] Initialized — API: {CLAWNEX_API}")

    async def async_pre_call_hook(
        self, user_api_key_dict, cache, data, call_type
    ) -> Optional[Union[Exception, str, dict]]:
        """
        Runs BEFORE the request reaches the upstream model.

        Break-glass check: If break-glass is active, skip scanning entirely
        and log traffic as BYPASSED. The request proceeds unscanned.

        Normal mode: Scans the prompt through the shield. If verdict=BLOCK
        and block_mode=on, rejects the request so it never reaches the LLM.
        """
        try:
            messages = data.get("messages", [])
            if not messages:
                return None

            # Break-glass: skip scan, log as bypassed, allow through
            if _is_break_glass_active():
                model = data.get("model", "unknown")
                _ingest({
                    "direction": "inbound",
                    "model": model,
                    "provider": _provider(model),
                    "messages_count": len(messages),
                    "shield_verdict": "BYPASSED",
                    "shield_score": 0,
                    "shield_detections": [],
                    "blocked": False,
                    "status_code": 200,
                    "source": "break-glass",
                })
                print(f"[ClawNex Logger] BREAK-GLASS: {model} — bypassed shield scan")
                return None

            inbound_text = _extract_text(messages)
            if not inbound_text.strip():
                return None

            result = _scan(inbound_text, "inbound")
            verdict = result.get("verdict", "ALLOW")

            if verdict == "BLOCK" and _is_block_mode_on():
                model = data.get("model", "unknown")
                score = result.get("score", 0)
                detections = result.get("detections", [])
                det_names = ", ".join(d.get("name", "?") for d in detections[:5])

                # Log the blocked request
                _ingest({
                    "direction": "inbound",
                    "model": model,
                    "provider": _provider(model),
                    "prompt_hash": hashlib.sha256(
                        inbound_text.encode("utf-8", errors="replace")
                    ).hexdigest()[:16],
                    "messages_count": len(messages),
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "latency_ms": 0,
                    "shield_verdict": "BLOCK",
                    "shield_score": score,
                    "shield_detections": detections[:10],
                    "blocked": True,
                    "block_reason": f"Shield BLOCK (score {score}): {det_names}",
                    "status_code": 403,
                })

                print(f"[ClawNex Logger] BLOCKED: {model} score={score} — {det_names}")
                return f"Request blocked by ClawNex Prompt Shield. Score: {score}. Detections: {det_names}"

        except Exception as e:
            # Fail-closed policy: when scanning errors, BLOCK rather than
            # silently allow. An attacker who can knock out the dashboard
            # must not be able to bypass the firewall as a side effect.
            # Raising here causes LiteLLM proxy to return 500 to the client,
            # which denies the upstream model call. Set
            # CLAWNEX_ON_SCAN_ERROR=allow to opt out.
            print(f"[ClawNex Logger] Pre-call hook error: {e}")
            traceback.print_exc()
            if _fail_closed():
                raise Exception(
                    f"ClawNex scan pipeline error - fail-closed policy: {str(e)[:200]}"
                )
            print("[ClawNex Logger] CLAWNEX_ON_SCAN_ERROR=allow — forwarding request unscanned")

        return None

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        """Called by LiteLLM proxy after a successful LLM call. Pass-through."""
        return response

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Async version — called by LiteLLM 1.84.10 proxy."""
        self.log_success_event(kwargs, response_obj, start_time, end_time)

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        """Async version — called by LiteLLM 1.84.10 proxy."""
        self.log_failure_event(kwargs, response_obj, start_time, end_time)

    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        """
        Post-call callback: runs AFTER the LLM responds successfully.

        Scans both the inbound prompt (again, for logging) and the outbound
        response through the shield. Records the complete traffic record
        (model, tokens, cost, latency, shield verdict) to proxy_traffic
        via the /api/proxy/ingest endpoint.

        The combined verdict uses the worst of inbound and outbound:
        BLOCK > REVIEW > ALLOW. This means a clean prompt with a dangerous
        response still gets flagged.

        Provider detection: derives the provider name from the model string
        (e.g., "qwen/*" → lmstudio, "claude-*" → anthropic, "gpt-*" → openai).
        """
        try:
            model = kwargs.get("model", "unknown")
            messages = kwargs.get("messages", [])
            latency_ms = int((end_time - start_time).total_seconds() * 1000) if end_time and start_time else 0

            # Scan inbound
            inbound_text = _extract_text(messages)
            inbound_result = _scan(inbound_text, "inbound") if inbound_text.strip() else {"verdict": "ALLOW", "score": 0, "detections": []}

            # Extract response
            response_text = ""
            if hasattr(response_obj, "choices") and response_obj.choices:
                choice = response_obj.choices[0]
                if hasattr(choice, "message") and hasattr(choice.message, "content"):
                    response_text = choice.message.content or ""

            # Scan outbound
            outbound_result = _scan(response_text, "outbound") if response_text.strip() else {"verdict": "ALLOW", "score": 0, "detections": []}

            # Tokens
            input_tokens = output_tokens = total_tokens = 0
            if hasattr(response_obj, "usage") and response_obj.usage:
                input_tokens = getattr(response_obj.usage, "prompt_tokens", 0) or 0
                output_tokens = getattr(response_obj.usage, "completion_tokens", 0) or 0
                total_tokens = getattr(response_obj.usage, "total_tokens", 0) or 0

            # Verdicts
            inv = inbound_result.get("verdict", "ALLOW")
            outv = outbound_result.get("verdict", "ALLOW")
            verdict = "BLOCK" if "BLOCK" in (inv, outv) else "REVIEW" if "REVIEW" in (inv, outv) else "ALLOW"
            score = max(inbound_result.get("score", 0), outbound_result.get("score", 0))
            detections = inbound_result.get("detections", []) + outbound_result.get("detections", [])

            _ingest({
                "direction": "complete",
                "model": model,
                "provider": _provider(model),
                "prompt_hash": hashlib.sha256(inbound_text.encode("utf-8", errors="replace")).hexdigest()[:16] if inbound_text else None,
                "messages_count": len(messages),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "latency_ms": latency_ms,
                "shield_verdict": verdict,
                "shield_score": score,
                "shield_detections": detections[:10],
                "blocked": False,
                "status_code": 200,
            })

            if verdict != "ALLOW":
                print(f"[ClawNex Logger] SHIELD: {model} verdict={verdict} score={score} tokens={total_tokens}")

        except Exception as e:
            print(f"[ClawNex Logger] Success callback error: {e}")
            traceback.print_exc()

    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        try:
            model = kwargs.get("model", "unknown")
            _ingest({
                "direction": "error",
                "model": model,
                "provider": _provider(model),
                "shield_verdict": "ERROR",
                "shield_score": 0,
                "status_code": 500,
                "error": str(response_obj)[:200] if response_obj else "unknown",
            })
            print(f"[ClawNex Logger] FAIL: {model}")
        except Exception:
            pass
