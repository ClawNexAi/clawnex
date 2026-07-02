# ClawNex API Reference

**Document ID:** CLAWNEX-API-001  
**Version:** 2.0  
**Classification:** Confidential  
**Last Updated:** 2026-05-14  
**Status:** Living Document  

---

## 1. Overview

**Base URL (internal):** `http://127.0.0.1:5001/api`  
**Base URL (public v1):** `http://127.0.0.1:5001/api/v1`  
**Content-Type:** `application/json` for all POST/PUT/PATCH requests  
**Response Format:** JSON (unless noted, e.g., `audio/mpeg` for voice, `application/gzip` for migrate, `text/event-stream` for SSE)  
**Route surface:** the internal `/api/*` surface + the public `/api/v1/*` surface — counts drift with each release; see `src/app/api/**/route.ts` for the live figure (v0.6.x snapshot: 103 internal + 7 public-v1)  
**OpenAPI:** A formal OpenAPI 3.1 specification is planned for v0.7.0 and will live at `/api/openapi.json`. Until then, this document is the authoritative contract.

This document describes the **internal** API (`/api/*`) used by the dashboard UI and MCP server. The **public** API (`/api/v1/*`) — for SIEM, CI/CD, and third-party integrations — is documented in CLAWNEX-INT-001 (docs/19). Both surfaces share the same underlying services.

### 1.1 Authentication

ClawNex supports three authentication modes depending on the endpoint and deployment configuration:

| Mode | Used On | How To Obtain | Header/Cookie |
|------|---------|---------------|---------------|
| **Session cookie (local password)** | `/api/*` (internal) when RBAC enabled | `POST /api/auth/login` | `clawnex_session` cookie (HttpOnly, SameSite=Lax, Secure when HTTPS) |
| **Session cookie (passkey)** | Same as above | `POST /api/auth/passkey/authenticate/complete` (v0.9.0+) | Same cookie; provider tracked in audit log |
| **Session cookie (GitHub OAuth)** | Same as above | `GET /api/auth/github/callback` (v0.9.0+) — admin must enable + pre-link | Same cookie; provider tracked in audit log |
| **API key** | `/api/v1/*` (public) always | Dashboard → Configuration → API Keys | `X-ClawNex-Key: cnx_...` or `Authorization: Bearer cnx_...` |
| **Localhost bypass** | `/api/*` when RBAC disabled | None | Request originates from `127.0.0.1` |

**Localhost bypass semantics:** When `RBAC_ENABLED=false`, requests from `127.0.0.1` are accepted without an authenticated session. Mutating methods (POST/PUT/PATCH/DELETE) also require same-host browser origin checks in localhost mode. Safe methods (GET/HEAD/OPTIONS) and non-browser callers with no browser origin headers are not subject to that browser-origin check. When `RBAC_ENABLED=true`, every internal API route requires a valid session cookie regardless of origin, and the session path runs the same shared origin-match helper as Layer 1 of CSRF defense.

**CSRF token flow:** All mutation endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) on internal `/api/*` routes require a CSRF token via the `X-CSRF-Token` header when RBAC is enabled. The flow:

1. Client calls `GET /api/auth/csrf` to receive a token and set the `clawnex_csrf` cookie.
2. Client sends every mutation with both the cookie AND the `X-CSRF-Token` header. The server performs a timing-safe comparison.
3. Mismatch returns `403 csrf_invalid`.

Public `/api/v1/*` endpoints do not use CSRF tokens — they rely solely on API key authentication.

### 1.2 Pagination Convention

Endpoints returning collections support two pagination styles:

- **Offset-based** (`GET /api/proxy/traffic`, `GET /api/audit`, `GET /api/cve`): `limit` and `offset` query parameters; response contains `total` for total count.
- **Cursor-based** (`GET /api/alerts` when `cursor` is provided): `cursor` query parameter; response contains `next_cursor` for the subsequent page.

Default `limit` is 100, maximum is 500 (or 1000 for `/api/audit`). Requests exceeding the maximum return `400 limit_out_of_range`.

### 1.3 Rate Limiting

Rate limiting applies to a subset of endpoints:

| Endpoint | Limit | Enforcement |
|----------|-------|-------------|
| `POST /api/auth/login` | 5 per minute per IP, plus progressive account lockout (5→1m, 10→5m, 15→30m, 20→disabled) | Returns `429 Too many login attempts`, `423 Account locked` |
| `POST /api/cve/sync` | GitHub API limit (60/hour unauthenticated) | Upstream 403 surfaced as 502 |
| `POST /api/threat-intel/check` | GitHub API limit (60/hour unauthenticated) | Upstream 403 surfaced as 502 |
| `POST /api/break-glass/activate` | Cool-down 15 minutes after deactivation | Returns `429 Cool-down active` |
| `/api/v1/*` (public) | Per-key limit configurable 1–10,000 requests/minute (default 60) | Returns `429 Rate limit exceeded` with `X-RateLimit-Reset` header |

**429 response shape (public `/api/v1/*`):**
```json
{
  "ok": false,
  "error": "Rate limit exceeded. Try again later.",
  "meta": { "requestId": "uuid", "timestamp": "ISO-8601" }
}
```
with headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix ms).

**429 response shape (internal `/api/*`):**
```json
{ "error": "Too many login attempts", "retry_after_seconds": 60 }
```

See also: `docs/19 §6` for full public API rate limiting details.

### 1.4 Response Headers (M6 + M1, 2026-05-14)

Every `/api/*` response carries:

```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
```

Operator-scoped JSON must never be replayed by intermediate caches (browser cache, CDN, corporate proxy). Header set at the framework level in `next.config.mjs`; individual route handlers do not need to add their own.

Standard security headers (X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, Strict-Transport-Security with `preload`) are emitted **once** by Next.js as the single source of truth. The production Caddyfile (`deploy/install-prod.sh`) deliberately does NOT re-emit them — doing so previously produced duplicate response headers with divergent HSTS values.

---

## 2. Shield Endpoints

### POST /api/shield/scan

Scan text through the Prompt Shield.

**Request:**
```json
{
  "text": "string (required, max 500,000 chars)",
  "source": "string (optional — 'dashboard', 'litellm-proxy', 'openclaw', 'manual')",
  "direction": "'inbound' | 'outbound' (optional, default: 'inbound')"
}
```

**Response (200):**
```json
{
  "verdict": "ALLOW | REVIEW | BLOCK",
  "score": 0,
  "elapsed": "12.3ms",
  "detections": [
    {
      "id": "SEC-AWS-KEY",
      "name": "AWS access key",
      "category": "secrets",
      "severity": "CRITICAL",
      "confidence": 0.95,
      "matchCount": 1,
      "samples": ["AKIAIOSFODNN7EXAMPLE"],
      "tags": ["secret"],
      "source": "sentinel"
    }
  ],
  "cleaned": "string (PII-redacted text, if includeRedacted was set)",
  "stats": {
    "total": 1,
    "critical": 1,
    "high": 0,
    "medium": 0,
    "low": 0,
    "categories": ["secrets"]
  },
  "scanId": "uuid",
  "source": "dashboard",
  "direction": "inbound",
  "timestamp": "ISO-8601"
}
```

**Notes:**
- When `source` is `litellm-proxy`, `openclaw`, or `proxy`, the persisted whitelist is applied (internal traffic)
- When `source` is `dashboard` or `manual`, all 163 rules are run regardless of whitelist
- Direction `outbound` runs outbound-specific rules (data leak detection)

---

### GET /api/shield/stats

Shield scan statistics.

**Query Parameters:**
- `since` — ISO timestamp (optional, default: last 24 hours)
- `instance` — `hermes-local` filters to hermes-only; any other value excludes hermes
- `includeTestGenerated` — when `true`, includes scans with `origin = shield-test`/`demo`/`qa` in the count. Default `false` so a Shield Tests run doesn't pollute header/sidebar/Fleet badges. The Welcome Wizard's "Run first shield test" step opts in via this flag — it's the one place where seeing a test-generated scan is the validation signal we want.

**Response (200):**
```json
{
  "total": 150,
  "blocked": 3,
  "reviewed": 12,
  "allowed": 135
}
```

---

### GET /api/shield/history

Recent shield scans.

**Query Parameters:**
- `limit` — number (optional, default: 20)
- `since` — ISO timestamp (optional)
- `instance` — same filtering semantics as `/api/shield/stats`
- `includeTestGenerated` — when `true`, includes scans with `origin = shield-test`/`demo`/`qa`. Default `false`. Mirrors the `/api/shield/stats` opt-out so the Shield History feed doesn't leak Shield Tests / demo / qa records into operator views.

**Response (200):**
```json
{
  "scans": [
    {
      "id": "uuid",
      "direction": "inbound",
      "source_session_id": null,
      "source_agent_id": null,
      "content_hash": "a1b2c3d4e5f6...",
      "layers_triggered": "secrets,commands",
      "threat_level": "BLOCK",
      "detail": "{...}",
      "scanned_at": "ISO-8601"
    }
  ]
}
```

---

### GET /api/shield/whitelist

Get current whitelist and all available rules.

**Response (200):**
```json
{
  "whitelist": ["COG-SOUL", "COG-IDENTITY", "..."],
  "rules": [
    {
      "id": "SEC-AWS-KEY",
      "title": "AWS access key",
      "category": "secrets",
      "severity": "CRITICAL",
      "whitelisted": false
    }
  ]
}
```

---

### PUT /api/shield/whitelist

Update the whitelist.

**Request:**
```json
{
  "rules": ["COG-SOUL", "COG-IDENTITY", "FIN-SWIFT-CODE"]
}
```

**Response (200):**
```json
{
  "ok": true,
  "whitelist": ["COG-SOUL", "COG-IDENTITY", "FIN-SWIFT-CODE"]
}
```

**Errors:**
- 400: `"Unknown rule IDs: FAKE-RULE"`
- 400: `"Expected { rules: string[] }"`

---

## 3. Traffic Endpoints

### GET /api/proxy/traffic

Paginated traffic logs.

**Query Parameters:**
- `limit` — number (optional, default: 100, max: 500)
- `offset` — number (optional, default: 0)
- `verdict` — string (optional — ALLOW, REVIEW, BLOCK)
- `model` — string (optional — partial match)
- `source` — string (optional — litellm, session-watcher, break-glass)

**Response (200):**
```json
{
  "traffic": [
    {
      "id": "uuid",
      "timestamp": "ISO-8601",
      "direction": "complete",
      "model": "qwen/qwen3.5-35b-a3b",
      "provider": "lmstudio",
      "upstream_url": "http://192.168.x.x:1234/v1/chat/completions",
      "prompt_hash": "a1b2c3d4...",
      "messages_count": 3,
      "input_tokens": 150,
      "output_tokens": 200,
      "total_tokens": 350,
      "cost_usd": 0,
      "latency_ms": 1200,
      "shield_verdict": "ALLOW",
      "shield_score": 0,
      "shield_detections": [],
      "blocked": 0,
      "block_reason": null,
      "session_id": null,
      "status_code": 200,
      "error": null,
      "source": "litellm"
    }
  ],
  "total": 1,
  "balanced": true
}
```

**Notes:** When no filters are applied, returns a balanced UNION across sources to prevent any source from dominating results.

---

### GET /api/proxy/stats

Aggregated traffic statistics.

**Response (200):**
```json
{
  "today": {
    "requests": 142,
    "blocked": 3,
    "avgLatency": 850,
    "totalTokens": 45200
  },
  "allTime": {
    "requests": 1250
  },
  "topModels": [
    { "model": "qwen/qwen3.5-35b-a3b", "cnt": 89 }
  ],
  "verdicts": [
    { "shield_verdict": "ALLOW", "cnt": 135 },
    { "shield_verdict": "BLOCK", "cnt": 3 }
  ],
  "topThreats": [
    { "name": "SOUL.md access (agent identity)", "count": 12 }
  ],
  "hourlyRequests": [
    { "hour": "2026-04-02T10:00", "cnt": 15 }
  ]
}
```

---

### POST /api/proxy/ingest

Ingest traffic record from LiteLLM callback.

