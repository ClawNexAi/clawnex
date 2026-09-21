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
import hmac
import base64
import os
import traceback
import time
from datetime import datetime
from typing import Optional, Union

import httpx
import yaml
from litellm.integrations.custom_logger import CustomLogger

CLAWNEX_API = os.environ.get("CLAWNEX_API_URL", "http://127.0.0.1:5001")

# Fail-closed policy: when the scan pipeline errors, should we BLOCK or ALLOW?
# Production should default to BLOCK. Set CLAWNEX_ON_SCAN_ERROR=allow to
# explicitly opt out (e.g., for dev or highly availability-sensitive setups).
_ON_SCAN_ERROR = os.environ.get("CLAWNEX_ON_SCAN_ERROR", "block").lower()
_HERMES_MODEL_ALIASES = None
_RECENT_EVENT_IDS = {}
_ROUTING_IDENTITIES = {}
_TRUSTED_CONTEXT_ROLES = {"system", "developer", "assistant"}


def _signed_routing_identity(data):
    """Validate our signed instance header and remove it from logging copies."""
    candidates = []
    metadata = data.get('metadata') or {}
    params = data.get('litellm_params') or {}
    for container in [data.get('proxy_server_request') or {}, metadata, params.get('metadata') or {}]:
        headers = container.get('headers') if isinstance(container, dict) else None
        if isinstance(headers, dict):
            for key in list(headers):
                if key.lower() == 'x-clawnex-routing-identity':
                    candidates.append(headers.pop(key))
    secret = os.environ.get('CLAWNEX_INGEST_SECRET', '')
    if len(secret.encode()) < 32 or not candidates:
        return None
    token = candidates[0]
    if not isinstance(token, str) or len(token) > 1024 or any(value != token for value in candidates):
        return None
    try:
        payload, signature = token.split('.')
        expected = base64.urlsafe_b64encode(hmac.new(secret.encode(), ('clawnex-routing-v1:' + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
        if not hmac.compare_digest(expected, signature):
            return None
        value = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        if not isinstance(value, dict) or value.get('v') != 1:
            return None
        return {'clawnex_routing_connector': value.get('connector'), 'clawnex_routing_source_id': value.get('sourceId'), 'identity_hash': hashlib.sha256(token.encode()).hexdigest()}
    except (ValueError, TypeError, UnicodeError):
        return None


def _remember_routing_identity(auth, data):
    """Bind only proxy-authenticated key metadata, never client source labels."""
    now = time.monotonic()
    for handle, entry in list(_ROUTING_IDENTITIES.items()):
        if now - entry[0] > 600:
            _ROUTING_IDENTITIES.pop(handle, None)
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        data["metadata"] = metadata
    metadata.pop("clawnex_evidence_handle", None)
    trusted = _signed_routing_identity(data) or getattr(auth, "metadata", None)
    if not isinstance(trusted, dict):
        return
    connector = trusted.get("clawnex_routing_connector")
    source_id = trusted.get("clawnex_routing_source_id")
    if connector not in {"openclaw", "hermes", "opencode", "pi", "anythingllm"} or not isinstance(source_id, str) or not 0 < len(source_id) <= 200:
        return
    if len(_ROUTING_IDENTITIES) >= 4096:
        return  # bounded state: absence of proof is safer than guessed identity
    handle = os.urandom(24).hex()
    metadata["clawnex_evidence_handle"] = handle
    _ROUTING_IDENTITIES[handle] = (now, connector, source_id, data.get("model"), trusted.get('identity_hash'))


def _consume_routing_identity(kwargs):
    metadata = kwargs.get("metadata") or (kwargs.get("litellm_params") or {}).get("metadata") or {}
    handle = metadata.get("clawnex_evidence_handle") if isinstance(metadata, dict) else None
    entry = _ROUTING_IDENTITIES.pop(handle, None) if isinstance(handle, str) else None
    if not entry or time.monotonic() - entry[0] > 600:
        return None
    return entry


def _completed_routing_identity(kwargs, response_obj):
    entry = _consume_routing_identity(kwargs)
    request_id = getattr(response_obj, "id", None)
    choices = getattr(response_obj, "choices", None) or []
    completed = any(getattr(getattr(choice, "message", None), "content", None) or
                    getattr(getattr(choice, "message", None), "tool_calls", None) for choice in choices)
    if not entry or not completed or not isinstance(request_id, str) or not request_id:
        return {}
    return {"source": entry[1], "routing_connector": entry[1], "routing_source_id": entry[2], "proxy_request_id": request_id,
            "model": entry[3], **({'routing_identity_hash': entry[4]} if entry[4] else {})}


def _blocked_routing_identity(kwargs):
    entry = _consume_routing_identity(kwargs)
    if not entry:
        return {}
    return {"source": entry[1], "routing_connector": entry[1], "routing_source_id": entry[2],
            "proxy_request_id": f"blocked-{os.urandom(16).hex()}", "model": entry[3],
            **({'routing_identity_hash': entry[4]} if entry[4] else {})}


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


def _extract_text(messages, excluded_roles=None):
    parts = []
    if not messages:
        return ""
    for msg in messages:
        if isinstance(msg, dict) and msg.get("role") in (excluded_roles or set()):
            continue
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


def _service_headers():
    secret = os.environ.get("CLAWNEX_INGEST_SECRET", "")
    return {"x-clawnex-ingest-secret": secret} if secret else {}


def _scan(text, direction="inbound"):
    try:
        resp = httpx.post(
            f"{CLAWNEX_API}/api/shield/scan",
            json={"text": text, "source": "litellm-proxy", "direction": direction},
            headers=_service_headers(),
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
        headers = {}
        ingest_secret = os.environ.get("CLAWNEX_INGEST_SECRET")
        if ingest_secret:
            headers["X-ClawNex-Ingest-Secret"] = ingest_secret
        resp = httpx.post(
            f"{CLAWNEX_API}/api/proxy/ingest",
            json=data,
            headers=headers,
            timeout=5,
        )
        if resp.status_code >= 300:
            print(f"[ClawNex Logger] Ingest rejected: HTTP {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[ClawNex Logger] Ingest error: {e}")


def _response_cost(response_obj, kwargs):
    """Read LiteLLM's calculated cost without assuming one response shape."""
    candidates = [
        getattr(response_obj, "_hidden_params", None),
        getattr(response_obj, "hidden_params", None),
        kwargs.get("_hidden_params") if isinstance(kwargs, dict) else None,
    ]
    for value in candidates:
        if isinstance(value, dict):
            cost = value.get("response_cost")
            if isinstance(cost, (int, float)):
                return float(cost)
    for value in (
        getattr(response_obj, "response_cost", None),
        getattr(response_obj, "_response_cost", None),
        kwargs.get("response_cost") if isinstance(kwargs, dict) else None,
        kwargs.get("completion_cost") if isinstance(kwargs, dict) else None,
    ):
        if isinstance(value, (int, float)):
            return float(value)
    return None


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
    if "nvidia" in m or "nemotron" in m or "nim/" in m:
        return "nvidia-nim"
    return "unknown"


def _hermes_model_aliases():
    """Read the exact model aliases ClawNex registered for Hermes.

    Hermes keeps its original model name when it calls the proxy. The
    connector marker in LiteLLM's model entry is therefore the authoritative
    way to distinguish a routed Hermes call from another caller using the
    same upstream provider.
    """
    global _HERMES_MODEL_ALIASES
    if _HERMES_MODEL_ALIASES is not None:
        return _HERMES_MODEL_ALIASES
    aliases = set()
    config_path = os.environ.get("CLAWNEX_LITELLM_CONFIG")
    if config_path:
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                document = yaml.safe_load(handle) or {}
            for entry in document.get("model_list", []) or []:
                if not isinstance(entry, dict):
                    continue
                marker = entry.get("x_clawnex_connector")
                if marker is None:
                    marker = (entry.get("model_info") or {}).get("x_clawnex_connector")
                if marker != "hermes":
                    continue
                model_name = entry.get("model_name")
                if isinstance(model_name, str) and model_name.strip():
                    aliases.add(model_name.strip())
        except Exception as exc:
            print(f"[ClawNex Logger] Hermes model attribution unavailable: {exc}")
    _HERMES_MODEL_ALIASES = aliases
    return aliases


def _source_for(model, data=None):
    """Return the ClawNex connector source for a proxy exchange."""
    metadata = data.get("metadata") if isinstance(data, dict) else None
    if isinstance(metadata, dict):
        connector = metadata.get("clawnex_connector") or metadata.get("connector")
        if connector in {"hermes", "openclaw", "opencode", "pi"}:
            return connector
    if isinstance(data, dict):
        connector = data.get("x_clawnex_connector")
        if connector in {"hermes", "openclaw", "opencode", "pi"}:
            return connector
    return "hermes" if model in _hermes_model_aliases() else "litellm"


def _claim_event(data, response_obj):
    """Make success/failure callbacks idempotent for one proxy response."""
    global _RECENT_EVENT_IDS
    event_id = None
    if isinstance(data, dict):
        event_id = data.get("litellm_call_id") or data.get("request_id")
    event_id = event_id or getattr(response_obj, "id", None)
    if not event_id:
        usage = getattr(response_obj, "usage", None)
        event_id = "fallback:" + hashlib.sha256(
            json.dumps(
                {
                    "model": data.get("model") if isinstance(data, dict) else None,
                    "messages": data.get("messages") if isinstance(data, dict) else None,
                    "response": str(response_obj),
                    "usage": str(usage),
                },
                sort_keys=True,
                default=str,
            ).encode("utf-8")
        ).hexdigest()
    now = time.monotonic()
    _RECENT_EVENT_IDS = {
        key: seen_at for key, seen_at in _RECENT_EVENT_IDS.items() if now - seen_at < 10
    }
    if event_id in _RECENT_EVENT_IDS:
        return False
    _RECENT_EVENT_IDS[event_id] = now
    if len(_RECENT_EVENT_IDS) > 2048:
        _RECENT_EVENT_IDS.pop(next(iter(_RECENT_EVENT_IDS)))
    return True


def _is_block_mode_on():
    """Check if proxy_block_mode is 'on' via ClawNex API.

    Fail-closed: if the dashboard is unreachable we assume block mode is ON,
    so that a synthetic BLOCK verdict from _scan() actually rejects traffic
    rather than being downgraded to a log-only event.
    """
    try:
        resp = httpx.get(f"{CLAWNEX_API}/api/proxy/block-mode", headers=_service_headers(), timeout=3)
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
        resp = httpx.get(f"{CLAWNEX_API}/api/break-glass/status", headers=_service_headers(), timeout=3)
        if resp.status_code == 200:
            return resp.json().get("active", False)
    except Exception as e:
        print(f"[ClawNex Logger] break-glass check error — treating as inactive: {e}")
    return False


def _valid_verdict(value, fallback="REVIEW"):
    """Keep proxy ingest values within the dashboard's verdict contract."""
    return value if value in {"ALLOW", "REVIEW", "BLOCK", "BYPASSED"} else fallback


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
            _remember_routing_identity(user_api_key_dict, data)
            messages = data.get("messages", [])
            if not messages:
                return None

            # Break-glass: skip scan, log as bypassed, allow through
            if _is_break_glass_active():
                handle = data.get('metadata', {}).pop('clawnex_evidence_handle', None)
                _ROUTING_IDENTITIES.pop(handle, None)
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
                    "source": _source_for(model, data),
                })
                print(f"[ClawNex Logger] BREAK-GLASS: {model} — bypassed shield scan")
                return None

            inbound_text = _extract_text(messages, _TRUSTED_CONTEXT_ROLES)
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
                    "source": _source_for(model, data),
                    **_blocked_routing_identity(data),
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

    @staticmethod
    async def async_post_call_success_hook(data, user_api_key_dict, response):
        """Record a completed proxy exchange before returning it to the caller."""
        # Completion recording is handled by async_log_success_event. Keeping
        # this proxy hook as a pass-through avoids a second ingest for the same
        # request on LiteLLM versions that dispatch both paths.
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
            if not _claim_event(kwargs, response_obj):
                return
            model = kwargs.get("model", "unknown")
            messages = kwargs.get("messages", [])
            latency_ms = int((end_time - start_time).total_seconds() * 1000) if end_time and start_time else 0
            bypassed = _is_break_glass_active()

            # Scan inbound
            inbound_text = _extract_text(messages, _TRUSTED_CONTEXT_ROLES)
            inbound_result = _scan(inbound_text, "inbound") if inbound_text.strip() and not bypassed else {"verdict": "ALLOW", "score": 0, "detections": []}

            # Extract response
            response_text = ""
            if hasattr(response_obj, "choices") and response_obj.choices:
                choice = response_obj.choices[0]
                if hasattr(choice, "message") and hasattr(choice.message, "content"):
                    response_text = choice.message.content or ""

            # Scan outbound
            outbound_result = _scan(response_text, "outbound") if response_text.strip() and not bypassed else {"verdict": "ALLOW", "score": 0, "detections": []}

            # Tokens
            input_tokens = output_tokens = total_tokens = 0
            if hasattr(response_obj, "usage") and response_obj.usage:
                input_tokens = getattr(response_obj.usage, "prompt_tokens", 0) or 0
                output_tokens = getattr(response_obj.usage, "completion_tokens", 0) or 0
                total_tokens = getattr(response_obj.usage, "total_tokens", 0) or 0
            cost_usd = _response_cost(response_obj, kwargs)

            # Verdicts
            inv = _valid_verdict(inbound_result.get("verdict", "ALLOW"))
            outv = _valid_verdict(outbound_result.get("verdict", "ALLOW"))
            verdict = "BLOCK" if "BLOCK" in (inv, outv) else "REVIEW" if "REVIEW" in (inv, outv) else "ALLOW"
            if bypassed:
                verdict = 'BYPASSED'
            score = max(inbound_result.get("score", 0), outbound_result.get("score", 0))
            detections = inbound_result.get("detections", []) + outbound_result.get("detections", [])

            _ingest({
                # The ClawNex ingest contract accepts inbound/outbound only.
                # This row represents the completed outbound provider exchange.
                "direction": "outbound",
                "model": model,
                "provider": _provider(model),
                "prompt_hash": hashlib.sha256(inbound_text.encode("utf-8", errors="replace")).hexdigest()[:16] if inbound_text else None,
                "messages_count": len(messages),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "cost_usd": cost_usd,
                "latency_ms": latency_ms,
                "shield_verdict": _valid_verdict(verdict),
                "shield_score": score,
                "shield_detections": detections[:10],
                "blocked": False,
                "status_code": 200,
                "source": _source_for(model, kwargs),
                **_completed_routing_identity(kwargs, None if bypassed else response_obj),
            })

            if verdict != "ALLOW":
                print(f"[ClawNex Logger] SHIELD: {model} verdict={verdict} score={score} tokens={total_tokens}")

        except Exception as e:
            print(f"[ClawNex Logger] Success callback error: {e}")
            traceback.print_exc()

    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        try:
            _completed_routing_identity(kwargs, None)  # consume failed requests without attesting completion
            if not _claim_event(kwargs, response_obj):
                return
            model = kwargs.get("model", "unknown")
            _ingest({
                "direction": "outbound",
                "model": model,
                "provider": _provider(model),
                "shield_verdict": "REVIEW",
                "shield_score": 0,
                "status_code": 500,
                "error": str(response_obj)[:200] if response_obj else "unknown",
                "source": _source_for(model, kwargs),
            })
            print(f"[ClawNex Logger] FAIL: {model}")
        except Exception:
            pass


# LiteLLM loads callback instances from config.yaml after startup globals are
# initialized. This config-addressable instance keeps proxy hooks and async
# success/failure callbacks on the supported loader path.
clawnex_logger_instance = ClawNexLogger()