**Request:**
```json
{
  "direction": "complete",
  "model": "qwen/qwen3.5-35b-a3b",
  "provider": "lmstudio",
  "prompt_hash": "a1b2c3d4",
  "messages_count": 3,
  "input_tokens": 150,
  "output_tokens": 200,
  "total_tokens": 350,
  "cost_usd": 0,
  "latency_ms": 1200,
  "shield_verdict": "ALLOW",
  "shield_score": 0,
  "shield_detections": [],
  "blocked": false,
  "block_reason": null,
  "session_id": null,
  "status_code": 200,
  "error": null,
  "source": "litellm"
}
```

**Response (200):**
```json
{ "ok": true, "id": "uuid" }
```

---

### GET /api/proxy/block-mode

Get current block mode.

**Response (200):**
```json
{ "blockMode": "off" }
```

---

### POST /api/proxy/block-mode

Toggle or set block mode.

**Request:**
```json
{ "mode": "on" }
```
Or empty `{}` to toggle.

**Response (200):**
```json
{ "blockMode": "on", "previous": "off" }
```

---

## 4. Break-Glass Endpoints

### POST /api/break-glass/activate

Activate break-glass mode.

**Request:**
```json
{
  "reason": "LiteLLM crashed during client demo (min 10 chars)",
  "duration_minutes": 30
}
```

Valid durations: 15, 30, 60, 120, 240

**Response (200):**
```json
{
  "ok": true,
  "activated_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "duration_minutes": 30
}
```

**Errors:**
- 400: `"Reason is required (minimum 10 characters)"`
- 400: `"Invalid duration"`
- 409: `"Break-glass is already active"`
- 429: `"Cool-down active. N seconds remaining"`

---

### POST /api/break-glass/deactivate

Manually deactivate break-glass.

**Response (200):**
```json
{
  "ok": true,
  "was_active": true,
  "duration_actual_minutes": 12,
  "unscanned_traffic": 47
}
```

**Errors:**
- 400: `"Break-glass is not active"`

---

### GET /api/break-glass/status

Get current break-glass status. Auto-deactivates if expired.

**Response (200) — inactive:**
```json
{
  "active": false,
  "activated_at": null,
  "expires_at": null,
  "remaining_seconds": null,
  "reason": null,
  "duration_minutes": null,
  "cool_down_remaining_seconds": 0
}
```

**Response (200) — active:**
```json
{
  "active": true,
  "activated_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "remaining_seconds": 1423,
  "reason": "LiteLLM crashed during demo",
  "duration_minutes": 30,
  "cool_down_remaining_seconds": 0
}
```

---

## 5. Alert Endpoints

### GET /api/alerts

List alerts.

**Query Parameters:**
- `status` — open, acknowledged, investigating, mitigated, resolved, false_positive (mutually exclusive with `scope`; `status` wins if both given)
- `scope` — `active` (open + acknowledged + investigating), `terminal` (resolved + suppressed + false_positive), or `all`. The canonical filter introduced in v0.9.3+ for dashboard surfaces. See `src/lib/dashboard/metric-semantics.ts` for the contract.
- `severity` — CRITICAL, HIGH, MEDIUM, LOW, INFO
- `source` — shield, watchdog, break-glass, proxy, session-watcher, etc.
- `since` — ISO timestamp
- `limit` — number (default: 50)
- `include_suppressed` — `true` layers suppressed alerts on top of whatever scope/status was selected (used by risk-acceptance review surfaces)
- `instance` — `hermes-local` shows only hermes-watcher alerts; any other value excludes them
- `productionOnly` — `true` filters rows to production origins via `productionOriginSqlClause('metadata')` (excludes `shield-test` / `demo` / `qa` / `simulation` origins). Default `false` preserves legacy behavior. Added 2026-04-30 per internal reviewer M-01 follow-up to close the asymmetry where Fleet per-instance alert counts already filtered by origin but the dashboard header CRITICAL pill, sidebar Active Alerts badge, and Fleet Alert Summary card did not.

**Response (200):**
```json
{
  "alerts": [ /* AlertRecord[] */ ],
  "total": 42,
  "filters": { "status": null, "severity": null, "source": null, "since": null, "productionOnly": false },
  "scope": "active",
  "effectiveScope": "active",
  "include_suppressed": false,
  "productionOnly": false,
  "timestamp": "ISO-8601"
}
```

**Scope provenance fields** (added 2026-04-29 per internal reviewer M-01 #3) let any consumer
tell which set the response actually represents:
- `scope` — raw value of the `scope` query param, or `null` if not provided
- `effectiveScope` — what the alert-manager logic actually applied: `'status'` (when `status` was used), `'active'`, `'terminal'`, `'all'`, or `'legacy-default'` (no filter given, returned everything except suppressed)
- `include_suppressed` — boolean echo of the layered opt-in
- `productionOnly` — boolean echo of the production-origin filter

---

### POST /api/alerts

Create a manual alert.

**Request:**
```json
{
  "title": "Manual alert (required)",
  "description": "Details (optional)",
  "severity": "CRITICAL | HIGH | MEDIUM | LOW | INFO (optional, default: MEDIUM)",
  "source": "operator (optional)"
}
```

**Response (201):**
```json
{ "id": "uuid", "title": "...", "severity": "MEDIUM" }
```

---

### GET /api/alerts/[id]/evidence (v0.11.1+)

Resolve a single alert to its triggering audit event for cross-panel deep-linking from the AlertsIncidentsPanel "View Evidence" button.

**Permission:** `audit:read` (RBAC-Off Defense Pattern: `requireSession` + `requirePermission` when RBAC enabled; `requireLocalhost` fallback when off)

**Path Parameters:**
- `id` — alert UUID

**Correlation methods (in order):**
1. **Forward link** — uses `alert.metadata.audit_event_id` if present (new alerts post-v0.11.1).
2. **Fallback `nearest`** — for legacy alerts: parse `Session: <uuid>` from `description`; find audit_log row matching `(source='session-watcher', action IN ('shield_review', 'shield_detected'), resource_id=<session_id>)` taking the nearest timestamp within ±60s of `alert.created_at`.

**Response (200):**
```json
{
  "alert_id": "uuid",
  "audit_event_id": "uuid | null",
  "correlation_method": "forward | fallback_nearest",
  "detections": [
    {
      "rule_key": "OUT-PII-EMAIL",
      "rule_name": "Email PII",
      "severity": "MEDIUM",
      "category": "outbound-leak",
      "sample": "user@example.com (or scanner-redacted form)",
      "confidence": 1.0
    }
  ],
  "matched_snippets": [
    {
      "rule_key": "OUT-PII-EMAIL",
      "before": "...payload context before the match...",
      "match": "user@example.com",
      "after": "...payload context after the match...",
      "match_found_in_excerpt": true
    }
  ],
  "payload_excerpt": "[redact()'d copy of the original payload]",
  "prompt_hash": "sha256:...",
  "proxy_traffic_id": "uuid | null"
}
```

**Notes:**
- `payload_excerpt` is always passed through `redact()` before being returned — it MUST NOT carry raw PII.
- `match_found_in_excerpt` is `false` when the scanner produced a partially-redacted sample (e.g. `+1-555-XXX-XXXX`) and `redact()` has rewritten the same span in the persisted excerpt → `payload.indexOf(sample)` returns -1. In that case the snippet still surfaces but `before`/`after` are empty and the UI shows the sample alone.
- `correlation_method: 'fallback_nearest'` is a heuristic match; the ±60s window is tight enough to avoid mis-correlating distinct sessions but loose enough to cover scan-time vs alert-creation-time clock skew.

**Errors:**
- `403` if RBAC enabled and operator lacks `audit:read`
- `404` if alert id unknown OR no correlatable audit row found within window
- `500` on database error

---

## 6. Configuration Endpoints

### GET /api/config/retention

Get data retention settings.

**Response (200):**
```json
{
  "categories": [
    {
      "key": "retention_traffic_days",
      "label": "Traffic Logs (proxy_traffic, shield_scans)",
      "value": 3,
      "options": [1, 3, 7, 14, 30, 90]
    },
    {
      "key": "retention_audit_days",
      "label": "Audit Trail (audit_log)",
      "value": 365,
      "options": [90, 180, 365, 0]
    }
  ]
}
```

---

### PUT /api/config/retention

Update retention settings.

**Request:**
```json
{
  "settings": {
    "retention_traffic_days": 7,
    "retention_audit_days": 0
  }
}
```

**Response (200):**
```json
{
  "ok": true,
  "settings": {
    "retention_traffic_days": 7,
    "retention_metrics_days": 3,
    "retention_correlations_days": 3,
    "retention_alerts_days": 90,
    "retention_audit_days": 0
  }
}
```

**Errors:**
- 400: `"Unknown setting: invalid_key"`
- 400: `"Invalid value for retention_traffic_days: 999. Valid options: 1, 3, 7, 14, 30, 90"`

---

### GET /api/config/defaults

Get all system defaults.

**Response (200):**
```json
{
  "settings": {
    "proxy_block_mode": "off",
    "shield_whitelist": "[\"COG-SOUL\",...]",
    "default_provider": "lmstudio-fleet"
  },
  "defaultModel": {
    "providerId": "lmstudio-fleet",
    "providerName": "LM Studio Fleet",
    "modelId": "qwen/qwen3.5-35b-a3b",
    "modelName": "Qwen3.5 35B A3B"
  }
}
```

---

## 7. Mail Configuration Endpoints

### GET /api/config/mail

Get current mail provider configuration. Secrets (API keys, SMTP passwords) are masked in the response.

**Requires:** `config:read` permission

**Response (200):**
```json
{
  "provider": "disabled | resend | smtp",
  "from_email": "noreply@example.com",
  "resend_api_key_masked": "re_****abcd",
  "smtp_host": "smtp.example.com",
  "smtp_port": 587,
  "smtp_user": "user@example.com",
  "smtp_pass_masked": "****"
}
```

---

### PUT /api/config/mail

Update mail provider configuration.

**Requires:** `config:write` permission (admin only)

**Request (Resend):**
```json
{
  "provider": "resend",
  "from_email": "noreply@example.com",
  "resend_api_key": "re_xxxxxxxxxxxx"
}
```

**Request (SMTP):**
```json
{
  "provider": "smtp",
  "from_email": "noreply@example.com",
  "smtp_host": "smtp.example.com",
  "smtp_port": 587,
  "smtp_user": "user@example.com",
  "smtp_pass": "password"
}
```

**Request (Disabled):**
```json
{
  "provider": "disabled"
}
```

**Response (200):**
```json
{ "ok": true, "provider": "resend" }
```

**Errors:**
- 400: `"Invalid provider"` — must be `disabled`, `resend`, or `smtp`
- 400: `"From email is required"`
- 403: `"Insufficient permissions"`

---

### POST /api/config/mail

Send a test email using the current mail configuration.

**Requires:** `config:write` permission (admin only)

**Request:**
```json
{
  "to": "test@example.com"
}
```

**Response (200):**
```json
{ "ok": true, "message": "Test email sent" }
```

**Errors:**
- 400: `"Mail provider is disabled"`
- 400: `"Recipient email is required"`
- 500: `"Failed to send test email"`

---

## 8. Skills & Agent Ignore Endpoints

### GET /api/skills

Returns skills from OpenClaw + plugins from Paperclip (if available).

**Response (200):**
```json
{
  "skills": [
    {
      "name": "agent-browser",
      "description": "Browser automation CLI for AI agents...",
      "source": "system",
      "type": "skill",
      "status": "active",
      "risk": "HIGH"
    }
  ],
  "total": 21,
  "sources": [
    { "name": "OpenClaw System Skills", "status": "online", "count": 3 },
    { "name": "OpenClaw Workspace Skills", "status": "online", "count": 18 },
    { "name": "Paperclip Plugins", "status": "connected", "count": 0 }
  ],
  "byRisk": { "high": 3, "medium": 7, "low": 11 }
}
```

---

### GET /api/config/agent-ignore

Get current agent ignore patterns.

**Response (200):**
```json
{ "patterns": ["Skill Installer"] }
```

---

### PUT /api/config/agent-ignore

Update agent ignore patterns.

**Request:**
```json
{ "patterns": ["Skill Installer", "Internal Bot"] }
```

**Response (200):**
```json
{ "ok": true, "patterns": ["Skill Installer", "Internal Bot"] }
```

---

### PUT /api/config/defaults

Set a single config default.

**Request:**
```json
{ "key": "ai_panel_default", "value": "closed" }
```

**Response (200):**
```json
{ "ok": true, "key": "ai_panel_default", "value": "closed" }
```

---

## 8A. Voice & Avatar Endpoints

### POST /api/voice/speak

Convert text to speech via ElevenLabs (server-side proxy).

**Request:** `{ "text": "Hello world" }`  
**Response:** `audio/mpeg` stream (or JSON fallback if not configured)

### POST /api/voice/heygen

HeyGen/LiveAvatar proxy. Actions: `create_token`, `list_avatars`

### POST /api/voice/did

D-ID streaming avatar proxy. Actions: `create_agent`, `create_stream`, `sdp_answer`, `speak`, `stop`, `list_presenters`

### GET/PUT /api/config/voice

Voice & avatar configuration (ElevenLabs key, HeyGen key, D-ID key, voice/avatar provider settings).

---

## 9. Fleet Endpoints

### GET /api/fleet

Returns fleet instance data including real system metrics, threat counts, cost, and posture scores.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `since` | ISO-8601 string | — | Filters threats, alerts, and cost to entries after this timestamp. When omitted, defaults to 24 hours for threats/alerts and 30 days for cost. |

**Example:** `GET /api/fleet?since=2026-04-03T12:00:00.000Z`

**Response (200):**
```json
{
  "instances": [
    {
      "id": "openclaw-local",
      "client": "Project owner",
      "version": "2026.3.28",
      "status": "healthy",
      "uptime": 3600,
      "cpu": 42,
      "mem": 67,
      "disk": 55,
      "threats": 3,
      "alerts": 1,
      "region": "Local",
      "heartbeat": 1712160000000,
      "agents": 13,
      "sessions": 224,
      "p95": 142,
      "cost": 12.47,
      "posture": 85,
      "isLive": true,
      "services": {
        "openclaw": "online",
        "paperclip": "offline",
        "autensa": "offline"
      }
    }
  ],
  "total": 1,
  "healthy": 1,
  "openclaw": {
    "connected": true,
    "authenticated": true,
    "sessions": 224,
    "agents": 13,
    "lastEvent": "ISO-8601",
    "lastError": null
  },
  "threatTrend": [45, 42, 38, 50, 55, 62, 58, 52, 48, 45, 42, 40],
  "timestamp": "ISO-8601"
}
```

**Notes:**
- The `since` parameter controls the time window for threat count, alert count, and cost calculation
- The `threatTrend` array contains the 12 most recent threat score snapshots (newest last)
- Additional gateway instances from `config_gateways` are included when configured

---

## 10. Threat Intelligence Endpoints

### GET /api/threat-intel

Returns threat intelligence source status, rule counts, and last check times.

**Response (200):**
```json
{
  "sources": [
    {
      "name": "L1B3RT4S",
      "repo": "elder-plinius/L1B3RT4S",
      "desc": "Master jailbreak prompt library",
      "ruleCount": 10,
      "lastChecked": "ISO-8601 | null",
      "lastCommit": "sha-string | null",
      "status": "active | update_available"
    }
  ],
  "totalPlinyRules": 16,
  "totalSources": 4
}
```

### POST /api/threat-intel/check

Polls GitHub API for latest commits on all monitored Pliny repos. Compares to stored SHAs. Creates MEDIUM alert if new commits detected.

**Response (200):**
```json
{
  "checked": 4,
  "updatesFound": 1,
  "results": [
    { "name": "L1B3RT4S", "status": "update_available", "sha": "abc123...", "message": "Update XAI.mkd" }
  ],
  "timestamp": "ISO-8601"
}
```

**Notes:**
- Rate limited by GitHub API (60 requests/hour for unauthenticated)
- Audit-logged as `intel_check` action
- Stores commit SHAs in `config_defaults` table

---

## 10A. Token Cost FinOps Endpoint (v0.11.0+)

### GET /api/tokens

Multi-source FinOps endpoint that normalizes LLM cost telemetry across OpenClaw, Hermes, and Paperclip into a single canonical row shape. Backwards-compatible with the pre-v0.11 `/api/tokens` shape — new fields are additive.

**Query Parameters:**
- `since` — ISO timestamp; lower bound on row timestamps
- `until` — ISO timestamp; upper bound (defaults to now)
- `instance` — string. `hermes-local` routes to only the Hermes adapter; a specific OpenClaw instance name routes to that fleet's OpenClaw adapter; absent → all 3 adapters run
- `agent` — string; filter to a specific agent
- `model` — string; filter to a specific model

**Response (200) — new fields highlighted:**
```json
{
  "rows": [
    {
      "row_id": "stable, deterministic, unique-across-sources",
      "source": "openclaw | hermes | paperclip",
      "provider": "string | null",
      "model": "string | null",
      "agent": "string | null",
      "session_id": "string | null",
      "source_agent_id": "string | null",
      "timestamp": "ISO-8601",
      "input_tokens": "int | null",
      "output_tokens": "int | null",
      "cache_read_tokens": "int | null",
      "cache_write_tokens": "int | null",
      "reasoning_tokens": "int | null",
      "tool_call_count": "int | null  (deterministic only — null = unknown)",
      "currency": "ISO 4217 | null",
      "estimated_cost_usd": "number | null",
      "actual_cost_usd": "number | null  (v1: only $0 on source-native included markers)",
      "recomputed_cost_usd": "number | null  (orchestrator-owned, populated when math + non-default rate match)",
      "cost_status": "actual | estimated | recomputed | included | token_only | unknown",
      "estimated_cost_source": "string | null",
      "actual_cost_source": "string | null",
      "recomputed_cost_source": "string | null",
      "pricing_version": "string | null",
      "row_flags": ["unsupported_currency", "..."]
    }
  ],
  "perSource": {
    "openclaw": { "count": 142, "totalUsd": 12.34 },
    "hermes":   { "count":  88, "totalUsd":  4.56 },
    "paperclip": { "count":  63, "totalUsd": 18.90 }
  },
  "headline": {
    "source": "openclaw | hermes | paperclip",
    "total":  18.90
  },
  "signals": [
    {
      "kind": "loop_risk | velocity_spike | context_bloat | cache_drop | cache_drop_risk | simple_on_expensive",
      "source": "openclaw | hermes | paperclip",
      "detail": "Possible repeated-call loop in Hermes",
      "count": 12,
      "affected_row_ids": ["..."]
    }
  ],
  "warnings": [
    {
      "source": "paperclip",
      "kind": "adapter_unavailable",
      "detail": "fetch failed: ECONNREFUSED"
    }
  ],
  "sourceStatus": {
    "openclaw":  "ok | unavailable",
    "hermes":    "ok | unavailable",
    "paperclip": "ok | unavailable"
  }
}
```

**Field semantics:**

- **`rows`** — array of `NormalizedRow`; the canonical normalization layer. Same shape across all 3 sources. See `src/lib/types/cost-reporting.ts` for the TypeScript contract.
- **`perSource`** — per-source aggregate. **Never sum these across sources** — they overlap (an OpenClaw call routed through LiteLLM appears in both OpenClaw and Paperclip totals).
- **`headline`** — single source with the largest `totalUsd`. Surfaces in the UI as "Highest reported monitored spend". Banned alternatives: "wallet total", "deduped total", "actual total spend" (v1 doesn't have provider-billed authority for any of these).
- **`signals`** — drain detector output. Five detector kinds, each with explicit guards (≥24 hourly buckets for velocity_spike, ≥10 rows for context_bloat, ≥3 days history for cache_drop, strict `tool_call_count===0` for simple_on_expensive). The detail string is human-readable.
- **`warnings`** — non-fatal adapter issues. `adapter_unavailable` indicates an adapter's `Promise.allSettled` rejected; the report is still returned (with that source's count=0) so one failing adapter doesn't poison the whole response.
- **`sourceStatus`** — `'ok'` if the adapter ran cleanly and returned ≥0 rows; `'unavailable'` if the adapter rejected.

**Privacy guarantees:**
- The response **never includes `signal_context`** — this is an adapter-private side-channel for drain detectors (Hermes system_prompt hashes, OpenClaw stopReasons). The orchestrator strips it before returning. Verified by static grep on the route source AND a runtime test asserting `'signal_context' in response` is `false` AND `JSON.stringify(response)` does not contain the substring.
- Hermes `system_prompt` plaintext stays inside the adapter scope. Verified by `verify-hermes-cost-adapter.ts` JSON-stringify substring assertions.
- The OpenClaw token-reader does NOT reference `message.content`, `message.parts`, `parts[*].text`, `body`, `prompt`, or `messages[*].content`. Enforced by static AST grep at `scripts/verify-openclaw-cost-adapter.ts`.

**Permission:** `traffic:read` (or no auth on localhost when RBAC disabled).

---

## 10B. Policy Framework Endpoints (v0.10.0+)

The Configurable Rule & Policy Framework v1 surface. All endpoints follow the RBAC-Off Defense Pattern: `requireSession` + `requirePermission` when `RBAC_ENABLED=true`; `requireLocalhost` fallback otherwise.

### GET /api/policies

List all policies with rule counts.

**Permission:** `policies:read`

**Response (200):**
```json
{
  "policies": [
    {
      "id": "uuid",
      "name": "ClawNex Default",
      "description": "Operator-visible mirror of inbound jailbreak / cognitive-tampering / secret / path detections",
      "source": "curated | system | custom",
      "lifecycle": "draft | lab | starter | strict | custom",
      "enabled": 1,
      "rule_count": 163,
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```

### POST /api/policies

Create a custom policy. Source is forced to `custom` regardless of body input.

**Permission:** `policies:write`

**Request:**
```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "lifecycle": "custom (default) | draft"
}
```

**Response (201):** Created policy record.

### GET /api/policies/[id]

Get a single policy by id.

**Permission:** `policies:read`

### PATCH /api/policies/[id]

Update a policy.

**Permission:** `policies:write`

**Vendor PATCH lockdown:** for `source: 'curated'` or `source: 'system'`, only `enabled` + `confirm_phrase` + `reason` are accepted in the body. Any other field returns 403. The `confirm_phrase` must match a `DISABLE_PHRASES` entry for that policy or PATCH returns 403 fail-closed.

**Custom policies** accept `name`, `description`, `enabled`, `lifecycle` freely.

### DELETE /api/policies/[id]

Delete a policy. Custom only — vendor policies return 403.

**Permission:** `policies:write`

### GET /api/policies/[id]/rules

List rules in a policy.

**Permission:** `policies:read`

**Response (200):**
```json
{
  "rules": [
    {
      "id": "uuid",
      "policy_id": "uuid",
      "rule_key": "EMPLOYEE-ID",
      "name": "Employee ID",
      "pattern": "\\b[A-G][0-9]{8}\\b",
      "is_regex": 1,
      "flags": "g",
      "direction": "inbound | outbound | both",
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "action": "score | allow | redact | review | block",
      "lifecycle": "draft | lab | starter | strict | custom",
      "enabled": 1,
      "exceptions": ["one literal substring per line"],
      "safety_exemption_reason": "string | null",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```

### POST /api/policies/[id]/rules

Create a rule under the named policy. **403 on vendor policies** (curated/system) — clone-then-customize is the path.

**Permission:** `policies:write`

**Save-time safety gate:**
- `assertRegexCompiles` (length ≤1024 + RegExp syntax) — always
- `assertRegexSafety` (`safe-regex2` AST) — for `createRule` (custom-policy authoring); fails return 400 with `code` discriminator (`UNSAFE` / `BAD_SYNTAX` / `TOO_LONG`)

**Flag normalization:**
- `g` is force-added (required for redact-span enumeration)
- Unsupported flags `d` / `y` return 400 with `InvalidRegexFlagsError`
- Duplicates rejected
- Canonical sort: `g→i→m→s→u`

### PATCH /api/policies/[id]/rules/[ruleId]

Update a rule. **403 on vendor parents.**

**Cross-policy guard:** `rule.policy_id === policy.id` enforced — rule-id-guess attacks return 404.

**Type validation:** strict booleans for `enabled`/`is_regex`; enum validation for `direction`/`severity`/`action`/`lifecycle`. No `enabled: 0` integer-bypass.

### DELETE /api/policies/[id]/rules/[ruleId]

Delete a rule. **403 on vendor parents.**

### POST /api/policies/[id]/test

Test a sample text against the policy's saved rules. Restricted scan oracle: an arbitrary text is run through the full rule set and the matched / suppressed result returned. Capped at 1000 iterations per rule per scan.

**Permission:** `policies:test` (Admin and Security Manager only — Operator / Viewer / Auditor get 403). Distinct from `policies:read` and `policies:write` because exposing arbitrary-input scan results is itself a probe surface.

**Request:**
```json
{ "text": "string (the sample to test)" }
```

**Response (200):** the route returns the policy id and the array of matched rules.

```json
{
  "policy_id": "uuid",
  "matched": [
    {
      "rule_key": "OUT-PII-EMAIL",
      "name": "Outbound PII: email",
      "matchCount": 3,
      "samples": ["alice@example.com", "bob@example.com", "carol@example.com"]
    },
    {
      "rule_key": "OUT-PII-PHONE_US",
      "name": "Outbound PII: phone us",
      "matchCount": 1,
      "samples": ["555-123-4567"],
      "suppressed_by_exception": true
    }
  ]
}
```

`matched[].suppressed_by_exception` is present (and `true`) only when the rule pattern matched but a rule exception clause cancelled the detection. The response does **not** include `redact_spans` — redaction is computed at scan time inside the policy evaluator and does not flow through the test endpoint envelope.

**Errors:**
- `400 {"error":"body must be a JSON object"}` — body wasn't a JSON object
- `400 {"error":"text is required (string)"}` — body missing `text` or `text` not a string
- `403 {"error":"forbidden","required":"policies:test"}` — caller lacks `policies:test`
- `404 {"error":"not found"}` — no policy with that id

**Audit events emitted by this surface:**

| Action | When |
|---|---|
| `policy_create` | POST /api/policies |
| `policy_edit` | PATCH /api/policies/[id] (only on actually-changed fields — diff body vs current) |
| `policy_enable` / `policy_disable` | PATCH /api/policies/[id] toggling enabled |
| `policy_delete` | DELETE /api/policies/[id] |
| `rule_create` | POST /api/policies/[id]/rules |
| `rule_edit` | PATCH /api/policies/[id]/rules/[ruleId] |
| `rule_delete` | DELETE /api/policies/[id]/rules/[ruleId] |
| `rule_iteration_capped` | Evaluator hit 1000-match cap on a rule (server-side) |
| `rule_auto_disabled` | 5 consecutive iteration-cap hits (server-side) |
| `rule_match_suppressed` | A rule pattern matched but the detection was suppressed. **`detail.suppression_kind` discriminator:** `'exception'` (rule exception clause matched the substring) or `'allow_action'` (rule's `action` is `allow`). There is no separate `rule_exception_suppressed` event — this is the consolidated audit surface. |
| `policy_test` | POST /api/policies/[id]/test (`detail` carries `policy_id`, `name`, `matched_rule_count`, `suppressed_count`, `verdict ∈ {matched, no_match}`) |

---

## 11. System Endpoints

### GET /api/health

Minimal public health probe. Anonymous — no authentication required. Intended for external uptime monitors (Uptime Robot, watchdog scripts, Autensa status polling) that need nothing beyond "is the process alive."

**v0.9.1+:** The detailed payload (OpenClaw connection state, break-glass reason, watcher internals, SSE client count) moved to `/api/health/detailed` per adversarial review finding #A4. Operators who previously scraped those fields from this endpoint must migrate — see the next section for options.

**Response (200):**
```json
{
  "status": "ok",
  "name": "ClawNex",
  "version": "0.9.1-alpha",
  "uptime": 3600,
  "timestamp": "ISO-8601"
}
```

**Side effects:** On every call this endpoint drives the lazy-init "tick" — session watcher bootstrap, Hermes watcher bootstrap, hourly DB retention enforcement, model-pricing seed, break-glass auto-expiry. Running it from a monitoring tool is sufficient to keep those tasks alive in any deployment.

---

### GET /api/health/detailed

Authenticated detailed health payload. **Added in v0.9.1-alpha.**

**Tri-gate authentication** — any of the following satisfies auth:

1. **API key** with `health:read` scope via `X-ClawNex-Key: cnx_...` or `Authorization: Bearer cnx_...`. Rate limited per the key's `rate_limit` column (default 60/min, admin-tunable during key creation). Recommended path for external enterprise monitoring (DataDog, Prometheus, paid tiers that can hold auth tokens).
2. **Session cookie** (`clawnex_session`) — for callers from the dashboard UI. Every authenticated operator can read health regardless of role; no `health:read` RBAC permission exists (operational visibility is not role-gated).
3. **Localhost origin** — when `RBAC_ENABLED=false`. MCP resources that co-locate with the Next.js process naturally pass this.

A request carrying an API-key header is evaluated against the API-key path **only** — it never falls back to localhost or session after a failed key check. Requests without an API-key header route to the session-or-localhost path based on RBAC mode.

**Errors:**
- `401 Unauthorized` — API-key header present but invalid or missing `health:read` scope, or RBAC-on with no session, or RBAC-off from non-localhost origin.
- `429 Too Many Requests` — API-key path exceeded the key's per-minute rate limit.

**Response (200):**
```json
{
  "status": "ok",
  "name": "ClawNex",
  "version": "0.9.1-alpha",
  "uptime": 3600,
  "sseClients": 1,
  "openclaw": {
    "connected": true,
    "authenticated": true,
    "lastEvent": "ISO-8601",
    "lastError": null,
    "reconnectAttempts": 0,
    "sessions": 5,
    "agents": 10
  },
  "breakGlass": {
    "active": false,
    "expires_at": null,
    "remaining_seconds": null,
    "reason": null
  },
  "sessionWatcher": {
    "running": true,
    "enabled": true,
    "uptime": 3590,
    "filesWatched": 171,
    "messagesScanned": 331,
    "lastScanTime": "ISO-8601",
    "errors": 0
  },
  "hermesWatcher": {
    "running": true,
    "enabled": true,
    "uptime": 3590,
    "messagesScanned": 0,
    "lastScanTime": "ISO-8601",
    "errors": 0,
    "hermesAvailable": true
  },
  "timestamp": "ISO-8601"
}
```

**Side effects:** same tick as `/api/health`. Runs on every call.

---

### GET /api/events/stream

Server-Sent Events stream for real-time dashboard updates.

**Response:** SSE stream (Content-Type: text/event-stream)

**Events:**
```
event: proxy_traffic
data: {"id":"...","model":"...","shield_verdict":"ALLOW",...}

event: alert_new
data: {"id":"...","title":"...","severity":"CRITICAL",...}

event: alert_updated
data: {"id":"...","status":"acknowledged",...}

event: proxy_block_mode
data: {"blockMode":"on"}

event: break_glass_activated
data: {"activated_at":"...","expires_at":"...","reason":"..."}

event: break_glass_deactivated
data: {"expired":false,"duration":23,"unscanned":47}
```

---

### GET /api/watcher/status

Session watcher status.

**Response (200):**
```json
{
  "running": true,
  "enabled": true,
  "uptime": 3590,
  "filesWatched": 171,
  "messagesScanned": 331,
  "lastScanTime": "ISO-8601",
  "errors": 0,
  "pollIntervalMs": 2000,
  "sessionsDirectory": "~/.openclaw/agents/main/sessions"
}
```

---

### GET /api/audit

Audit log entries with server-side filtering.

**Query Parameters:**
- `limit` — number (optional, max 1000)
- `since` — ISO timestamp (optional)
- `until` — ISO timestamp (optional)
- `actor` — string (optional — filter by actor)
- `action` — string (optional — filter by action type)
- `source` — string (optional — filter by source)
- `resource_type` — string (optional)
- `exclude_actions` — comma-separated string (optional — e.g., `agent_event,chat_event`)
- `search` — string (optional — text search across action, actor, detail, resource_type, resource_id)

**Response (200):**
```json
{
  "entries": [
    {
      "id": "uuid",
      "actor": "operator",
      "action": "proxy_block_mode_changed",
      "resource_type": "proxy",
      "resource_id": "block_mode",
      "detail": "Block mode changed from off to on",
      "source": "sentinel",
      "created_at": "ISO-8601"
    }
  ]
}
```

---

## 12. System Management Endpoints

### POST /api/system/archive

Create a timestamped backup of the database and configuration files.

**Response (200):**
```json
{
  "ok": true,
  "path": "~/sentinel-backups/20260405-120000",
  "files": ["sentinel.db", ".env.local", "litellm/config.yaml"],
  "timestamp": "ISO-8601"
}
```

---

### POST /api/system/purge

Delete all high-volume operational data (traffic, metrics, shield scans, correlations). Preserves configuration, audit trail, and alerts.

**Response (200):**
```json
{
  "ok": true,
  "purged": {
    "proxy_traffic": 12450,
    "shield_scans": 8200,
    "metric_snapshots": 4300,
    "correlation_events": 150
  },
  "timestamp": "ISO-8601"
}
```

---

### POST /api/system/uninstall

Stop services, remove watchdog cron, and delete the installation directory. This is step 3 of the 3-step uninstall process (archive first, then purge, then uninstall).

**Response (200):**
```json
{
  "ok": true,
  "actions": ["services_stopped", "watchdog_removed", "installation_deleted"],
  "timestamp": "ISO-8601"
}
```

**Warning:** This is irreversible. Run `POST /api/system/archive` first to preserve a backup.

---

### POST /api/system/migrate

Package the database, configuration, and deployment files into a portable tar.gz archive for transfer to a new host.

**Response:** Binary stream (`application/gzip`). Save with:
```bash
curl -X POST http://127.0.0.1:5001/api/system/migrate -o clawnex-migration.tar.gz
```

---

## 13. CVE Endpoints

### GET /api/cve

List CVE records with optional filtering.

**Query Parameters:**
- `severity` — string (optional — CRITICAL, HIGH, MEDIUM, LOW)
- `cwe` — string (optional — CWE ID, e.g., `CWE-78`)
- `shield_category` — string (optional — mapped shield category)
- `limit` — number (optional, default: 100)
- `offset` — number (optional, default: 0)
- `search` — string (optional — text search across CVE ID and description)

**Response (200):**
```json
{
  "cves": [
    {
      "id": "CVE-2024-12345",
      "description": "Command injection vulnerability in ...",
      "severity": "CRITICAL",
      "cwe_id": "CWE-78",
      "shield_category": "commands",
      "published_at": "ISO-8601",
      "synced_at": "ISO-8601"
    }
  ],
  "total": 108,
  "timestamp": "ISO-8601"
}
```

---

### POST /api/cve/sync

Sync CVE records from the jgamblin/OpenClawCVEs GitHub repository. Fetches latest data, maps CWEs to shield categories, and upserts into the `cve_records` table.

**Response (200):**
```json
{
  "ok": true,
  "synced": 108,
  "new": 3,
  "updated": 2,
  "source": "jgamblin/OpenClawCVEs",
  "timestamp": "ISO-8601"
}
```

**Notes:**
- Rate limited by GitHub API (60 requests/hour unauthenticated)
- Audit-logged as `cve_sync` action
- Creates MEDIUM alert if new CVEs are found

---

## 14. LiteLLM Proxy Endpoint

**Base URL:** `http://127.0.0.1:4001`

### GET /health

LiteLLM health check.

**Response (200):**
```json
{
  "status": "healthy"
}
```

### POST /v1/chat/completions

Standard OpenAI-compatible chat completion endpoint. ClawNex scans via the pre-call hook before forwarding to the upstream model provider.

**Authentication:** API key with `chat:completions` scope via `X-ClawNex-Key: cnx_...` or `Authorization: Bearer [REDACTED]`.

**Message-shape contract** (Codex r5 / internal reviewer r4 BLOCKER closure, 2026-05-17 — enforced by `src/lib/shield/sanitize-chat-payload.ts`):

Each entry in `messages[]` MUST be a plain object with EXACTLY two fields:

| Field | Type | Required | Allowed values |
|---|---|---|---|
| `role` | string | yes | `system`, `user`, `assistant`, `function`, `tool` |
| `content` | string | yes | string, up to 100,000 chars per message |

Any other shape returns `400` with code `unsupported_message_shape`. The error body is intentionally generic and does not name the offending field. The relay's scan-equals-forward invariant requires that what the shield scans is exactly what gets forwarded upstream; sibling fields on a message object would be forwarded unscanned, so they are refused outright.

**Not supported in v1** (return 400):
- Non-string `content` (arrays of multimodal parts, bare objects, numbers, null)
- `tool_calls`, `function_call`, `tool_call_id`, `name`, or any field outside the `{role, content}` allowlist
- Roles outside the allowed set
- Streaming responses (`stream: true`) — deferred to v2

**Body caps:**
- Total request body ≤ 2 MB
- ≤ 200 messages per call
- ≤ 100,000 chars per message `content`
- `max_tokens` ≤ 32,000

**Outbound scanning:** the upstream LLM response is scanned via `extractAssistantOutput` across every assistant-output channel (legacy `text`, string + array `message.content`, `tool_calls.arguments`, `function_call.arguments`, streaming `delta`, unknown nested fields). If the outbound shield returns `BLOCK` and `proxy_block_mode` is `on` or `block`, the response is withheld with a generic `503` and a logged traffic row.

### POST /api/chat

Dashboard chat endpoint used by the in-app assistant. Same message-shape contract as `/v1/chat/completions` above — `history[]` entries (when present) MUST be plain objects with exactly `{role, content}` per the allowlist. Any other shape returns `400` with the generic body `Unsupported history shape`. The route does not accept multimodal / structured content, sibling fields, or roles outside the allowed set. The forwarded upstream payload (LiteLLM / LM Studio / OpenClaw branches) is rebuilt from the sanitized representation, not the raw caller body.

---

## 14A. Connector Routing Inventory Endpoints (v0.15.3+)

These endpoints discover connector provider/model inventory, persist operator
route intent, detect added/removed routes, and apply selected OpenClaw or
Hermes custom-provider routing.

OpenClaw routing is enforceable at provider endpoint level. This means OpenClaw
routes by provider `baseUrl`, not by independent per-model switches. Selecting a
model records operator intent for that model, but applying the route updates the
model's provider endpoint; sibling models on the same provider follow the same
route.

Hermes routing uses the same provider-level model for writable
`custom_providers` in `~/.hermes/config.yaml`. Applying Hermes routing updates
the selected custom provider's `base_url` to the local LiteLLM proxy and sets
`key_env: LITELLM_MASTER_KEY`. OAuth/session-bound and watcher-only Hermes rows
remain read-only retrospective inventory.

### GET /api/connector-routing

Sync and return connector routing inventory.

**Response (200):**
```json
{
  "litellmTarget": "http://127.0.0.1:4001/v1",
  "driftTotal": 1,
  "openclaw": {
    "status": "ok",
    "selected": 2,
    "drift": { "new": 1, "removed": 0, "changed": 0, "total": 1 },
    "items": [
      {
        "connector": "openclaw",
        "itemType": "model",
        "providerId": "openrouter",
        "modelId": "openrouter/auto",
        "capability": "model-inventory",
        "currentRoute": "direct",
        "desiredRoute": "routed",
        "present": true
      }
    ]
  },
  "hermes": {
    "status": "ok",
    "selected": 1,
    "items": [
      {
        "connector": "hermes",
        "itemType": "provider",
        "providerId": "kimi",
        "capability": "provider-routing",
        "currentRoute": "direct",
        "desiredRoute": "routed",
        "present": true
      }
    ]
  }
}
```

### POST /api/connector-routing

**Actions:**

```json
{ "action": "sync" }
{ "action": "select", "connector": "openclaw", "itemIds": ["cri_..."], "desiredRoute": "routed" }
{ "action": "select", "connector": "hermes", "itemIds": ["cri_..."], "desiredRoute": "routed" }
{ "action": "select-all", "connector": "openclaw", "desiredRoute": "direct" }
{ "action": "apply-openclaw" }
{ "action": "apply-hermes" }
{ "action": "revert-hermes" }
```

Hermes rejects `"desiredRoute": "routed"` for watcher-only, OAuth/session-bound,
or otherwise unsupported rows. Only config-backed custom providers with
HTTP-compatible endpoints are writable.

### GET /api/hermes/gateway/restart

Detect the Hermes gateway supervisor ClawNex would use for restart without
restarting anything. Supported targets are scoped to known Hermes supervisors:
`ai.hermes.gateway` / `ai.hermes.gateway-*` on macOS launchd and known Hermes
user units on Linux systemd.

### POST /api/hermes/gateway/restart

Restart the detected Hermes gateway supervisor so Hermes reloads provider
configuration after **Save Hermes Wire** or **Revert Hermes Wire**. RBAC
`config:write` is required when RBAC is enabled; localhost fallback applies
when RBAC is off.

---

## 14B. Legacy OpenClaw Routing Endpoints (v0.9.3+)

These endpoints manage the bridge between OpenClaw and the LiteLLM proxy.
Wiring writes a `models.providers.litellm` entry into `~/.openclaw/openclaw.json`
so OpenClaw routes LLM traffic through ClawNex's shield instead of going
direct to provider APIs. Ownership is tracked in a sidecar marker file at
`~/.clawnex-routing-managed.json` so the operation is cleanly revertable.

Implementation: `src/lib/services/openclaw-routing-wire.ts` (engine) and
`src/lib/services/openclaw-gateway-control.ts` (supervisor detection /
restart). RBAC `config:write` on every POST + localhost fallback when
RBAC is off (RBAC-Off Defense Pattern). Mutations audit-logged.

### GET /api/openclaw/routing

Read provider routing status + ClawNex-managed wire state.

**Response (200):**
```json
{
  "found": true,
  "path": "/home/<operator-user>/.openclaw/openclaw.json",
  "providers": [
    { "id": "litellm", "name": "litellm", "baseUrl": "http://127.0.0.1:4001/v1", "routed": true }
  ],
  "gatewayToken": "98898b3a...85491990",
  "hasToken": true,
  "litellmTarget": "http://127.0.0.1:4001/v1",
  "openclawVersion": "2026.4.26",
  "managed": {
    "sidecar": {
      "version": 1,
      "managedAt": "ISO-8601",
      "clawnexVersion": "0.9.2",
      "openclawVersion": "2026.4.26",
      "providerId": "litellm",
      "paths": [
        { "path": ["models","providers","litellm"], "valueSha256": "...", "operation": "set" },
        { "path": ["agents","defaults","model","primary"], "valueSha256": "...", "operation": "set-if-missing" }
      ]
    },
    "pathStatus": [
      { "path": ["models","providers","litellm"], "present": true, "matches": true }
    ]
  }
}
```

`managed.sidecar` is `null` when ClawNex hasn't wired this fleet (or the
operator reverted). `managed.pathStatus` lets a UI show per-path drift
(operator edited a managed value after the wire).

### POST /api/openclaw/routing

Wire / revert / inspect via the engine. Single endpoint, action discriminator.

**Request:**
```json
{ "action": "wire" | "revert" | "inspect", "force": false }
```

**Wire result (200 success, 409 conflict):**
```json
{
  "ok": true,
  "action": "wire",
  "status": "wired" | "already-wired" | "conflict" | "no-openclaw" | "error",
  "detail": "Wired 2 path(s). LiteLLM at http://127.0.0.1:4001/v1. Restart openclaw-gateway for changes to take effect.",
  "restartRequired": true,
  "sidecar": { /* full SidecarV1 */ }
}
```

`status: "conflict"` is returned (with HTTP 409) when a `models.providers.litellm`
entry already exists but no sidecar (operator-owned), or the sidecar's
recorded SHA doesn't match the current value (operator edited externally).
Pass `"force": true` to overwrite.

**Revert result (200 success, 500 error):**
```json
{
  "ok": true,
  "action": "revert",
  "status": "reverted" | "nothing-to-revert" | "error",
  "detail": "Reverted. No operator edits detected; full clean revert.",
  "preservedPaths": [["agents","defaults","model","primary"]]
}
```

`preservedPaths` lists paths that were left in place because their value
diverged from the recorded SHA — operator edits after the wire are
preserved automatically on `set-if-missing` paths. `set` paths (slots
ClawNex exclusively owns) are always reclaimed regardless of edits.

**Inspect result (200):**
```json
{
  "ok": true,
  "action": "inspect",
  "sidecar": { /* SidecarV1 or null */ },
  "configFound": true,
  "status": [
    { "path": ["models","providers","litellm"], "present": true, "matches": true }
  ]
}
```

### GET /api/openclaw/gateway/restart

Detect the platform's gateway supervisor without restarting. Used by the
UI to decide between rendering an active **Restart Gateway** button or
showing the manual fallback command.

**Response (200):**
```json
{
  "ok": true,
  "supervisor": {
    "kind": "systemd-user" | "launchd" | "unsupported",
    "label": "systemd user unit (owner: <operator-user>)" | "launchd Aqua session (macOS)" | "<platform> (no known supervisor)",
    "manualCommand": "XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart openclaw-gateway"
  }
}
```

### POST /api/openclaw/gateway/restart

Trigger the platform-appropriate restart of the long-running
`openclaw-gateway` daemon so it picks up routing changes from
`openclaw.json` (most commonly: a fresh `models.providers.litellm`
entry just written by the wire).

**Request:** `{}` (no body fields)

**Response (200 success, 501 unsupported, 500 exec-failed):**
```json
{
  "ok": true,
  "supervisor": "systemd-user",
  "status": "restarted" | "unsupported" | "detection-failed" | "exec-failed",
  "detail": "Restarted openclaw-gateway via systemd user unit (owner: <operator-user>).",
  "output": "<combined stdout+stderr from supervisor command>",
  "elapsedMs": 312,
  "manualCommand": "XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart openclaw-gateway"
}
```

Manual fallback command is always populated, even on success — operators
can reproduce the exact action by hand if needed.

---

## 15. Auth Endpoints

These endpoints are publicly accessible when RBAC is enabled, unless otherwise noted. All endpoints except `/api/auth/setup`, `/api/auth/login`, `/api/auth/status`, and `/api/auth/csrf` require a valid `clawnex_session` cookie. Mutation endpoints (POST/PUT/PATCH/DELETE) also require a valid CSRF token via the `X-CSRF-Token` header.

---

### POST /api/auth/setup

Create the initial admin account. One-time use — only available when RBAC is enabled and zero operators exist.

**Request:**
```json
{
  "username": "string (required)",
  "email": "string (optional)",
  "password": "string (required)",
  "setup_secret": "string (optional)"
}
```

**Response (200):**
```json
{
  "ok": true,
  "operator": {
    "id": "uuid",
    "username": "admin",
    "role": "admin"
  }
}
```

**Side effects:**
- Sets `clawnex_session` cookie

**Errors:**
- 400: `"Setup already complete"` (operators already exist)
- 400: `"RBAC is not enabled"`

---

### POST /api/auth/login

Authenticate an operator.

**Request:**
```json
{
  "username": "string (required)",
  "password": "string (required)",
  "remember": "boolean (optional)"
}
```

**Response (200):**
```json
{
  "ok": true,
  "operator": {
    "id": "uuid",
    "username": "admin",
    "role": "admin"
  }
}
```

**Side effects:**
- Sets `clawnex_session` cookie

**Rate limiting:**
- 5 attempts per minute per IP
- Progressive lockout: 5 failures = 1 min, 10 = 5 min, 15 = 30 min, 20 = account disabled

**Errors:**
- **400**: `"Invalid JSON body"` (M2 2026-05-14: non-JSON body returns 400 instead of crashing into a 500)
- **400**: `"Username and password are required"`
- **401**: `"Invalid credentials"` — generic envelope for every failure mode (bad password, unknown user, lockout active, account disabled)
- **429**: `"Too many login attempts"`

> **2026-05-14 security note.** Failed login responses use a minimum response-time floor so authentication failures do not expose useful account-existence timing differences. The success path is exempt.

---

### POST /api/auth/logout

Destroy the current session.

**Requires:** valid `clawnex_session` cookie

**Response (200):**
```json
{ "ok": true }
```

**Side effects:**
- Clears `clawnex_session` cookie

---

### GET /api/auth/me

Get the current operator's identity.

**Requires:** valid `clawnex_session` cookie

**Response (200):**
```json
{
  "operator": {
    "id": "uuid",
    "username": "admin",
    "role": "admin",
    "displayName": "Admin User"
  }
}
```

**Errors:**
- 401: `"Not authenticated"`

---

### GET /api/auth/status

Public auth status check. No authentication required.

**Response (200) — anonymous caller (no valid session cookie):**
```json
{
  "rbacEnabled": true,
  "needsSetup": false,
  "authenticated": false,
  "operator": null,
  "magicLinkAvailable": true
}
```

**Response (200) — authenticated caller:**
```json
{
  "rbacEnabled": true,
  "needsSetup": false,
  "authenticated": true,
  "operator": { "id": "uuid", "username": "alice", "role": "admin" },
  "operatorCount": 2,
  "magicLinkAvailable": true
}
```

> **2026-05-14 security note.** `operatorCount` is **only** included in the response for authenticated callers. The boolean `needsSetup` is sufficient for the login page to decide setup-vs-login.

---

### GET /api/auth/csrf

Get a CSRF token. No authentication required.

**Response (200):**
```json
{ "token": "string" }
```

**Side effects:**
- Sets `clawnex_csrf` cookie

---

### GET /api/auth/sessions

List the current operator's active sessions.

**Requires:** valid `clawnex_session` cookie

**Response (200):**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "created_at": "ISO-8601",
      "last_active": "ISO-8601",
      "ip": "127.0.0.1",
      "current": true
    }
  ]
}
```

---

### DELETE /api/auth/sessions

Destroy a specific session by ID.

**Requires:** valid `clawnex_session` cookie

**Query Parameters:**
- `id` — session UUID (required)

**Response (200):**
```json
{ "ok": true }
```

---

### POST /api/auth/forgot-password

Request a password reset link. No authentication required.

**Request:**
```json
{
  "email": "operator@example.com"
}
```

**Response (200) — every branch:**
```json
{ "message": "If an account with that email exists, a password reset link has been sent." }
```

> **2026-05-14 (M5 DAST remediation).** This endpoint now returns the generic envelope above on **every** branch — including when RBAC is disabled and when the mail provider isn't configured. The prior responses (`403 "RBAC is not enabled"` and `503 "Email is not configured"`) were operational-intelligence leaks. Misconfiguration is logged server-side via `console.warn`; the operator-facing response stays identical to "account doesn't exist" so probes can't enumerate state. Rate-limit (3/min/IP) still applies; rate-limited callers also receive the same generic envelope.

**Notes:**
- Always returns 200 regardless of whether the email matches an operator (prevents user enumeration)
- Requires mail provider to be configured (Resend or SMTP)
- Reset link expires after 30 minutes
- Audit-logged as `password_reset_requested`

**Errors:**
- 400: `"Email is required"`
- 503: `"Mail provider is not configured"`

---

### POST /api/auth/reset-password

Consume a password reset token and set a new password. No authentication required.

**Request:**
```json
{
  "token": "reset-token-from-email",
  "password": "new-password"
}
```

**Response (200):**
```json
{ "ok": true, "message": "Password has been reset" }
```

**Side effects:**
- All of the operator's existing sessions are revoked

**Errors:**
- 400: `"Token and password are required"`
- 400: `"Reset token is invalid or expired"`

---

## 15A. Multi-Auth Provider Endpoints (v0.9.0+)

WebAuthn passkey + GitHub OAuth sign-in routes. All authenticate-side routes are anonymous; all enrollment/management routes require a valid session. Every route is per-IP rate-limited with the same sliding window as `/api/auth/login` (default 5/min, `LOGIN_RATE_LIMIT`).

See `docs/12-deployment-guide.md` §5.7 for env-var setup (`AUTH_RP_ID`, `AUTH_EXPECTED_ORIGIN`, `GITHUB_OAUTH_*`) and the live verification checklist.

---

### POST /api/auth/passkey/register/begin

Generate WebAuthn registration options for the current operator. Stores a per-session challenge in a 5-minute httpOnly cookie scoped to `/api/auth/passkey`.

**Auth:** Required (session cookie).

**Request:** No body.

**Response:** `200 OK`
```json
{ "options": { "rp": {...}, "user": {...}, "challenge": "...", "pubKeyCredParams": [...], ... } }
```

The `options` object is the JSON shape `@simplewebauthn/browser.startRegistration` accepts as `optionsJSON`.

**Errors:** 401 (not authenticated), 500 (server error).

---

### POST /api/auth/passkey/register/complete

Verify the browser's attestation response and persist the new passkey credential. On success, marks `passkey` as enrolled in `operators.auth_providers`.

**Auth:** Required (session cookie + CSRF + `clawnex_passkey_chal` challenge cookie from /begin).

**Request body:**
```json
{
  "response": { /* RegistrationResponseJSON from @simplewebauthn/browser */ },
  "label": "MacBook fingerprint"   // optional, max 80 chars
}
```

**Response:** `200 OK`
```json
{ "ok": true, "credentialId": "<row-uuid>" }
```

**Errors:** 400 (missing response, expired challenge, verification failure), 401, 500.

**Audit:** Emits `passkey_enrolled` with the credential label.

---

### POST /api/auth/passkey/authenticate/begin

Generate WebAuthn authentication options for the resident-key sign-in flow (no username field — the browser surfaces enrolled passkeys for the RP and the user picks).

**Auth:** Anonymous, IP rate-limited.

**Request:** No body.

**Response:** `200 OK` with the same `{ options }` shape as /register/begin (request type instead of creation).

**Errors:** 429 (rate limited), 500.

---

### POST /api/auth/passkey/authenticate/complete

Verify the browser's signed assertion, look up the operator by credential ID, increment the WebAuthn signature counter, and create a session.

**Auth:** Anonymous, IP rate-limited, requires `clawnex_passkey_chal` cookie from /begin.

**Request body:**
```json
{
  "response": { /* AuthenticationResponseJSON from @simplewebauthn/browser */ },
  "remember": true   // optional — extends session TTL to 30 days like /login
}
```

**Response:** `200 OK` with `Set-Cookie: clawnex_session=...`
```json
{
  "ok": true,
  "operator": { "id": "...", "username": "...", "role": "admin" }
}
```

**Errors:** 400 (missing response), 401 (`Invalid credentials` — generic for any verification failure including challenge expiry, unknown credential, counter regression, or disabled operator), 429, 500.

**Audit:** Emits `operator_login` (provider=passkey) on success or `passkey_login_failed` on failure with the failure code.

---

### GET /api/auth/passkeys

List the current operator's enrolled passkeys for the Auth & Devices settings card. Public-key bytes are never returned — only the metadata the operator needs to recognise and manage each credential.

**Auth:** Required (session cookie).

**Response:** `200 OK`
```json
{
  "passkeys": [
    {
      "id": "<row-uuid>",
      "label": "MacBook fingerprint",
      "transports": ["internal", "hybrid"],
      "createdAt": "2026-04-23T18:14:02.123Z",
      "lastUsedAt": "2026-04-24T09:01:11.456Z"
    }
  ]
}
```

---

### DELETE /api/auth/passkeys/:id

Revoke one of the current operator's passkeys. Refuses (404) if the row doesn't belong to the requester.

**Auth:** Required (session cookie + CSRF).

**Response:** `200 OK` with `{ "ok": true }`.

**Errors:** 401, 404 (not found / not owned).

**Audit:** Emits `passkey_revoked` with the credential label.

---

### GET /api/auth/github/start

Anonymous endpoint — 302-redirects to GitHub's authorize page. Sets a state cookie (CSRF defense) and a `purpose=signin` cookie scoped to `/api/auth/github`. Refuses with a `?error=` redirect if the provider is not enabled or not configured.

**Auth:** Anonymous, IP rate-limited.

**Response:** `302 Found` to `https://github.com/login/oauth/authorize?...`

**Error redirects:** `/login?error=github_not_enabled`, `/login?error=github_not_configured`, `/login?error=github_rate_limited`, `/login?error=github_start_failed`.

---

### GET /api/auth/github/callback

GitHub redirects here after the user authorizes. Two flows behind one URL:

- `purpose=signin` (set by /start) — exchange code, fetch the GitHub user, look up the operator linked to that `github_user_id`, mint a session.
- `purpose=link` (set by /link) — exchange code, persist the `operator_credentials` row for the currently-logged-in operator.

**Auth:** Anonymous (signin) or session cookie (link). State cookie must match `?state=` query param.

**Query params:** `code`, `state` (both required).

**On signin success:** `302 → /` with `Set-Cookie: clawnex_session=...`.
**On link success:** `302 → /?github_linked=1`.
**On failure:** `302 → /login?error=github_state_mismatch | github_signin_failed | github_not_linked | github_not_enabled | github_rate_limited` or `/?error=github_link_failed | github_already_linked`.

**Audit:** Emits `operator_login` (provider=github), `github_linked`, `github_login_failed`, depending on flow + outcome.

**No-auto-create policy:** A valid GitHub identity that doesn't match any `operator_credentials.github_user_id` row is refused with `provider_not_enrolled` — the callback never creates an operator account.

---

### POST /api/auth/github/link

Authenticated endpoint — kicks off the GitHub OAuth flow in *link* mode. Returns JSON `{ url }` so the client can `window.location.href = url`. POST (not GET) so `requireSession` enforces the X-CSRF-Token check.

**Auth:** Required (session cookie + CSRF).

**Response:** `200 OK`
```json
{ "url": "https://github.com/login/oauth/authorize?..." }
```

**Errors:** 400 (provider disabled or not configured), 401, 429, 500.

---

### GET /api/auth/github/status

Lightweight status endpoint — tells the UI whether GitHub OAuth is enabled (admin toggle) and configured (credentials present), and, if the caller is signed in, whether their account has a GitHub link already.

**Auth:** Anonymous-safe; returns extra `linked` field when a session is present.

**Response:** `200 OK`
```json
{
  "enabled": false,
  "configured": false,
  "linked": null
}
```

When linked:
```json
{
  "enabled": true,
  "configured": true,
  "linked": { "username": "operator", "linkedAt": "2026-04-23T18:00:00Z" }
}
```

---

### DELETE /api/auth/github/unlink

Remove the current operator's GitHub link and clear `github` from `operators.auth_providers` CSV.

**Auth:** Required (session cookie + CSRF).

**Response:** `200 OK` with `{ "ok": true, "removed": <count> }`.

**Errors:** 401, 429.

**Audit:** Emits `github_unlinked` with the GitHub username(s).

---

### POST /api/auth/magic-link/begin

Issue an email-delivered one-shot sign-in link to the operator whose email matches the body. Always returns the same success message — callers can't enumerate which emails are registered. Added in v0.9.2.

**Auth:** Anonymous.

**Rate limit:** 3 requests / minute / IP (shared pattern with `forgot-password`).

**Request:**
```json
{ "email": "operator@example.com" }
```

**Response:** `200 OK` in all cases (no-enumeration contract)
```json
{ "message": "If an account with that email exists, a sign-in link has been sent." }
```

**Side effects when all gates are satisfied (admin-enabled + mail-configured + email matches an active operator):**
- Any outstanding unconsumed tokens for that operator are marked consumed.
- A fresh token is generated (32 bytes base64url, hashed with SHA-256 for storage).
- An email is queued via the configured mail provider (Resend / SMTP / Emailit) containing a `GET /api/auth/magic-link/complete?token=<raw>` URL.
- Token TTL defaults to 15 minutes (override with `MAGIC_LINK_EXPIRY_MINUTES` env, clamped 1-60).

**Errors:** Only `400` (missing email field) or `403` (RBAC disabled) are distinguishable. Every other failure mode — unknown email, Magic Link disabled by admin, no mail provider configured, internal error — collapses into the same `200 OK` success response.

---

### GET /api/auth/magic-link/complete

Validate and consume a Magic Link token. On success, issues a session cookie and 303-redirects to `/`. On any failure, 303-redirects to `/login?error=magic_link_invalid` — the single generic error code is intentional so a caller can't distinguish expired vs consumed vs unknown. Added in v0.9.2.

**Auth:** Anonymous (the token itself is the credential).

**Query parameters:**
- `token` — the raw base64url token delivered by email.

**Response:**
- `303 See Other` → `/` with `Set-Cookie: clawnex_session=...` on success.
- `303 See Other` → `/login?error=magic_link_invalid` on any failure.

**Atomic consume:** The validate+consume happens in a single `UPDATE ... WHERE consumed_at IS NULL AND expires_at > datetime('now')` statement, so two parallel clicks can't both create a session.

**Audit:** Emits `operator_login` with `provider=magic_link` in the description.

---

### GET /api/config/auth-methods

Admin-only endpoint for the Authentication Methods card. Returns the effective enable + credential state for each provider. Client secret is masked (`••••••••`) so the cleartext never re-leaks once stored.

**Auth:** Required (session cookie + `config:read` permission).

**Response:** `200 OK`
```json
{
  "passkey":   { "enabled": true,  "alwaysOn": true,  "note": "..." },
  "github":    { "enabled": false, "clientId": "", "clientSecret": "", "clientSecretSource": "none", "callbackUrl": "http://localhost:5001/..." },
  "magicLink": { "enabled": false, "configured": false, "available": false, "note": "..." },
  "local":     { "enabled": true,  "breakGlass": true, "note": "..." }
}
```

`clientSecretSource` is `"db"` | `"env"` | `"none"` — tells the UI where the current secret came from so the admin knows whether saving will override an env value.

---

### PUT /api/config/auth-methods

Admin-only endpoint to update provider settings. Partial updates supported — only fields present in the body are changed. Empty `clientSecret` string is treated as "no change" so the masked round-trip can't accidentally clobber a stored secret.

**Auth:** Required (session cookie + CSRF + `config:write` permission).

**Request body (all fields optional):**
```json
{
  "github": {
    "enabled": true,
    "clientId": "Iv1.xxxxxxxxxxxxxxxx",
    "clientSecret": "<github-oauth-client-secret>",
    "callbackUrl": "https://clawnex.example.com/api/auth/github/callback"
  }
}
```

**Response:** `200 OK`
```json
{ "ok": true, "changed": ["github.enabled", "github.clientId", "github.clientSecret", "github.callbackUrl"] }
```

**Errors:** 400 (invalid JSON), 401, 403 (missing `config:write`).

**Audit:** Emits `auth_methods_updated` with the list of changed fields (secret values themselves never logged).

---

### POST /api/config/auth-methods/test-magic-link

Admin diagnostic — sends a test-tagged magic-link email to the calling admin's own address using the same render + send code path as `/api/auth/magic-link/begin`. Unlike the public endpoint (which returns a generic success to prevent enumeration), this endpoint surfaces machine-readable failure codes so the admin can fix configuration without guessing. Added in v0.9.2.

**Auth:** Required (session cookie + CSRF + `config:write` permission). When RBAC is disabled, returns `400` with `code=rbac_disabled` (Magic Link is irrelevant in localhost-only mode).

**Request body:** None.

**Response:** `200 OK` in all cases — `ok` is `true` for success, `false` for diagnostic failure. `200 + ok:false` is intentional so the client can render the diagnostic message verbatim instead of unwrapping an HTTP error envelope.

```json
// Success
{ "ok": true, "sentTo": "admin@example.com", "message": "Test magic link sent to admin@example.com. Check your inbox — the link is valid for one use." }

// Failure
{ "ok": false, "code": "no_email", "message": "Your admin record has no email address on file. Set one in Operator Management." }
```

**Failure codes:**
- `rbac_disabled` — endpoint is RBAC-gated; no test sends in localhost mode.
- `no_session` / `operator_not_found` — session lost or admin row missing.
- `magic_link_disabled` — admin toggle is off in Authentication Methods.
- `mail_not_configured` — no Resend / SMTP / Emailit provider set up.
- `no_email` — calling admin has no email on file.
- `send_failed` — mail provider returned an error (full message in `message` field).

**Side effects on success:** identical to `/api/auth/magic-link/begin` — token issued, hashed, persisted, mailed. The link IS live and usable; the email body just carries a `[TEST]` tag in the subject + body so the admin knows it was a diagnostic send.

**Audit:** Emits `magic_link_test_sent` (success) or `magic_link_test_failed` with the failure code (failure).

---

## 16. Operator Management Endpoints

All operator management endpoints require a valid `clawnex_session` cookie. GET requires `operators:read`; POST/PATCH/DELETE require `operators:manage` (admin role only). Mutation endpoints also require the `X-CSRF-Token` header.

---

### GET /api/config/operators

List all operators. Password hashes are never included in the response.

**Requires:** `operators:read` permission

**Response (200):**
```json
{
  "operators": [
    {
      "id": "uuid",
      "username": "admin",
      "role": "admin",
      "display_name": "Admin User",
      "email": "admin@example.com",
      "is_active": true,
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```

---

### POST /api/config/operators

Create a new operator.

**Requires:** `operators:manage` permission

**Request:**
```json
{
  "username": "string (required)",
  "password": "string (required)",
  "role": "admin | security_manager | operator | viewer | auditor (required)",
  "display_name": "string (optional)",
  "email": "string (optional)"
}
```

**Response (201):**
```json
{
  "ok": true,
  "operator": {
    "id": "uuid",
    "username": "security_lead",
    "role": "security_manager"
  }
}
```

**Errors:**
- 400: `"Username already exists"`
- 400: `"Invalid role"` — valid values: `admin`, `security_manager`, `operator`, `viewer`, `auditor`
- 403: `"Insufficient permissions"`

---

### PATCH /api/config/operators/[id]

Update an existing operator.

**Request:**
```json
{
  "role": "string (optional)",
  "display_name": "string (optional)",
  "email": "string (optional)",
  "is_active": "boolean (optional)",
  "password": "string (optional)",
  "unlock": "boolean (optional)"
}
```

**Response (200):**
```json
{
  "ok": true,
  "operator": {
    "id": "uuid",
    "username": "security_lead",
    "role": "security_manager"
  }
}
```

**Notes:**
- Changing `password` revokes all of the operator's active sessions
- The last-admin invariant is enforced: demoting or deactivating the last admin returns an error

**Errors:**
- 400: `"Cannot demote the last admin"`
- 403: `"Insufficient permissions"`
- 404: `"Operator not found"`

---

### DELETE /api/config/operators/[id]

Remove an operator. Cascades: destroys all of the operator's active sessions.

**Response (200):**
```json
{ "ok": true }
```

**Notes:**
- Cannot delete yourself
- Cannot delete the last admin

**Errors:**
- 400: `"Cannot delete the last admin"`
- 400: `"Cannot delete yourself"`
- 403: `"Insufficient permissions"`
- 404: `"Operator not found"`

---

## 17. Trust Boundary Audit Endpoint

### GET /api/trust-audit

Run the trust boundary discovery engine. Returns a structured map of which agents can reach which services, what tools they carry, and what the blast radius is if any trust assumption is violated.

**Requires:** `shield:read` permission, or localhost caller (no auth required from 127.0.0.1)

**Query parameters:**
- `refresh=true` — forces a fresh discovery run. Without this flag, the endpoint returns the cached result (if still valid). Added in v0.6.2-alpha.

**Response shape (v0.6.2-alpha onward — wrapped):**
```json
{
  "report": {
    "summary": {
      "agents": 13,
      "servicesReachable": 4,
      "rulesEvaluated": 14,
      "riskScore": 62,
      "generatedAt": "ISO-8601"
    },
    "agents": [
      {
        "id": "agent-uuid",
        "name": "Main Agent",
        "tools": ["agent-browser", "bash", "read"],
        "reachableServices": ["openrouter", "lmstudio-fleet"],
        "blastRadius": "HIGH",
        "findings": [
          {
            "rule": "TB-07",
            "severity": "HIGH",
            "title": "Agent has shell access and external model routing",
            "detail": "Combination of bash tool + OpenRouter routing allows potential C2 exfiltration"
          }
        ]
      }
    ],
    "rules": [
      {
        "id": "TB-07",
        "title": "Shell + external routing",
        "category": "blast-radius",
        "severity": "HIGH"
      }
    ],
    "timestamp": "ISO-8601"
  },
  "meta": {
    "last_run": "ISO-8601",
    "duration_ms": 42,
    "cached": true
  }
}
```

**Notes:**
- 15-rule discovery engine evaluates agent tool inventory against service reachability
- As of v0.6.2-alpha, results are cached (700× hotspot fix). `meta.cached` indicates whether the response was served from cache. Use `?refresh=true` to bypass the cache and force a live evaluation.
- The previous flat shape (agents/rules/summary at top level) is no longer returned — consumers must read `report.*` and check `meta.*`.
- Audit-logged as `trust_audit_run`

---

## 18. Scheduled Reports Endpoints

### GET /api/reports/schedule

List all configured scheduled reports.

**Requires:** `config:read` permission

**Response (200):**
```json
{
  "schedules": [
    {
      "id": "uuid",
      "name": "Daily Threat Summary",
      "frequency": "daily",
      "time": "08:00",
      "recipients": ["ops@example.com"],
      "format": "email",
      "enabled": true,
      "last_run": "ISO-8601 | null",
      "next_run": "ISO-8601",
      "created_at": "ISO-8601"
    }
  ]
}
```

---

### POST /api/reports/schedule

Create a new scheduled report.

**Requires:** `config:write` permission

**Request:**
```json
{
  "name": "Weekly Shield Summary",
  "frequency": "weekly",
  "day": "monday",
  "time": "09:00",
  "recipients": ["security@example.com"],
  "format": "email",
  "report_type": "shield_summary | traffic_summary | alert_summary | full",
  "enabled": true
}
```

**Response (201):**
```json
{
  "ok": true,
  "schedule": {
    "id": "uuid",
    "name": "Weekly Shield Summary",
    "next_run": "ISO-8601"
  }
}
```

**Errors:**
- 400: `"Name is required"`
- 400: `"Invalid frequency"` — must be `daily`, `weekly`, or `monthly`
- 400: `"At least one recipient is required"`
- 403: `"Insufficient permissions"`

---

### PUT /api/reports/schedule

Update an existing scheduled report.

**Requires:** `config:write` permission

**Request:**
```json
{
  "id": "uuid",
  "name": "Updated Report Name",
  "enabled": false
}
```

**Response (200):**
```json
{ "ok": true, "schedule": { "id": "uuid", "name": "Updated Report Name", "enabled": false } }
```

---

### DELETE /api/reports/schedule

Delete a scheduled report.

**Requires:** `config:write` permission

**Query Parameters:**
- `id` — schedule UUID (required)

**Response (200):**
```json
{ "ok": true }
```

**Errors:**
- 404: `"Schedule not found"`
- 403: `"Insufficient permissions"`

---

## 19. Custom Correlation Rules Endpoints

### GET /api/correlations/rules

List all custom correlation rules.

**Requires:** `config:read` permission

**Response (200):**
```json
{
  "rules": [
    {
      "id": "uuid",
      "name": "Repeated jailbreak from same agent",
      "description": "Fires when the same agent triggers 3+ BLOCK verdicts within 10 minutes",
      "enabled": true,
      "conditions": {
        "operator": "AND",
        "conditions": [
          { "field": "shield_verdict", "op": "eq", "value": "BLOCK" },
          { "field": "agent_id", "op": "groupby" },
          { "field": "count", "op": "gte", "value": 3 },
          { "field": "window_minutes", "op": "eq", "value": 10 }
        ]
      },
      "action": "alert",
      "alert_severity": "HIGH",
      "created_at": "ISO-8601",
      "last_triggered": "ISO-8601 | null"
    }
  ]
}
```

---

### POST /api/correlations/rules

Create a new custom correlation rule.

**Requires:** `config:write` permission

**Request:**
```json
{
  "name": "High-score REVIEW spike",
  "description": "Optional description",
  "enabled": true,
  "conditions": {
    "operator": "AND",
    "conditions": [
      { "field": "shield_verdict", "op": "eq", "value": "REVIEW" },
      { "field": "shield_score", "op": "gte", "value": 40 },
      { "field": "count", "op": "gte", "value": 5 },
      { "field": "window_minutes", "op": "eq", "value": 5 }
    ]
  },
  "action": "alert",
  "alert_severity": "MEDIUM"
}
```

**Condition builder schema:**

| Field | Operators | Description |
|-------|-----------|-------------|
| `shield_verdict` | `eq` | ALLOW, REVIEW, or BLOCK |
| `shield_score` | `gte`, `lte`, `eq` | 0–100 |
| `agent_id` | `eq`, `groupby` | Agent UUID or groupby to evaluate per-agent |
| `model` | `eq`, `contains` | Model identifier |
| `source` | `eq` | litellm, session-watcher, break-glass |
| `count` | `gte`, `lte` | Number of matching events in the window |
| `window_minutes` | `eq` | Time window for count aggregation |

**Response (201):**
```json
{
  "ok": true,
  "rule": { "id": "uuid", "name": "High-score REVIEW spike" }
}
```

---

### POST /api/correlations/rules?evaluate=true

Evaluate a rule definition against live data without persisting it. Useful for testing rule logic before saving.

**Requires:** `alerts:manage` permission

**Request:** Same schema as POST /api/correlations/rules (no `id` field).

**Response (200):**
```json
{
  "matched": true,
  "matchCount": 7,
  "sampleEvents": [
    { "id": "uuid", "timestamp": "ISO-8601", "shield_verdict": "REVIEW", "shield_score": 45 }
  ],
  "evaluatedAt": "ISO-8601"
}
```

---

### PUT /api/correlations/rules

Update an existing custom correlation rule.

**Requires:** `config:write` permission

**Request:**
```json
{
  "id": "uuid",
  "name": "Updated rule name",
  "enabled": false
}
```

**Response (200):**
```json
{ "ok": true, "rule": { "id": "uuid", "name": "Updated rule name", "enabled": false } }
```

---

### DELETE /api/correlations/rules

Delete a custom correlation rule.

**Requires:** `config:write` permission

**Query Parameters:**
- `id` — rule UUID (required)

**Response (200):**
```json
{ "ok": true }
```

**Errors:**
- 404: `"Rule not found"`
- 403: `"Insufficient permissions"`

---

## 20. HTTPS / Caddy Endpoints

### GET /api/system/https

Get the current HTTPS/Caddy configuration and status.

**Requires:** `config:read` permission, or localhost caller

**Response (200):**
```json
{
  "enabled": true,
  "domain": "clawnex.example.com",
  "provider": "caddy",
  "status": "active | pending | error | disabled",
  "tlsMode": "auto | manual",
  "certExpiry": "ISO-8601 | null",
  "lastChecked": "ISO-8601"
}
```

---

### POST /api/system/https

Enable, disable, or reconfigure HTTPS via Caddy auto-TLS.

**Requires:** `system:manage` permission, or localhost caller

**Request (enable):**
```json
{
  "enabled": true,
  "domain": "clawnex.example.com",
  "tlsMode": "auto"
}
```

**Request (disable):**
```json
{
  "enabled": false
}
```

**Response (200):**
```json
{
  "ok": true,
  "status": "active",
  "domain": "clawnex.example.com",
  "message": "Caddy auto-TLS enabled. Certificate provisioning in progress."
}
```

**Errors:**
- 400: `"Domain is required when enabling HTTPS"`
- 400: `"Invalid domain format"`
- 403: `"Insufficient permissions"`
- 500: `"Caddy configuration failed"`

**Notes:**
- Caddy is the recommended HTTPS approach for v0.6.1+. See the Deployment Guide (section 5.3) for setup details.
- Audit-logged as `https_config_changed`

---

## 21. MCP Tools Reference

ClawNex exposes **10 tools** via the Model Context Protocol (MCP) at `http://127.0.0.1:5001/mcp`.

| Tool | Description | Permission |
|------|-------------|------------|
| `shield_scan` | Scan text through the Prompt Shield | `shield:read` |
| `get_alerts` | List current alerts with optional filters | `alerts:read` |
| `get_traffic` | Retrieve recent traffic logs | `traffic:read` |
| `get_fleet_status` | Fleet health and agent inventory | `fleet:read` |
| `get_audit_log` | Query the immutable audit trail | `audit:read` |
| `get_shield_stats` | Shield verdict and threat statistics | `shield:read` |
| `set_block_mode` | Toggle or set shield block mode | `config:write` |
| `create_alert` | Create a manual alert | `alerts:manage` |
| `get_cve_list` | List CVE records from the local database | `shield:read` |
| `run_trust_audit` | Execute the trust boundary discovery engine | `shield:read` |

**Authentication:** When RBAC is enabled, MCP requests require a valid `clawnex_session` cookie or API key. The MCP server binds to `127.0.0.1` and enforces CORS to `http://127.0.0.1:5001`.

---

## 22. HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (alert, event, schedule, rule, operator) |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (not authenticated) |
| 403 | Forbidden (insufficient permissions, CSRF mismatch) |
| 404 | Not found |
| 409 | Conflict (break-glass already active, username already exists) |
| 423 | Locked (account locked out by progressive lockout) |
| 429 | Rate limited (login attempts, break-glass cool-down, public API key quota) |
| 500 | Internal server error |
| 502 | Upstream error (LiteLLM unavailable, GitHub API failed) |
| 503 | Service unavailable (mail provider not configured) |

---

## 23. Error Code Catalog

Machine-readable error codes surfaced in JSON responses. Codes are stable across minor versions.

| Code | HTTP | Meaning | Typical Cause | Resolution |
|------|:----:|---------|---------------|------------|
| `missing_api_key` | 401 | No `X-ClawNex-Key` or `Authorization` header | Integration not configured | Set the header |
| `empty_api_key` | 401 | Header present but empty | Bad environment variable | Fix env var |
| `invalid_api_key` | 401 | Key not in database | Key never existed or typo | Regenerate key in dashboard |
| `revoked_api_key` | 403 | Key was revoked | Rotation happened | Use the new key |
| `insufficient_scope` | 403 | Key lacks required scope | Over-scoped restriction | Create a new key with the needed scope |
| `csrf_invalid` | 403 | CSRF token missing or mismatched | Client didn't include `X-CSRF-Token` | Fetch token from `/api/auth/csrf` |
| `insufficient_permissions` | 403 | Session role lacks the permission | Operator attempted admin action | Ask Admin to assign the role or perform action |
| `not_authenticated` | 401 | No valid session cookie | Not logged in or session expired | Log in via `/api/auth/login` |
| `account_locked` | 423 | Progressive lockout triggered | Too many failed logins | Wait for lockout to expire or ask Admin to unlock |
| `account_disabled` | 423 | 20+ failed logins, account disabled | Brute-force defense | Admin must re-enable |
| `invalid_credentials` | 401 | Username/password wrong | Typo or unknown user | Verify credentials |
| `rate_limit_exceeded` | 429 | API key quota exhausted | Burst traffic | Wait until `X-RateLimit-Reset` |
| `too_many_login_attempts` | 429 | 5 logins/minute/IP exceeded | Automation retrying | Implement backoff |
| `cool_down_active` | 429 | Break-glass cool-down not elapsed | Re-activation too soon | Wait 15 minutes after previous deactivation |
| `break_glass_active` | 409 | Break-glass already on | Duplicate activation call | Read status first |
| `break_glass_inactive` | 400 | Deactivate called with nothing active | Stale client state | Refresh status |
| `invalid_duration` | 400 | Duration not in {15, 30, 60, 120, 240} | Bad client input | Use a valid duration |
| `invalid_json` | 400 | Request body is not JSON | Wrong Content-Type or malformed body | Send valid JSON |
| `missing_field` | 400 | Required field missing | Incomplete payload | Add the field per schema |
| `unknown_rule_id` | 400 | Whitelist references unknown rule | Typo or stale rule ID | Check rule catalog |
| `limit_out_of_range` | 400 | `limit` exceeds maximum | Client asked for too many rows | Reduce `limit` |
| `last_admin` | 400 | Last admin cannot be demoted/deleted | Safety invariant | Create another admin first |
| `self_deletion_forbidden` | 400 | Operator tried to delete own account | Safety invariant | Have another admin delete |
| `mail_provider_disabled` | 503 | Mail endpoint called without provider | Mail not configured | Configure Resend or SMTP in Configuration |
| `upstream_unavailable` | 502 | LiteLLM/GitHub/provider unreachable | Service down or network blocked | Restart LiteLLM; check network |
| `timeout` | 502 | Upstream took too long (120s for chat) | Large prompt or slow provider | Reduce payload, increase timeout |
| `shield_block` | 400 | Prompt blocked by shield (OpenAI-compat) | Adversarial content | Review detections, adjust prompt or whitelist |
| `streaming_not_supported` | 400 | `stream: true` not yet supported | Client asked for streaming | Set `stream: false`; planned for v0.7.0 |

**See also:** `docs/19 §7` for public API error handling patterns including retry and backoff guidance.

---

## 24. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | ClawNex Engineering | Initial release |
| 1.1 | 2026-04-05 | ClawNex Engineering | v0.5.2-alpha: Added system management endpoints (archive/purge/uninstall/migrate), CVE endpoints (GET /api/cve, POST /api/cve/sync), updated rule count to 155, updated version to 0.5.0-alpha. |
| 1.2 | 2026-04-13 | ClawNex Engineering | v0.6.0: Added Auth endpoints (setup, login, logout, me, status, csrf, sessions), Operator Management endpoints (CRUD + session cascade), RBAC session cookie authentication, CSRF protection, progressive login lockout. |
| 1.3 | 2026-04-13 | ClawNex Engineering | v0.6.1: Added Mail Configuration endpoints (GET/PUT/POST /api/config/mail), forgot-password and reset-password auth endpoints. |
| 1.4 | 2026-04-22 | ClawNex Engineering | v0.6.1-alpha: Fixed operator role enum (5 roles: admin, security_manager, operator, viewer, auditor). Clarified GET /api/config/operators requires operators:read. Added Trust Boundary Audit (GET /api/trust-audit), Scheduled Reports (GET/POST/PUT/DELETE /api/reports/schedule), Custom Correlation Rules (GET/POST/PUT/DELETE /api/correlations/rules + ?evaluate=true), HTTPS/Caddy endpoints (GET/POST /api/system/https), MCP Tools Reference (10 tools). |
| 1.5 | 2026-04-22 | ClawNex Engineering | Enterprise review: Added §1.1 Authentication section covering session cookie, API key, localhost bypass, and CSRF token flow. Added §1.2 Pagination convention. Added §1.3 Rate limiting with 429 response shape for internal and public surfaces. Added §23 Error Code Catalog with 28 machine-readable codes mapped to HTTP status, cause, and resolution. Expanded §22 HTTP status codes to include 502/503. Added OpenAPI 3.1 future-spec note. Clarified route surface as 103 files (96 internal + 7 public v1). |
| 1.6 | 2026-04-22 | ClawNex Engineering | v0.6.2-alpha hardening pass: `/api/trust-audit` now returns the wrapped `{report, meta: {last_run, duration_ms, cached}}` shape and `?refresh=true` forces a fresh run; previous flat shape is no longer returned. Health version string bumped to `0.6.2-alpha`. API perf pass adds 4 indexes (documented in §22). MCP tool invocations are now audit-logged. See CHANGELOG §[0.6.2-alpha]. |
| 1.7 | 2026-04-24 | ClawNex Engineering | v0.9.0-alpha multi-auth: added §15A Multi-Auth Provider Endpoints — 11 new routes covering passkey ceremony (`/api/auth/passkey/{register,authenticate}/{begin,complete}`), passkey management (`GET /api/auth/passkeys`, `DELETE /api/auth/passkeys/:id`), GitHub OAuth (`/api/auth/github/{start,callback,link,status,unlink}`), and admin auth-methods config (`GET/PUT /api/config/auth-methods`). Updated §1.1 to list passkey + GitHub session-cookie sources. `/api/auth/github/link` is POST (CSRF-enforced via requireSession) — was briefly GET in dev. |
| 1.8 | 2026-04-25 | ClawNex Engineering | v0.9.2-alpha: documented Magic Link endpoints (`POST /api/auth/magic-link/begin`, `GET /api/auth/magic-link/complete`) with one-shot token semantics, 15-min TTL, and no-enumeration response contract. Added admin diagnostic endpoint `POST /api/config/auth-methods/test-magic-link` with verbose machine-readable failure codes (rbac_disabled, no_session, operator_not_found, magic_link_disabled, mail_not_configured, no_email, send_failed). All redirect Location headers + Set-Cookie Secure flags now anchor on `AUTH_EXPECTED_ORIGIN` (was leaking `localhost:5001` behind the Caddy proxy). |
| 1.9 | 2026-05-05 | ClawNex Engineering | v0.10.0-alpha + v0.11.x-alpha: added §10A Token Cost FinOps Endpoint (`GET /api/tokens` — full schema for new fields `rows`, `perSource`, `headline`, `signals`, `warnings`, `sourceStatus`; permission `traffic:read`; privacy guarantees: no `signal_context`, Hermes prompt-text never returned, OpenClaw token-reader AST grep). Added §10B Policy Framework Endpoints (`/api/policies/*`, `/api/policies/[id]/rules/*`, `/api/policies/[id]/test`; new permissions `policies:read`/`policies:write`/`policies:test`; vendor PATCH lockdown; cross-policy guard; type validation enums; 12 audit events emitted by this surface). Added `/api/alerts/[id]/evidence` (v0.11.1+; permission `audit:read`; forward + `fallback_nearest` correlation methods; ±60s heuristic window for legacy alerts). |

---

*This is a living document. Endpoints will be added as new features are implemented.*

---

*ClawNex by ClawNex maintainers — clawnexai.com*
