# ClawNex Data Dictionary

**Document ID:** CLAWNEX-DATA-001
**Version:** 1.12
**Classification:** Confidential
**Last Updated:** 2026-05-08
**Status:** Living Document

**See also:** `11-security-architecture.md`, `13-release-notes.md`, `break-glass-design.md`, `24-rbac-permissions-reference.md`.

---

## 1. Document Purpose

This document defines every database table, column, data type, constraint, index, and relationship in the ClawNex platform. It is the authoritative reference for database schema, intended for developers, DBAs, compliance auditors, procurement reviewers, and integration engineers.

**Database Engine:** SQLite 3.x via better-sqlite3 12.8.0
**File:** `sentinel.db` (configurable via `DATABASE_PATH`)
**Mode:** WAL (Write-Ahead Logging)
**Encoding:** UTF-8
**Integrity:** PRAGMA foreign_keys=ON; transactions used for multi-row writes.
**Backups:** `VACUUM INTO` snapshot via Archive Database UI. Chmod 0600 on backup artifacts.

---

## 1.1 Data Sensitivity Classification Model

Every column in this dictionary is classified against the following four-tier scheme. The scheme aligns with common enterprise data-governance vocabulary (None / Internal / Restricted / Sensitive).

| Tier | Definition | Examples | Handling |
|------|------------|----------|----------|
| **None** | Non-sensitive technical data with no identifying or business value | Primary-key UUIDs, internal timestamps, enum flags | No special handling |
| **Internal** | Operational data with modest sensitivity — leakage causes inconvenience, not harm | Model IDs, rule categories, panel names | Standard access controls |
| **Restricted** | Data that reveals operator behavior, infrastructure topology, or business posture | Operator usernames, agent IDs, session IDs, IP addresses, cost data | RBAC-gated, redacted in exports, masked in UI |
| **Sensitive** | Data that if exposed could enable impersonation, privilege escalation, data exfiltration, or regulatory harm | Password hashes, session token hashes, API keys, gateway tokens, raw prompt evidence, email addresses | Never exported in plaintext; stored as hashes or masked at rest; RBAC + audit log required |

PII presence is called out explicitly per column in Section 3. Columns carrying free-text user content (e.g., `proxy_traffic.prompt_hash`, `shield_scans.content_hash`) are hashes, not plaintext. The scanner never persists raw prompt bodies by default; `trust_audit_results.raw_evidence` is the sole column that may contain truncated raw snippets (capped at 1000 chars) and is classified Sensitive.

---

## 2. Table Summary

The current SQLite schema is grouped into four functional categories. Every row in the summary specifies growth characteristics and the highest sensitivity tier present in the table.

**Category key:**
- **OPS** — operational telemetry, high growth, retention-bounded
- **EVT** — event-driven records, medium growth
- **CFG** — configuration, static (UI-driven writes)
- **SEC** — security/identity, low growth, high sensitivity

| # | Table | Category | Purpose | Primary Key | Row Growth Characteristics | Retention | Max Sensitivity |
|---|-------|----------|---------|-------------|----------------------------|-----------|-----------------|
| 1 | proxy_traffic | OPS | LLM request/response logs with shield verdicts | id (UUID) | ~1 row per LLM request (high volume) | Configurable (default: 3d) | Restricted |
| 2 | shield_scans | OPS | Shield scan audit trail | id (UUID) | ~1 row per scanned message | Configurable (default: 3d) | Restricted |
| 3 | metric_snapshots | OPS | Time-series system metrics | id (AUTOINCREMENT) | ~1 row per metric per minute | Configurable (default: 3d) | Internal |
| 4 | correlation_events | EVT | Multi-event pattern matches | id (UUID) | ~1 row per correlation hit | Configurable (default: 3d) | Restricted |
| 5 | alerts | EVT | Security alerts | id (UUID) | ~1 row per distinct alert (5-min dedup window) | Configurable (default: 90d) | Restricted |
| 6 | incidents | EVT | Correlated multi-alert incidents | id (UUID) | ~1 row per incident (low) | Configurable (default: 90d) | Restricted |
| 7 | audit_log | SEC | Immutable action log | id (UUID) | ~1 row per mutating action (append-only) | Configurable (default: 365d, 0=unlimited) | Restricted |
| 8 | security_scans | OPS | Host Security Scanner results | id (UUID) | ~1 row per scanner run (low) | None (kept indefinitely) | Internal |
| 9 | security_check_results | OPS | Individual check outcomes | id (UUID) | ~N rows per scan (bounded by check count) | Cascade from security_scans | Internal |
| 10 | maintenance_items | OPS | Maintenance checklists | id (UUID) | Static; only changes on edit | None | Internal |
| 11 | access_lists | CFG | IP/domain access control lists | id (UUID) | Low (operator-managed) | None | Internal |
| 12 | config_providers | CFG | LLM provider configurations | id (TEXT) | Low (operator-managed) | None | Sensitive (api_key) |
| 13 | config_models | CFG | Model configurations per provider | id (composite) | Low-Medium (follows provider catalog) | Cascade from config_providers | Internal |
| 14 | config_gateways | CFG | OpenClaw gateway instances | id (UUID) | Low (operator-managed) | None | Sensitive (token) |
| 15 | hermes_instances | CFG | Hermes Agent connection configurations | id (TEXT) | Low (operator-managed) | None | Restricted |
| 15a | hermes_ingest_cursors | OPS | Durable Hermes watcher high-water marks | source_id (TEXT) | Low (one row per Hermes source) | None | Internal |
| 15b | hermes_events | EVT | Normalized Hermes message scan events | id (TEXT) | Medium (one row per scanned Hermes message) | Retention with operational DB | Restricted (content_hash only; no raw message text) |
| 16 | config_defaults | CFG | Key-value settings store | key (TEXT) | Static (bounded key set) | None | Sensitive (certain keys) |
| 17 | cve_records | EVT | CVE data synced from jgamblin/OpenClawCVEs | id (CVE-ID) | Low (governed by upstream sync) | None | None |
| 18 | operators | SEC | Operator accounts for RBAC | id (UUID) | Low (5-50 operators typical) | None (lifecycle-driven) | Sensitive (password_hash, email); auth_providers CSV (v0.9.0+) |
| 19 | operator_sessions | SEC | Active sessions for operators | id (UUID) | Low (≤5 per operator, ≤250 typical) | Cascade on logout / expiry / operator delete | Sensitive (token_hash) |
| 19a | operator_credentials | SEC | Multi-auth provider enrollments (passkey + github_link) | id (UUID) | Low (1-3 rows per operator typical) | Cascade on operator delete; self-revoke via Auth & Devices | Restricted (credential_id, github_user_id); v0.9.0+ |
| 19b | password_reset_tokens | SEC | One-shot hashed tokens for email-based password recovery | id (UUID) | Low (ephemeral; TTL 30m default) | Used tokens persist for audit; cascade on operator delete | Sensitive (token_hash); v0.6.1+ |
| 19c | magic_link_tokens | SEC | One-shot hashed tokens for email-based sign-in | id (UUID) | Low (ephemeral; TTL 15m default) | Consumed tokens persist for audit; cascade on operator delete | Sensitive (token_hash); v0.9.2+ |
| 20 | custom_correlation_rules | CFG | User-defined weighted correlation rules | id (UUID) | Low (operator-managed) | None | Internal |
| 21 | trust_audit_results | EVT | Trust boundary audit run results | id (UUID) | ~N findings per run (15 rules × agents) | Configurable (default: 90d) | Sensitive (raw_evidence) |
| 22 | scheduled_report_runs | EVT | Scheduled report execution log | id (UUID) | ~1 row per scheduled run (daily/weekly/monthly) | Configurable (default: 90d) | Restricted |

**Totals:** 24 tables (22 primary + `password_reset_tokens` ephemeral token store + `magic_link_tokens` ephemeral token store). No columns store raw prompt bodies or raw user chat content by default; the hash-only-at-rest invariant is enforced by application code in `src/lib/db/` and the LiteLLM logger callback. Token tables (`password_reset_tokens`, `magic_link_tokens`) store sha256 hashes only; raw tokens appear only in outbound email and never persist.

---

## 3. Table Definitions

### 3.1 proxy_traffic

**Purpose:** Every LLM request and response flowing through the platform, with shield scan results.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| timestamp | TEXT | NO | `datetime('now')` | ISO-8601 timestamp of the request |
| direction | TEXT | NO | — | Request phase: `inbound`, `complete`, `error` |
| model | TEXT | YES | NULL | Model identifier (e.g., `qwen/qwen3.5-35b-a3b`) |
| provider | TEXT | YES | NULL | Provider identifier (e.g., `lmstudio`, `anthropic`) |
| upstream_url | TEXT | YES | NULL | Full URL of the upstream model endpoint |
| prompt_hash | TEXT | YES | NULL | SHA-256 hash of prompt text (first 16 chars) |
| messages_count | INTEGER | YES | NULL | Number of messages in the request |
| input_tokens | INTEGER | YES | NULL | Prompt token count |
| output_tokens | INTEGER | YES | NULL | Response token count |
| total_tokens | INTEGER | YES | NULL | Total tokens (input + output) |
| cost_usd | REAL | YES | NULL | Estimated cost in USD |
| latency_ms | INTEGER | YES | NULL | Request latency in milliseconds |
| shield_verdict | TEXT | YES | NULL | Shield decision: `ALLOW`, `REVIEW`, `BLOCK`, `BYPASSED`, `ERROR` |
| shield_score | INTEGER | YES | NULL | Threat score (0–100) |
| shield_detections | TEXT | YES | NULL | JSON array of detection objects |
| blocked | INTEGER | NO | 0 | 1 if request was actively blocked, 0 otherwise |
| block_reason | TEXT | YES | NULL | Human-readable reason for blocking |
| session_id | TEXT | YES | NULL | OpenClaw session ID (if available) |
| status_code | INTEGER | YES | NULL | HTTP status code (200, 403, 502, etc.) |
| error | TEXT | YES | NULL | Error message (if request failed) |
| source | TEXT | YES | `'proxy'` | Traffic source: `litellm`, `session-watcher`, `break-glass`, `proxy` (legacy) |

**Indexes:**
- `idx_proxy_traffic_time` ON (timestamp)
- `idx_proxy_traffic_model` ON (model)
- `idx_proxy_traffic_verdict` ON (shield_verdict)
- `idx_proxy_traffic_source` ON (source)

**shield_detections JSON format:**
```json
[
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
]
```

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, timestamp, direction, status_code, blocked | None | Technical metadata |
| model, provider, messages_count, input_tokens, output_tokens, total_tokens, latency_ms | Internal | Operational |
| cost_usd | Restricted | Business-sensitive |
| upstream_url, shield_verdict, shield_score, shield_detections, block_reason, source | Restricted | Reveals infrastructure and threat posture |
| prompt_hash, session_id | Restricted | Hash, not plaintext; session ID pseudonymous |
| error | Restricted | May contain path fragments |

**Export format:** CSV/JSON via `/api/proxy/traffic/export` (operator-scope RBAC; Auditor role can export for evidence).

---

### 3.2 shield_scans

**Purpose:** Audit trail of every shield scan performed (via API or session watcher).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| direction | TEXT | NO | — | Scan direction: `inbound`, `outbound` |
| source_session_id | TEXT | YES | NULL | Associated session ID |
| source_agent_id | TEXT | YES | NULL | Associated agent ID |
| content_hash | TEXT | NO | — | SHA-256 hash of scanned content (first 16 chars) |
| layers_triggered | TEXT | YES | NULL | Comma-separated rule categories that triggered (e.g., `secrets,commands`) |
| threat_level | TEXT | NO | — | Verdict: `ALLOW`, `REVIEW`, `BLOCK` |
| detail | TEXT | YES | NULL | JSON with score, detection count, elapsed time, AND `origin` (v0.9.2+) |
| scanned_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

**Provenance (`detail.origin`, v0.9.2+):** every scan record carries an `origin`
key inside its `detail` JSON. Values: `production` (live LiteLLM proxy traffic),
`manual` (operator-initiated scan from the Prompt Shield panel), `shield-test`
(Shield Tests panel run-all), `demo` (Welcome Wizard demo data), `qa` (QA tooling),
`simulation` (v0.9.3+, dashboard-seeded fixture rows from
`scripts/dashboard-traffic-fixture.ts` or the `POST /api/dev/seed` endpoint --
ALWAYS excluded from production counters and from the test-included opt-in path).
Pre-Phase-2a records have no `origin` key and are treated as production by
the SQL helper `productionOriginSqlClause('detail')` in
`src/lib/dashboard/metric-semantics.ts`. Production-only counters
(`/api/shield/stats`, `/api/shield/history` default mode, header / sidebar /
Fleet active-alert badges) filter on this; Shield Tests panel and the
wizard's "Run first shield test" step opt in via `?includeTestGenerated=true`.
The `simulation` origin is a separate axis -- the Configuration -> Developer
Tools card and `/api/dev/*` endpoints are the only surfaces that ever read it.

**Index:** `idx_shield_scans_time` ON (scanned_at)

---

### 3.3 metric_snapshots

**Purpose:** Time-series system metrics (CPU, memory, disk) at 1-minute resolution.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| source | TEXT | NO | — | Metric source (e.g., `system`, `openclaw`) |
| metric_name | TEXT | NO | — | Metric name (e.g., `cpu_percent`, `memory_used_mb`) |
| metric_value | REAL | NO | — | Numeric value |
| metadata | TEXT | YES | NULL | JSON with additional context |
| recorded_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

**Indexes:**
- `idx_metrics_source_time` ON (source, recorded_at)
- `idx_metrics_name_time` ON (metric_name, recorded_at)

---

### 3.4 correlation_events

**Purpose:** Events generated when the correlation engine detects multi-event patterns.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| correlation_rule | TEXT | NO | — | Name of the correlation rule that matched |
| source_events | TEXT | NO | — | JSON array of source event references |
| description | TEXT | NO | — | Human-readable description of the correlation |
| severity | TEXT | NO | — | CRITICAL, HIGH, MEDIUM, LOW |
| alert_id | TEXT | YES | NULL | FK → alerts.id (if an alert was created) |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

---

### 3.5 alerts

**Purpose:** Security alerts with full lifecycle management.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| title | TEXT | NO | — | Alert title |
| description | TEXT | YES | NULL | Detailed description |
| severity | TEXT | NO | — | CRITICAL, HIGH, MEDIUM, LOW, INFO |
| source | TEXT | NO | — | Alert source: `shield`, `watchdog`, `break-glass`, `proxy`, `session-watcher`, `operator`, etc. |
| source_event_id | TEXT | YES | NULL | Reference to the triggering event |
| status | TEXT | NO | `'open'` | Lifecycle status (see below) |
| acknowledged_by | TEXT | YES | NULL | Who acknowledged the alert |
| resolved_at | TEXT | YES | NULL | ISO-8601 resolution timestamp |
| metadata | TEXT | YES | NULL | JSON with additional context (includes `origin` field; see Provenance below) |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 creation timestamp |
| updated_at | TEXT | NO | `datetime('now')` | ISO-8601 last update timestamp |

**Provenance (`metadata.origin`, v0.9.2+):** every alert created via
`createAlert()` carries an `origin` key in its `metadata` JSON. Same
taxonomy as `shield_scans.detail.origin`: `production`, `manual`,
`shield-test`, `demo`, `qa`, plus `simulation` (v0.9.3+). The Fleet
metric tile, the header pill, and the sidebar Alerts badge all filter
via `productionOriginSqlClause('metadata')` so a Shield Tests run -- or
a dashboard-seeded simulation -- doesn't pollute operator-facing badges
with synthetic noise. The Alert Summary card on Fleet Command also uses
this filter via `?scope=active` on `/api/alerts` (see section 5 of the
API reference for `effectiveScope` semantics). Dashboard-seeded
simulation rows additionally carry `metadata.simulation_run_id` (alerts)
or `detail.simulation_run_id` (shield_scans) so the Developer Tools card
can list and selectively reset individual runs.

**Mode B simulation rows (internal reviewer follow-up 2026-04-29):** the seedtraffic
fixture supports a `--visible-to-default-counters` mode where rows tag
`origin: 'production'` instead of `'simulation'` so default Fleet /
header / Shield counters include them. These rows STILL carry
`simulation: true` + `simulation_run_id` + `simulation_source` +
`simulation_visibility: 'default-counters'` so reset-all and per-run
reset (which scope by `simulation: true` flag, NOT by origin) catch
them precisely. Real production rows have no simulation tag and are
never matched by reset queries. Active-run enumeration in
`/api/dev/status` and `/api/dev/runs` uses the same `simulation: true`
predicate so Mode B runs are visible in the Developer Tools card and
the header ribbon.

**Status values:** `open`, `acknowledged`, `investigating`, `mitigated`, `resolved`, `false_positive`

**Indexes:**
- `idx_alerts_status` ON (status)
- `idx_alerts_severity` ON (severity)

**Deduplication:** Same `title` + `source` within 5 minutes → update existing alert instead of creating duplicate.

---

### 3.6 incidents

**Purpose:** Correlated multi-alert incidents for incident response.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| title | TEXT | NO | — | Incident title |
| description | TEXT | YES | NULL | Incident description |
| severity | TEXT | NO | — | CRITICAL, HIGH, MEDIUM, LOW |
| status | TEXT | NO | `'open'` | Lifecycle status |
| alert_ids | TEXT | YES | NULL | JSON array of associated alert IDs |
| timeline | TEXT | YES | NULL | JSON array of timeline events |
| root_cause | TEXT | YES | NULL | Root cause analysis |
| resolution | TEXT | YES | NULL | Resolution details |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |
| updated_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

---

### 3.7 audit_log

**Purpose:** Immutable action log for compliance. Append-only — no updates or deletes via application code.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| actor | TEXT | YES | NULL | Who performed the action (e.g., `operator`, `system`, `clawnex-proxy`) |
| action | TEXT | NO | — | Action type (see below) |
| resource_type | TEXT | YES | NULL | Resource category (e.g., `shield`, `proxy`, `break-glass`, `config`) |
| resource_id | TEXT | YES | NULL | Resource identifier |
| detail | TEXT | YES | NULL | Human-readable detail |
| source | TEXT | NO | — | Origin system (e.g., `sentinel`, `dashboard`, `api`) |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

**Action types:**
- `shield_scan_allow`, `shield_scan_review`, `shield_scan_block`
- `proxy_blocked`
- `proxy_block_mode_changed`
- `break_glass_activated`, `break_glass_deactivated`, `break_glass_expired`
- `shield_whitelist_updated`
- `retention_settings_updated`
- `config_change`
- `alert_created`, `alert_acknowledged`, `alert_resolved`
- `operator_created`, `operator_updated`, `operator_deactivated`, `operator_reactivated`, `operator_auto_disabled` (v0.6.1 — fires at the 20-failed-login threshold)
- `session_created`, `session_revoked`
- `trust_audit_run` — triggered when a trust boundary audit scan completes; `detail` includes rule counts and finding summary
- `report_scheduled` — triggered when a scheduled report is enabled, disabled, or its settings changed
- `correlation_rule_created`, `correlation_rule_updated`, `correlation_rule_deleted` — custom correlation rule lifecycle events
- `https_configured` — triggered when Caddy HTTPS settings are saved or the domain is changed
- `mcp:<tool>:invoked`, `mcp:<tool>:completed`, `mcp:<tool>:failed` — (v0.6.2+) emitted for every MCP tool invocation with actor, arguments (secrets redacted), and duration. `<tool>` is the tool name (e.g., `mcp:run_trust_audit:invoked`).
- `operator_role_changed` — (v0.6.2+) fires on role promotion/demotion. Distinct from `operator_updated` so RBAC drift is auditable without log parsing.
- `policy_create`, `policy_edit`, `policy_enable`, `policy_disable`, `policy_delete` — (v0.10.0+, policy framework) policy-level CUD lifecycle. `policy_disable` carries the operator-supplied reason in `detail`.
- `rule_create`, `rule_edit`, `rule_delete` — (v0.10.0+, policy framework) rule-level CUD on `policy_rules`. Vendor-source policies (`source ∈ {curated, system}`) reject mutation at the route layer with 403 — those branches do not write audit rows.
- `rule_iteration_capped` — (v0.10.0+, policy framework, server-side) the evaluator hit `ITERATION_CAP = 1000` matches on a single rule in a single scan. Safety signal, not a gate.
- `rule_auto_disabled` — (v0.10.0+, policy framework, server-side) 5 consecutive `rule_iteration_capped` events on the same rule trip the auto-disable. The rule is set to `enabled = 0` and a HIGH alert lands in Alerts & Incidents.
- `rule_match_suppressed` — (v0.10.0+, policy framework, server-side) a rule pattern matched but the detection was suppressed. **Discriminator:** `detail.suppression_kind ∈ {'exception', 'allow_action'}`. There is **no** separate `rule_exception_suppressed` event — the consolidated `rule_match_suppressed` event with the `suppression_kind` discriminator is the canonical surface; querying audit history for the suppression cases means filtering on `action = 'rule_match_suppressed'`.
- `policy_test` — (v0.10.0+, policy framework) `POST /api/policies/[id]/test` was called. `detail` carries `policy_id`, `name`, `matched_rule_count`, `suppressed_count`, and `verdict ∈ {matched, no_match}`.

**Immutability:** The application never issues UPDATE or DELETE against `audit_log` outside of retention pruning. Retention pruning itself logs a `retention_applied` entry summarizing how many rows were removed, from which tables, with the cutoff timestamp.

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, created_at, source | None / Internal | Technical metadata |
| actor | Restricted | Operator username — PII-adjacent |
| action, resource_type, resource_id | Internal | Enum + technical IDs |
| detail | Restricted | May contain operator-supplied free text (e.g., break-glass reason) |

**Export format:** CSV/JSON/PDF via `/api/audit/export` (Auditor and Admin roles).

**Index:** `idx_audit_time` ON (created_at)

---

### 3.8 security_scans

**Purpose:** Results from security scanner (Host Security Scanner) runs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| scanner | TEXT | NO | — | Scanner name (e.g., `clawkeeper`) |
| overall_grade | TEXT | YES | NULL | Letter grade (A–F) |
| overall_score | REAL | YES | NULL | Numeric score |
| total_checks | INTEGER | YES | NULL | Number of checks run |
| passed_checks | INTEGER | YES | NULL | Number passed |
| failed_checks | INTEGER | YES | NULL | Number failed |
| raw_output | TEXT | YES | NULL | Raw scanner output |
| parsed_results | TEXT | NO | — | JSON parsed results |
| scanned_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

---

### 3.9 security_check_results

**Purpose:** Individual check outcomes from security scans.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| scan_id | TEXT | NO | — | FK → security_scans.id |
| check_id | TEXT | NO | — | Check identifier |
| check_name | TEXT | NO | — | Human-readable check name |
| category | TEXT | NO | — | Check category |
| status | TEXT | NO | — | pass, fail, warn, skip |
| severity | TEXT | YES | NULL | Finding severity |
| detail | TEXT | YES | NULL | Finding detail |
| remediation | TEXT | YES | NULL | Suggested fix |
| sentinel_check_id | TEXT | YES | NULL | Internal check ID mapping |
| recorded_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

**Index:** `idx_check_results_scan` ON (scan_id)

---

### 3.10 maintenance_items

**Purpose:** Operational maintenance checklists.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| title | TEXT | NO | — | Maintenance task title |
| category | TEXT | NO | — | Task category |
| description | TEXT | YES | NULL | Task description |
| is_automated | INTEGER | NO | 0 | 1 if automated, 0 if manual |
| auto_check_source | TEXT | YES | NULL | Automation source |
| last_completed_at | TEXT | YES | NULL | ISO-8601 last completion |
| next_due_at | TEXT | YES | NULL | ISO-8601 next due date |
| status | TEXT | NO | `'pending'` | pending, completed, overdue |
| completed_by | TEXT | YES | NULL | Who completed it |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

---

### 3.11 access_lists

**Purpose:** IP and domain deny-list entries used by access-list controls.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| list_type | TEXT | NO | — | Currently `deny` |
| entry_type | TEXT | NO | — | `IP` or `DOMAIN` |
| value | TEXT | NO | — | The IP address or domain value |
| reason | TEXT | YES | NULL | Why this entry was added |
| added_by | TEXT | YES | NULL | Who added it |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

---

### 3.12 config_providers

**Purpose:** LLM provider endpoint configurations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (e.g., `lmstudio-fleet`) |
| name | TEXT | NO | — | Display name (e.g., `LM Studio Fleet`) |
| type | TEXT | NO | — | Provider type (e.g., `lmstudio`, `openrouter`, `openai`) |
| base_url | TEXT | NO | — | API base URL (e.g., `http://<lm-studio-fleet-ip>:1234/v1`) |
| api_key | TEXT | YES | `''` | API key or token |
| is_default | INTEGER | NO | 0 | 1 if this is the default provider |
| is_active | INTEGER | NO | 1 | 1 if active, 0 if disabled |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |
| updated_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

---

### 3.13 config_models

**Purpose:** Model configurations per provider.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (composite: provider_id + model_id) |
| provider_id | TEXT | NO | — | FK → config_providers.id |
| model_id | TEXT | NO | — | Model identifier (e.g., `qwen/qwen3.5-35b-a3b`) |
| name | TEXT | YES | NULL | Display name |
| is_default | INTEGER | NO | 0 | 1 if this is the default model |
| context_window | INTEGER | NO | 131072 | Maximum context window (tokens) |
| max_output | INTEGER | NO | 16384 | Maximum output tokens |
| supports_reasoning | INTEGER | NO | 0 | 1 if model supports reasoning/thinking |
| supports_vision | INTEGER | NO | 0 | 1 if model supports image input |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

**Indexes:**
- `idx_config_models_provider` ON (provider_id)
- `idx_config_models_default` ON (is_default)

---

### 3.14 config_gateways

**Purpose:** OpenClaw gateway instance configurations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| name | TEXT | NO | — | Display name |
| url | TEXT | NO | — | WebSocket URL (e.g., `ws://127.0.0.1:18789`) |
| token | TEXT | YES | `''` | Authentication token |
| client_name | TEXT | YES | `''` | Client identifier |
| is_active | INTEGER | NO | 1 | 1 if active |
| is_primary | INTEGER | NO | 0 | 1 if primary gateway |
| status | TEXT | YES | `'unknown'` | Connection status |
| last_connected_at | TEXT | YES | NULL | Last successful connection |
| last_error | TEXT | YES | NULL | Last connection error |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |
| updated_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp |

---

### 3.15 hermes_instances

**Purpose:** Manually configured Hermes Agent connections for multi-instance monitoring.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (e.g., `hermes-1681234567890`) |
| name | TEXT | NO | — | Display name (e.g., `Hermes Production`) |
| home_path | TEXT | NO | — | Absolute path to Hermes home directory (contains state.db) |
| is_active | INTEGER | NO | 1 | 1 if active, 0 if disabled |
| status | TEXT | NO | `'unknown'` | Connection status (`connected`, `error`, `unknown`) |
| last_checked_at | TEXT | YES | NULL | Last health check timestamp |
| last_error | TEXT | YES | NULL | Last error message |
| session_count | INTEGER | NO | 0 | Sessions detected in last check |
| created_at | TEXT | NO | `datetime('now')` | Creation timestamp |
| updated_at | TEXT | NO | `datetime('now')` | Last update timestamp |

---

### 3.15a hermes_ingest_cursors

**Purpose:** Durable high-water marks for Hermes Agent message ingestion. This lets the Hermes watcher resume cleanly after dashboard restarts instead of relying on an in-memory cursor.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| source_id | TEXT | NO | — | Stable cursor identifier derived from the Hermes home path (`hermes:home:<hash>`) |
| home_path | TEXT | NO | — | Hermes home directory being observed |
| last_message_id | INTEGER | NO | 0 | Highest Hermes `messages.id` processed by ClawNex |
| last_message_timestamp | TEXT | YES | NULL | Timestamp of the last processed Hermes message |
| last_ingested_at | TEXT | YES | NULL | When ClawNex last advanced this cursor |
| last_error | TEXT | YES | NULL | Last watcher error associated with this source |
| created_at | TEXT | NO | `datetime('now')` | Creation timestamp |
| updated_at | TEXT | NO | `datetime('now')` | Last update timestamp |

---

### 3.15b hermes_events

**Purpose:** Normalized Hermes Agent message scan events. Rows link Hermes message IDs to ClawNex shield verdicts and proxy traffic rows while storing only content hashes, not raw Hermes message content.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (`source_id:message_id`) |
| source_id | TEXT | NO | — | Stable event source identifier scoped to Hermes profile and channel (`hermes:profile:<profile>:channel:<channel>`) |
| message_id | INTEGER | NO | — | Hermes `messages.id` |
| session_id | TEXT | YES | NULL | Hermes session ID |
| role | TEXT | YES | NULL | Hermes role (`user`, `assistant`, etc.) |
| direction | TEXT | YES | NULL | ClawNex scan direction (`inbound` or `outbound`) |
| platform | TEXT | YES | NULL | Hermes session source/platform when present |
| model | TEXT | YES | NULL | Hermes model string when present |
| content_hash | TEXT | NO | — | Short SHA-256 content hash; raw message content is not stored |
| shield_verdict | TEXT | YES | NULL | ClawNex shield verdict |
| shield_score | INTEGER | YES | NULL | ClawNex shield score |
| detections_count | INTEGER | NO | 0 | Number of detections returned by the shield scan |
| traffic_id | TEXT | YES | NULL | Related `proxy_traffic.id` row |
| message_timestamp | TEXT | YES | NULL | Hermes message timestamp normalized to ISO-8601 when possible |
| observed_at | TEXT | NO | `datetime('now')` | When ClawNex observed/scanned the message |

---

### 3.16 config_defaults

**Purpose:** Key-value settings store for all platform configuration.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| key | TEXT | NO | — | Primary key — setting name |
| value | TEXT | NO | — | Setting value (string — JSON for complex values) |
| updated_at | TEXT | NO | `datetime('now')` | Last modified timestamp |

**Known keys:**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `proxy_block_mode` | string | `"off"` | Shield block mode: `"on"` or `"off"` |
| `shield_whitelist` | JSON array | `["COG-SOUL",...]` | Whitelisted rule IDs |
| `break_glass` | JSON object | `{"active":false}` | Break-glass state |
| `default_provider` | string | `"lmstudio-fleet"` | Default LLM provider ID |
| `default_model` | string | varies | Default model ID |
| `retention_traffic_days` | string (number) | `"3"` | Traffic log retention |
| `retention_metrics_days` | string (number) | `"3"` | Metrics retention |
| `retention_correlations_days` | string (number) | `"3"` | Correlation retention |
| `retention_alerts_days` | string (number) | `"90"` | Alert retention |
| `retention_audit_days` | string (number) | `"365"` | Audit trail retention (0 = unlimited) |
| `agent_ignore_patterns` | JSON array | `["Skill Installer"]` | Agent name prefixes to hide from dashboard |
| `ai_panel_default` | string | `"open"` | AI chat panel default state: `"open"` or `"closed"` |
| `openclaw_latest_version` | string | varies | Cached latest OpenClaw release version |
| `openclaw_latest_date` | string | varies | Cached latest OpenClaw release date |
| `openclaw_release_url` | string | varies | Cached latest OpenClaw release URL |
| `tooltips_enabled` | string (`"1"` / `"0"`) | `"1"` | Global toggle for the dashboard tooltip system (v0.5.4+). When `"0"` every `<Tooltip>` becomes a pass-through fragment with zero event listeners. Flipped via the TIPS button in the dashboard header. |
| `wizard_dismissed` | string (`"1"` / `"0"`) | `"0"` | Welcome Wizard completion flag. Set to `"1"` when the operator clicks the Get Started button on the Setup Complete screen. |
| `wizard_skip_*` | string (`"1"` / `"0"`) | — | Per-step skip flags (e.g., `wizard_skip_provider`, `wizard_skip_clawkeeper`, `wizard_skip_cve`, `wizard_skip_routing`, `wizard_skip_shield`, `wizard_skip_pricing`). Set when the operator uses the Skip button on a wizard step; cleared by Reset Wizard. |
| `display_name` | string | hostname | Operator-overridable client display name in Fleet Command / Instance Detail. Blank reverts to `os.hostname()`. |
| `scheduled_reports_daily_enabled` | string (`"1"` / `"0"`) | `"0"` | Enable daily scheduled report delivery (fires at 06:00 server time). |
| `scheduled_reports_weekly_enabled` | string (`"1"` / `"0"`) | `"0"` | Enable weekly scheduled report delivery (fires Monday 07:00). |
| `scheduled_reports_monthly_enabled` | string (`"1"` / `"0"`) | `"0"` | Enable monthly scheduled report delivery (fires 1st of month 08:00). |
| `scheduled_reports_recipient` | string | `""` | Default recipient email address for scheduled report delivery. |
| `caddy_enabled` | string (`"1"` / `"0"`) | `"0"` | Whether Caddy HTTPS integration is active. |
| `caddy_domain` | string | `""` | Domain name for Caddy auto-TLS certificate provisioning. |
| `caddy_status` | string | `"unknown"` | Last known Caddy service status: `running`, `stopped`, `not_installed`, `unknown`. |
| `trust_audit_last_run_id` | string | `""` | Run ID of the most recent trust boundary audit. Used to surface latest results on panel load. |
| `trust_audit_last_run_at` | string | `""` | ISO-8601 timestamp of the most recent trust audit run. |
| `trust_audit_last_report` | JSON blob | `""` | (v0.6.2+) Cached full Trust Boundary Audit report from the most recent run. Served by `/api/trust-audit` when no explicit re-run is requested. |
| `trust_audit_last_duration_ms` | string (integer) | `""` | (v0.6.2+) Wall-clock duration of the most recent trust audit run, in milliseconds. Surfaced in the UI freshness pill. |
| `trust_audit_last_summary` | string | `""` | (v0.6.2+) Compact metadata fallback (rule counts + pass/fail/warn totals) used when the full JSON report is unavailable. |
| `dev_tools_enabled` | string (`"1"` / `"0"`) | `"0"` | (v0.9.3+) DB-layer toggle for the Configuration -> System Management -> Developer Tools card and the `/api/dev/*` endpoints. Defaults to `"0"` so even on installs with `CLAWNEX_DEV_TOOLS_DISABLED` unset (i.e. dev/QA), the surface stays inert until an admin types the enable phrase in the dashboard. The env kill-switch (`CLAWNEX_DEV_TOOLS_DISABLED=1`) is checked first and is a hard 404 that hides the feature entirely; this DB key is only consulted when the env layer is permissive. |

---

### 3.17 cve_records

**Purpose:** CVE vulnerability records synced from the jgamblin/OpenClawCVEs GitHub repository, with CWE-to-shield rule category mapping.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (CVE ID, e.g., `CVE-2024-12345`) |
| description | TEXT | YES | NULL | CVE description |
| severity | TEXT | YES | NULL | CRITICAL, HIGH, MEDIUM, LOW |
| cvss_score | REAL | YES | NULL | CVSS numeric score |
| cwe_id | TEXT | YES | NULL | CWE identifier (e.g., `CWE-78`) |
| cwe_name | TEXT | YES | NULL | CWE name (e.g., `OS Command Injection`) |
| shield_category | TEXT | YES | NULL | Mapped shield rule category (e.g., `commands`, `secrets`) |
| affected_product | TEXT | YES | NULL | Affected product/component |
| published_at | TEXT | YES | NULL | ISO-8601 CVE publication date |
| synced_at | TEXT | NO | `datetime('now')` | ISO-8601 last sync timestamp |

**Index:** `idx_cve_records_severity` ON (severity)
**Index:** `idx_cve_records_cwe` ON (cwe_id)
**Index:** `idx_cve_records_shield_category` ON (shield_category)

**CWE-to-Shield mapping examples:**

| CWE ID | CWE Name | Shield Category |
|--------|----------|----------------|
| CWE-78 | OS Command Injection | commands |
| CWE-77 | Command Injection | commands |
| CWE-94 | Code Injection | commands |
| CWE-200 | Information Exposure | secrets |
| CWE-522 | Insufficiently Protected Credentials | secrets |
| CWE-79 | Cross-site Scripting | encoding |
| CWE-918 | Server-Side Request Forgery | c2 |

---

### 3.18 operators

**Purpose:** Operator accounts for RBAC authentication. Each operator has a role that determines their permission set across the platform.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| username | TEXT | NO | — | Unique login name (case-insensitive via COLLATE NOCASE) |
| display_name | TEXT | YES | NULL | Human-readable display name |
| email | TEXT | YES | NULL | Operator email address |
| password_hash | TEXT | NO | — | bcryptjs hash (12 rounds) |
| role | TEXT | NO | `'viewer'` | Permission role: `admin`, `security_manager`, `operator`, `viewer`, `auditor` |
| is_active | INTEGER | NO | 1 | 1=active, 0=deactivated (toggled by admin or auto-disabled at 20 failed logins) |
| last_login_at | TEXT | YES | NULL | ISO-8601 timestamp of last successful login |
| login_count | INTEGER | YES | 0 | Total successful logins |
| failed_login_count | INTEGER | YES | 0 | Consecutive failed login attempts |
| created_by | TEXT | YES | NULL | ID of the operator who created this account |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 creation timestamp |
| updated_at | TEXT | NO | `datetime('now')` | ISO-8601 last update timestamp |
| auth_providers | TEXT | NO | `'local'` | CSV of enrolled providers — `local`, `passkey`, `github`, `magic_link`. Added v0.9.0. |

**Constraints:**
- `username` is UNIQUE with COLLATE NOCASE (case-insensitive uniqueness)
- `role` is CHECK-constrained to the 5 built-in roles

**Progressive lockout policy (enforced by application):**
- 5 failed logins → 1-minute lockout
- 10 failed logins → 5-minute lockout
- 15 failed logins → 30-minute lockout
- 20 failed logins → account auto-disabled (is_active set to 0)

**Indexes:**
- `idx_operators_username` ON (username)
- `idx_operators_role` ON (role)

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, created_at, updated_at, is_active, login_count, failed_login_count | None / Internal | Technical metadata |
| username, display_name | Restricted | Operator identity — PII |
| email | Sensitive | Personally-identifying; used for password reset |
| password_hash | Sensitive | bcryptjs 12-round hash; never export, never log |
| role, last_login_at, created_by | Internal / Restricted | RBAC and audit context |

**Export format:** Username and role may be exported in audit reports; password_hash and email MUST be redacted in any export. The Admin-only operator management endpoint returns email but never password_hash.

---

### 3.19 operator_sessions

**Purpose:** Active sessions for authenticated operators. Raw session tokens are never stored; only their SHA-256 hashes are persisted.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| operator_id | TEXT | NO | — | FK → operators.id (ON DELETE CASCADE) |
| token_hash | TEXT | NO | — | SHA-256 hash of the session token (unique) |
| ip_address | TEXT | YES | NULL | Client IP address at session creation |
| user_agent | TEXT | YES | NULL | Client User-Agent string |
| expires_at | TEXT | NO | — | ISO-8601 session expiration timestamp |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 creation timestamp |
| last_used_at | TEXT | YES | NULL | ISO-8601 timestamp of last request using this session |

**Constraints:**
- `token_hash` is UNIQUE
- `operator_id` REFERENCES operators(id) ON DELETE CASCADE — deleting an operator automatically destroys all their sessions

**Session limits (enforced by application):**
- Maximum 5 concurrent sessions per operator
- Expired sessions cleaned up periodically
- `expires_at` checked on every authenticated request

**Indexes:**
- `idx_operator_sessions_operator` ON (operator_id)
- `idx_operator_sessions_token` ON (token_hash)
- `idx_operator_sessions_expires` ON (expires_at)

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, operator_id, created_at, expires_at, last_used_at | None / Internal | Session metadata |
| token_hash | Sensitive | SHA-256 hash of session token; never logged or exported |
| ip_address | Restricted | Client IP — may be PII in consumer contexts; retained for session-abuse investigation only |
| user_agent | Restricted | Client fingerprint |

**Revocation:** Raw tokens are never stored; logout deletes the row (instant revocation). `ON DELETE CASCADE` from `operators` means deleting an operator revokes all their sessions atomically.

---

### 3.19a operator_credentials (v0.9.0+)

**Purpose:** Per-operator enrolled credentials for the multi-auth providers shipped in v0.9.0. One row per credential. The `credential_type` discriminator selects which set of columns is meaningful for that row.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| operator_id | TEXT | NO | — | FK → operators.id (ON DELETE CASCADE) |
| credential_type | TEXT | NO | — | `'passkey'` or `'github_link'` (CHECK-constrained) |
| credential_id | TEXT | YES | NULL | **passkey only:** WebAuthn credential ID (base64url) |
| public_key | TEXT | YES | NULL | **passkey only:** base64url-encoded public key bytes |
| counter | INTEGER | YES | 0 | **passkey only:** WebAuthn signature counter — must monotonically increase |
| transports | TEXT | YES | NULL | **passkey only:** CSV of `internal,hybrid,usb,nfc,ble,smart-card,cable` |
| github_user_id | INTEGER | YES | NULL | **github_link only:** GitHub numeric user id (immutable per GitHub account) |
| github_username | TEXT | YES | NULL | **github_link only:** GitHub login at link time (display only — id is the trust anchor) |
| label | TEXT | YES | NULL | **passkey only:** operator-supplied display name (e.g. "MacBook fingerprint") |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 enrollment timestamp |
| last_used_at | TEXT | YES | NULL | ISO-8601 timestamp of last successful authentication |

**Constraints:**
- `credential_type` CHECK-constrained to `('passkey','github_link')`
- `operator_id` REFERENCES operators(id) ON DELETE CASCADE — deleting an operator removes all their credentials
- `github_user_id` is UNIQUE across all rows (a GitHub account can be linked to at most one operator)

**Indexes:**
- `idx_op_creds_operator` ON (operator_id)
- `idx_op_creds_passkey_id` ON (credential_id) WHERE credential_id IS NOT NULL
- `idx_op_creds_github_user` UNIQUE ON (github_user_id) WHERE github_user_id IS NOT NULL

**Counter regression defense (passkey):** WebAuthn requires the new counter value reported by the authenticator to be strictly greater than the stored value (or both zero). A counter that does not advance indicates a cloned authenticator and the verifier MUST refuse the assertion. This check is enforced inside `@simplewebauthn/server.verifyAuthenticationResponse` and the updated counter is persisted via `updatePasskeyCounter()` only on successful verification.

**No-auto-create policy (github_link):** Rows are inserted only via the authenticated link flow (`POST /api/auth/github/link` → callback). Sign-in via GitHub looks up the operator by `github_user_id`; if no row matches, the sign-in is refused with `provider_not_enrolled` and no operator account is created. Admin must pre-link before a GitHub account can sign in.

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, operator_id, credential_type, created_at, last_used_at | Internal | Lifecycle metadata |
| credential_id, transports, label | Restricted | Credential identifier and operator-supplied labelling |
| public_key, counter | Internal | WebAuthn public credential material — not secret, but never useful to export |
| github_user_id, github_username | Restricted | Third-party identifier — PII if the GitHub account is personal |

**Revocation:** Operator self-service via Auth & Devices card calls `DELETE /api/auth/passkeys/:id` (passkey) or `DELETE /api/auth/github/unlink` (github). Both delete the row immediately. Disabling a provider via the Authentication Methods admin card does NOT delete existing rows — operators self-revoke.

---

### 3.19b password_reset_tokens (v0.6.1+)

**Purpose:** Short-lived one-shot tokens for email-driven password recovery. The `forgot-password` flow stores a hashed token + expiry per request; `reset-password` validates and marks the token spent. Raw tokens live only in the email delivery path and never persist.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| operator_id | TEXT | NO | — | FK → operators.id (ON DELETE CASCADE) |
| token_hash | TEXT | NO | — | UNIQUE sha256 hex of the raw token |
| expires_at | TEXT | NO | — | ISO-8601 expiry (default 30 minutes from issue; `PASSWORD_RESET_EXPIRY_MINUTES` env override) |
| used | INTEGER | NO | 0 | 1 = consumed, 0 = still valid |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 issue timestamp |

**Indexes:**
- `idx_reset_tokens_hash` ON (token_hash)
- `idx_reset_tokens_operator` ON (operator_id)

**Security posture:** Raw tokens are 32 bytes hex-encoded (64 chars). Only the sha256 digest is stored. The `forgot-password` route always returns `200 OK` with the same "if an account with that email exists..." message regardless of whether the email matched (no enumeration). On consume, `used = 1` is set and every existing session for the operator is deleted (forced re-login).

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, operator_id, expires_at, used, created_at | Internal | Lifecycle metadata |
| token_hash | Sensitive | Hashed credential — raw value never persists |

---

### 3.19c magic_link_tokens (v0.9.2+)

**Purpose:** Short-lived one-shot email-delivered sign-in tokens. When the admin has Magic Link enabled AND a mail provider configured, `/api/auth/magic-link/begin` inserts one row per sign-in attempt; `/api/auth/magic-link/complete` validates and consumes the token via an atomic UPDATE gate. Mirrors `password_reset_tokens` but for sign-in instead of recovery.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| operator_id | TEXT | NO | — | FK → operators.id (ON DELETE CASCADE) |
| token_hash | TEXT | NO | — | UNIQUE sha256 hex of the raw token |
| issued_at | TEXT | NO | `datetime('now')` | ISO-8601 issue timestamp |
| expires_at | TEXT | NO | — | ISO-8601 expiry (default 15 minutes; `MAGIC_LINK_EXPIRY_MINUTES` env override, clamped 1-60) |
| consumed_at | TEXT | YES | NULL | ISO-8601 consume timestamp; `NULL` until the token is used or invalidated |
| ip | TEXT | YES | NULL | Client IP at issue time (audit only; not enforced on consume) |
| user_agent | TEXT | YES | NULL | Client User-Agent at issue time (audit only) |

**Indexes:**
- `idx_magic_link_tokens_hash` ON (token_hash)
- `idx_magic_link_tokens_operator` ON (operator_id)

**Atomic consume:** The consume step is a single `UPDATE magic_link_tokens SET consumed_at = datetime('now') WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > datetime('now')`. The driver's `changes()` return value gates success — exactly 1 matched row means the token was live and is now spent; any other value means invalid/expired/already-consumed. Two parallel clicks on the same link cannot both create sessions.

**Token shape:** 32 bytes from `crypto.randomBytes`, encoded base64url (43 URL-safe characters). Raw value is embedded in the email link and never persists; only the sha256 digest hits the database.

**Enumeration defenses:**
- The `begin` route returns the same `200 OK` "check your inbox" response regardless of whether the email matches an operator, whether Magic Link is admin-enabled, or whether a mail provider is configured.
- The `complete` route collapses every failure mode (unknown / expired / already-consumed) into a single `/login?error=magic_link_invalid` redirect. Callers cannot distinguish them.

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, operator_id, issued_at, expires_at, consumed_at | Internal | Lifecycle metadata |
| token_hash | Sensitive | Hashed credential — raw value never persists |
| ip | Restricted | Client identifier, PII under GDPR |
| user_agent | Internal | Client fingerprint |

**Revocation:** Tokens self-expire via `expires_at`. `invalidateOutstandingTokens(operatorId)` sets `consumed_at = datetime('now')` on every unconsumed token for an operator — called before issuing a new one so a spam-click doesn't leave multiple live tokens in flight (last one wins). `ON DELETE CASCADE` from `operators` means deleting an operator wipes all their pending magic-link rows.

---

### 3.20 custom_correlation_rules

**Purpose:** User-defined correlation rules with weighted conditions and threshold scoring. Rules are evaluated by the correlation engine against incoming events within a rolling time window.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| name | TEXT | NO | — | Rule name (unique) |
| description | TEXT | YES | NULL | Human-readable rule description |
| is_active | INTEGER | NO | 1 | 1=enabled, 0=disabled |
| threshold | REAL | NO | 0.7 | Weighted score threshold to fire (0.0–1.0) |
| time_window_seconds | INTEGER | NO | 3600 | Rolling evaluation window in seconds |
| conditions | TEXT | NO | — | JSON array of condition objects (each with field, operator, value, weight) |
| severity | TEXT | NO | `'MEDIUM'` | Alert severity when rule fires: CRITICAL, HIGH, MEDIUM, LOW |
| created_by | TEXT | YES | NULL | Operator username who created the rule |
| created_at | TEXT | NO | `datetime('now')` | ISO-8601 creation timestamp |
| updated_at | TEXT | NO | `datetime('now')` | ISO-8601 last update timestamp |

**conditions JSON format:**
```json
[
  {
    "field": "shield_verdict",
    "operator": "eq",
    "value": "BLOCK",
    "weight": 0.6
  },
  {
    "field": "shield_score",
    "operator": "gte",
    "value": 75,
    "weight": 0.4
  }
]
```

**Index:** `idx_custom_correlation_rules_active` ON (is_active)

---

### 3.21 trust_audit_results

**Purpose:** Results from Trust Boundary Audit runs. Each row represents a single rule finding from a single audit run.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| run_id | TEXT | NO | — | Groups all findings from a single audit run |
| rule_id | TEXT | NO | — | Trust boundary rule identifier (e.g., `TB-PROMPT-INJ-TOOL`) |
| rule_name | TEXT | NO | — | Human-readable rule name |
| category | TEXT | NO | — | Finding category (e.g., `prompt_injection`, `memory_poisoning`, `capability_escalation`) |
| severity | TEXT | NO | — | CRITICAL, HIGH, MEDIUM, LOW |
| status | TEXT | NO | — | `pass`, `fail`, `warn` |
| agent_id | TEXT | YES | NULL | Agent or session associated with the finding |
| surface | TEXT | YES | NULL | Attack surface identifier (e.g., `tool_response`, `memory_read`, `system_prompt`) |
| detail | TEXT | YES | NULL | Human-readable finding detail |
| remediation | TEXT | YES | NULL | Suggested remediation steps |
| raw_evidence | TEXT | YES | NULL | JSON snippet of the triggering content (truncated at 1000 chars) |
| audited_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp of the audit run |

**Indexes:**
- `idx_trust_audit_run` ON (run_id)
- `idx_trust_audit_rule` ON (rule_id)
- `idx_trust_audit_time` ON (audited_at)

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, run_id, audited_at | None | Technical metadata |
| rule_id, rule_name, category, severity, status, surface | Internal | Rule metadata |
| agent_id | Restricted | Agent identifier |
| detail, remediation | Restricted | May contain infrastructure references |
| raw_evidence | Sensitive | Truncated at 1000 chars; the only column that may carry raw content snippets — redact before export to third parties |

**Export format:** JSON via `/api/trust-audit/export`. Exports to external parties must scrub `raw_evidence` per enterprise evidence-handling policy.

---

### 3.22 scheduled_report_runs

**Purpose:** Execution log for scheduled report delivery. Records each run attempt with outcome and delivery status.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | — | Primary key (UUID) |
| schedule | TEXT | NO | — | Schedule type: `daily`, `weekly`, `monthly` |
| report_type | TEXT | NO | — | Report identifier (e.g., `RPT-001`, `RPT-011`) |
| status | TEXT | NO | — | `success`, `failed`, `skipped` |
| recipient_email | TEXT | YES | NULL | Delivery address |
| error | TEXT | YES | NULL | Error message if delivery failed |
| run_at | TEXT | NO | `datetime('now')` | ISO-8601 timestamp of the run |

**Index:** `idx_scheduled_report_runs_time` ON (run_at)

**PII / Sensitivity Classification:**

| Column | Tier | Notes |
|--------|------|-------|
| id, schedule, report_type, status, run_at | None / Internal | Delivery metadata |
| recipient_email | Sensitive | Destination email; masked in UI |
| error | Restricted | May reference SMTP infrastructure |

---

## 3.99 External State Files (non-DB)

ClawNex maintains a small number of state files outside `sentinel.db`
to track ownership of changes made to filesystem resources owned by
other components.

### 3.99a `~/.clawnex-routing-managed.json` — OpenClaw routing wire sidecar (v0.9.3+)

**Purpose:** Tracks ownership of edits ClawNex made to
`~/.openclaw/openclaw.json` so the wire/revert cycle is reliable.
Engine: `src/lib/services/openclaw-routing-wire.ts`.

**Why a sidecar (not JSON comments in `openclaw.json`):** OpenClaw uses
`JSON.parse` and would reject comments. Why outside `~/.openclaw/`:
the "leave OpenClaw alone" rule. Why outside the install dir: so it
survives clean redeploys.

**Schema (version 1):**
```json
{
  "version": 1,
  "managedAt": "ISO-8601",
  "clawnexVersion": "0.9.2",
  "openclawVersion": "2026.4.26",
  "providerId": "litellm",
  "paths": [
    {
      "path": ["models","providers","litellm"],
      "valueSha256": "<hex>",
      "operation": "set"
    },
    {
      "path": ["agents","defaults","model","primary"],
      "valueSha256": "<hex>",
      "operation": "set-if-missing"
    }
  ]
}
```

**Lifecycle:**
- Created when the operator clicks **Wire LiteLLM** (Configuration → OpenClaw Routing card, or the Welcome Wizard step 5 single-click flow).
- Removed when the operator clicks **Revert ClawNex Wire** AND the revert succeeds in cleaning all managed paths from `openclaw.json`.
- Permissions: `0600` — readable only by the owning operator.

**Sensitivity:** None / Internal — contains no secrets, only path
names + SHA-256 fingerprints + version metadata.

**Retention:** None (lifecycle is operator-driven; not subject to the
DB retention policy in section 7).

---

## 3.100 Policy Framework Tables (v0.10.0+)

The Configurable Rule & Policy Framework v1 adds two new SQLite tables backing the rule + policy authoring surface: enabled `source=system` and `source=custom` policy rules flow into the runtime scanner alongside the 163 built-in detections from `src/lib/shield/rules.ts`; `source=curated` mirrors are operator-visible audit data only in v1.

### 3.100a `policies`

**Purpose:** Named collections of detection rules (the policy unit). Includes vendor-managed mirrors (curated/system) and operator-authored custom policies.

**Columns** (authoritative against `src/lib/db/schema.ts`):

| Column | Type | NULL | Notes |
|---|---|---|---|
| `id` | TEXT (UUID) | NOT NULL | Primary key |
| `name` | TEXT | NOT NULL | Human-readable; `UNIQUE(name)` constraint on the table |
| `description` | TEXT | NULL | Optional |
| `enabled` | INTEGER (0/1) | NOT NULL DEFAULT 1 | 1 = wire-active (or audit-active for curated) |
| `source` | TEXT enum | NOT NULL | `CHECK(source IN ('curated','system','custom'))` |
| `lifecycle` | TEXT enum | NOT NULL DEFAULT `'starter'` | `CHECK(lifecycle IN ('draft','lab','starter','strict','custom'))` |
| `version` | TEXT | NULL | Free-form semver for vendor-shipped policies (e.g. `'1.0.0'` on `ClawNex Default` and `Generic Egress Starter`); operator-authored custom policies leave it `NULL` |
| `created_by` | TEXT | NULL | Operator id for custom policies; `NULL` for vendor-shipped rows |
| `created_at` | TEXT (ISO-8601) | NOT NULL DEFAULT `datetime('now')` | |
| `updated_at` | TEXT (ISO-8601) | NOT NULL DEFAULT `datetime('now')` | |

**Constraints:**
- `UNIQUE(name)` — policy names are global across sources, not per-source.
- Vendor-source rows (`source IN ('curated', 'system')`) accept PATCH only on `enabled` + a typed-phrase `confirm_phrase` + a free-text `reason` (enforced at the route layer). The expected phrase is server-defined (`disable clawnex default protection` for ClawNex Default; `disable generic egress starter` for Generic Egress Starter — the client fetches it from the API's 400 response, never hardcodes it). The `reason` is recorded in the `policy_disable` audit row's `detail` alongside `confirm_phrase_matched: true` but is NOT persisted as a column on this table; the typed phrase itself is never logged.
- DELETE returns 403 for any vendor-source row (custom only).

**Sensitivity:** Internal.

**Retention:** Permanent (configuration data, not subject to time-based pruning).

### 3.100b `policy_rules`

**Purpose:** Individual detection rules. Children of `policies` via `policy_id`.

**Columns** (authoritative against `src/lib/db/schema.ts`):

| Column | Type | NULL | Notes |
|---|---|---|---|
| `id` | TEXT (UUID) | NOT NULL | Primary key |
| `policy_id` | TEXT (UUID) | NOT NULL | `FOREIGN KEY(policy_id) REFERENCES policies(id) ON DELETE CASCADE` |
| `rule_key` | TEXT | NOT NULL | Stable identifier matching `^[A-Z][A-Z0-9_-]*$`; surfaces in detection records and audit logs. `UNIQUE(policy_id, rule_key)` per policy |
| `name` | TEXT | NOT NULL | Human-readable |
| `pattern` | TEXT | NOT NULL | Literal substring or regex source (depending on `is_regex`) |
| `flags` | TEXT | NOT NULL DEFAULT `''` | Regex flags as a string (e.g. `gi`); `normalizeRegexFlags` accepts only `g` / `i` / `m` / `s` / `u` with no duplicates (`y` sticky and `d` hasIndices are deliberately excluded in v1); `g` is force-added before store. Live source: `src/lib/shield/regex-flags.ts::SUPPORTED_FLAGS` |
| `is_regex` | INTEGER (0/1) | NOT NULL DEFAULT 0 | 0 = literal substring (default), 1 = regex (runs `safe-regex2` ReDoS gate at create time) |
| `direction` | TEXT enum | NOT NULL | `CHECK(direction IN ('inbound','outbound','both'))` |
| `severity` | TEXT enum | NOT NULL | `CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW'))` |
| `action` | TEXT enum | NOT NULL DEFAULT `'score'` | `CHECK(action IN ('score','allow','redact','review','block'))` |
| `exceptions` | TEXT | NOT NULL DEFAULT `''` | Newline-separated literal substrings; if any line appears in matched text the detection is suppressed and `rule_match_suppressed` is logged with `suppression_kind='exception'` |
| `lifecycle` | TEXT enum | NULL | `CHECK(lifecycle IS NULL OR lifecycle IN ('draft','lab','starter','strict','custom'))` — rule-level lifecycle override of the policy's lifecycle |
| `enabled` | INTEGER (0/1) | NOT NULL DEFAULT 1 | `enabled = 0` excludes from the wire scan path |
| `created_at` | TEXT (ISO-8601) | NOT NULL DEFAULT `datetime('now')` | |
| `updated_at` | TEXT (ISO-8601) | NOT NULL DEFAULT `datetime('now')` | |

> **Note:** earlier doc versions listed a `safety_exemption_reason` TEXT column. That field is **not** a database column — it is a required parameter to the `createReviewedSeedRule` helper in `src/lib/db/policy-store.ts` that is recorded only in a `seed_rule_safety_exempted` audit row when a `safe-regex2` false-positive seed rule is inserted. The persisted policy_rules row carries no such column.

**Constraints:**
- `UNIQUE(policy_id, rule_key)` — rule keys are unique within a policy, not globally.
- `is_regex` / `enabled` are strict booleans at the API layer (no integer-bypass like `enabled: 2`).
- Direction / severity / action / lifecycle enforced as enums at the API.
- Cross-policy guard: rule mutations require `rule.policy_id === policy.id` (path-id must match the rule's stored parent).
- POST / PATCH / DELETE return 403 for any rule whose parent is `source IN ('curated', 'system')`.

**Indexes (all five live in schema.ts):**
- `idx_policy_rules_policy_id` on `policy_rules(policy_id)` — high-frequency lookups in the evaluator
- `idx_policy_rules_direction` on `policy_rules(direction)` — used by `listEnabledRulesForScan(direction)`
- `idx_policy_rules_enabled` on `policy_rules(enabled)` — wire-time scan-rules filter
- `idx_policies_enabled` on `policies(enabled)` — wire-time scan-rules filter
- `idx_policies_source` on `policies(source)` — curated-vs-system-vs-custom partitioning

**Migration / seed semantics:** the policy framework uses a dual-key idempotency mechanism stored in `config_defaults`:

- `policy_framework_schema_version` — bumps when a column is added or a type changes (so a future ALTER TABLE migration knows whether to run).
- `policy_framework_seed_version` — bumps when content changes (so the seed routine knows whether to re-insert vendor-shipped rows). Currently `'2026-05-03-v1'`.

Running the same `(schema_version, seed_version)` pair twice is a no-op. The seed routine populates two policies on first boot via `src/lib/db/seed-policies.ts`:

- **`ClawNex Default`** — `source='curated'`, `lifecycle='starter'`. Mirrors all 163 built-in detections from `src/lib/shield/rules.ts` as wire-inert audit data. Inserted via `createCuratedMirrorRule` (compile-only check, skips the full ReDoS gate because curated rows never load into the wire scan path).
- **`Generic Egress Starter`** — `source='system'`, `lifecycle='starter'`. 12 enabled outbound rules (7 PII + 5 outbound-secret patterns) plus 2 held lab drafts (`JAIL-CREDENTIAL-EXTRACTION-REQUEST` and `OUT-GENERIC-API-KEY-SHAPE`) shipped with `enabled=0`. PII patterns flagged as `safe-regex2` false positives (`PHONE_US`, `CREDIT_CARD`, `IPV4`) go through `createReviewedSeedRule` with an inline justification; the rest go through the full `createRule` gate.

**Sensitivity:** Internal.

**Retention:** Permanent (configuration data, not subject to time-based pruning).

---

## 3.101 Token Cost FinOps Pipeline — Type Surface (v0.11.0+)

The FinOps pipeline does NOT add SQLite tables — it reads cost telemetry live from existing sources (OpenClaw JSONL, Hermes `~/.hermes/state.db`, Paperclip HTTP). The canonical row shape is a TypeScript type surface defined in `src/lib/types/cost-reporting.ts`.

### 3.101a `NormalizedRow` (TypeScript shape)

| Field | Type | Notes |
|---|---|---|
| `row_id` | string | Stable, deterministic, unique-across-sources |
| `source` | enum | `openclaw \| hermes \| paperclip` |
| `provider` | string \| null | |
| `model` | string \| null | |
| `agent` | string \| null | Hermes is null in v1 (its `source` is channel, not agent) |
| `session_id` | string \| null | Paperclip is null (finance-event grain has none) |
| `source_agent_id` | string \| null | Paperclip carries raw UUID here |
| `timestamp` | ISO-8601 | |
| `input_tokens` | int \| null | |
| `output_tokens` | int \| null | |
| `cache_read_tokens` | int \| null | |
| `cache_write_tokens` | int \| null | |
| `reasoning_tokens` | int \| null | |
| `tool_call_count` | int \| null | Deterministic only — null = unknown (no heuristic inference) |
| `currency` | ISO 4217 \| null | |
| `estimated_cost_usd` | number \| null | |
| `actual_cost_usd` | number \| null | v1 alpha: only $0 on source-native included markers |
| `recomputed_cost_usd` | number \| null | Orchestrator-owned; populated only when math + non-default rate match (zero-rate guard) |
| `cost_status` | enum | `actual \| estimated \| recomputed \| included \| token_only \| unknown` |
| `estimated_cost_source` | enum \| null | |
| `actual_cost_source` | enum \| null | |
| `recomputed_cost_source` | enum \| null | |
| `pricing_version` | string \| null | Snapshot tag for forensic traceability |
| `row_flags` | string[] | Per-row flags (e.g. `['unsupported_currency']`) |

### 3.101b `Signal` (TypeScript shape)

```
{
  kind: 'loop_risk' | 'velocity_spike' | 'context_bloat' | 'cache_drop' | 'cache_drop_risk' | 'simple_on_expensive',
  source: 'openclaw' | 'hermes' | 'paperclip',
  detail: string,
  count: number,
  affected_row_ids: string[]
}
```

### 3.101c `AdapterResult` (TypeScript shape)

```
{
  rows: NormalizedRow[],
  signal_context?: {
    systemPromptHashByRowId?: Record<string, string>,    // Hermes — system_prompt is hashed inside the adapter, never returned
    stopReasonByRowId?: Record<string, string>            // OpenClaw
  },
  warnings?: AdapterWarning[]
}
```

**Privacy invariant:** `signal_context` is **adapter-private**. The orchestrator strips it before returning a public `CostReport`. Verified by static grep on the route source AND a runtime test asserting `'signal_context' in /api/tokens response` is `false` AND `JSON.stringify(response)` does not contain the substring.

### 3.101d `GlossaryEntry` (TypeScript shape, in `src/components/dashboard/constants.ts`)

```
{
  term: string,
  category: string,
  definition: string,        // 1-3 sentences plain English
  appearsIn?: TabId[]        // optional cross-references
}
```

The `GLOSSARY` constant is `GlossaryEntry[]`. v0.11.0-alpha shipped with 62 entries across 10 categories.

---

## 3.102 Alert Evidence — `alert.metadata` and `audit_log.detail` extensions (v0.11.1+)

### 3.102a `alerts.metadata` JSON for `session-watcher` source

When `session-watcher` calls `createAlert`, the alert's `metadata` JSON now includes 11 fields used by the View Evidence backlink:

| Field | Type | Notes |
|---|---|---|
| `audit_event_id` | UUID | id of the triggering audit_log row (forward link) |
| `source_event_id` | UUID | id of the `proxy_traffic` row, when applicable |
| `session_id` | UUID | OpenClaw session id |
| `direction` | enum | `inbound` / `outbound` |
| `model` | string | Model id |
| `provider` | string | Provider id |
| `verdict` | enum | `BLOCK` / `REVIEW` / `ALLOW` |
| `score` | int | Threat score 0-100 |
| `detection_count` | int | Number of detections |
| `primary_rule_key` | string | rule_key of the highest-severity / first detection |
| `primary_rule_name` | string | Human-readable name of the primary rule |

Legacy alerts predating v0.11.1-alpha lack these fields; the `/api/alerts/[id]/evidence` endpoint falls back to parsing `Session: <uuid>` from `description` and using `correlation_method: 'fallback_nearest'`.

### 3.102b `audit_log.detail` JSON for `shield_review`/`shield_detected` actions

When `session-watcher` writes a `shield_review` or `shield_detected` audit row (`source='session-watcher'`), the `detail` JSON now structures shield evidence for the View Evidence consumer:

| Field | Type | Notes |
|---|---|---|
| `shield_detections` | array | Each entry: `{ rule_key, rule_name, severity, category, sample, confidence }` |
| `payload_excerpt` | string | The original payload, **passed through `redact()` at insert time** so the audit row never carries raw PII |
| `prompt_hash` | string | SHA-256 of the prompt for cross-event correlation |
| `proxy_traffic_id` | UUID \| null | id of the `proxy_traffic` row when the event came from the LiteLLM hot path |

**Privacy invariant:** `payload_excerpt` MUST be redacted before insert. Code review enforces this on `src/lib/services/session-watcher.ts` and `src/app/api/alerts/[id]/evidence/route.ts`.

---

## 3.103 Mission Control + Triage Graph — Type Surface (v0.12.0+ / v0.14.5)

Mission Control adds no SQLite tables — it consumes existing telemetry (alerts, audit_log, proxy_traffic, cve_records, trust_audit_results, FinOps signals, collector health). The canonical types are TypeScript surfaces.

### 3.103a `ActionVerb` (closed enum, 11 values)

Defined at `src/components/dashboard/panels/mission-control/types.ts` as `ACTION_VERBS` (`as const` array) and `ActionVerb` (typeof). Drives the Suggested-Action column on every Top Action Queue row.

```
"Open evidence", "Diagnose", "Review exposure", "Restrict capability",
"Contain agent", "Disable integration", "Rotate credential", "Update policy",
"Assign owner", "Suppress as accepted risk", "Escalate"
```

Banned synonyms: Inspect / Audit / Tighten / Constrain / Block / bare Investigate / bare Review / bare View / "Take action" / "Click here" / "Fix issue". Mapping rules in `~/.claude/projects/<openclaw-project-memory>/memory/reference_action_verb_taxonomy.md`. Verifier: `scripts/verify-action-verbs.ts` (72 assertions).

### 3.103b `SuggestedAction` (TypeScript shape)

```
{
  verb: ActionVerb,            // canonical 11-value enum
  target: string,              // short free-form (e.g. "session prompt history", "Exec/Write")
  detail?: string              // optional longer context, NOT rendered in queue row
}
```

Display formatter `formatSuggestedAction(action)` produces `"Verb · target"`. Long remediation prose belongs in the Triage Graph **Fix / Control** stage's `previewSummary`, not in this field.

### 3.103c `IncidentFamily` (closed enum, 4 values)

```
"alert" | "cost-signal" | "infrastructure" | "trust-audit"
```

Set by each `*ToRow` mapper on `ActionRow.family`. Drives queue Family filter dropdown + per-source stale markers + suppression keys. The 5 newer Phase 6 producer families (correlation / blast-radius / auth-rbac / update-cve / policy-warning) currently fold into the existing `alert` / `infrastructure` buckets at the row level — they get distinguished by `incidentType` sub-key and `rawSource.kind`.

### 3.103d Phase 5 Finding shapes

Per-resolver input contracts at `src/components/dashboard/triage/<family>-resolver.ts`:

`CorrelationFinding` (`correlation-resolver.ts:47`): `id`, `title`, `severity`, `correlatedSignalIds: string[]`, `correlatedSources: string[]`, `windowStartMs / windowEndMs` (ms epoch), `sharedSessionId?`, `evidence?: string[]`, `confidence?: 'high' | 'medium' | 'low'`.

`BlastRadiusFinding` (`blast-radius-resolver.ts:47`): `id`, `title`, `severity`, `rootSignalId`, `rootSignalKind`, `affectedSessionIds: string[]`, `vector: 'shared_credential' | 'shared_tool' | 'shared_policy' | 'shared_session_template' | 'unknown'`, `windowStartMs / windowEndMs`, `evidence?: string[]`.

`AuthRbacFinding` (`auth-rbac-resolver.ts:52`): `id`, `title`, `severity`, `kind: 'rbac_off' | 'overprovisioned_role' | 'missing_permission_check' | 'stale_session' | 'shared_admin_account'` (closed enum), `principal?` (user_id or role label), `resource?` (route or capability), `evidence?: string[]`.

`UpdateCveFinding` (`update-cve-resolver.ts:45`): `id`, `title`, `severity`, `packageName`, `currentVersion`, `fixedVersion?`, `cveIds: string[]`, `cveScore?`, `evidence?: string[]`. Phase 6 producer parses package from CVE title (`<Package> < <version>` pattern, trailing punctuation stripped — internal reviewer polish 2026-05-08).

`PolicyWarningFinding` (`policy-warning-resolver.ts:46`): `id`, `title`, `severity`, `ruleKey`, `scope: 'shield_rule' | 'policy_default' | 'config_drift'`, `suggestedChange?`, `recentFiringCount?`, `evidence?: string[]`.

### 3.103e Triage Graph types

At `src/components/dashboard/triage/types.ts`:

`TriageStageId` (closed enum, 5 values, ordered): `"evidence" | "sourceEvent" | "affectedObject" | "relatedActivity" | "fixControl"`. The constant `TRIAGE_STAGE_ORDER` exports the canonical sequence.

`TriageLinkState`: `"resolved" | "missing" | "restricted" | "stale" | "derived" | "loading"`.

`TriageArtifactKind`: `"evidence" | "source" | "rule" | "object" | "related" | "fix" | "custom"`.

`TriageIssueKind` (1 value per source family): `"alert" | "costSignal" | "correlation" | "trustAudit" | "blastRadius" | "infrastructure" | "authRbac" | "updateCve" | "policyWarning"` — 9 entries as of v0.14.5.

`TriageStage`: `{ id, title, eyebrow, state, summary, artifactIds: string[], reason? }`.

`TriageArtifact`: `{ id, stageId, label, shortLabel, kind, state, confidence?, previewTitle, previewSummary, previewFields: TriagePreviewField[], primaryAction?: TriageNavigationTarget, secondaryActions?, reason?, permission?, lastResolvedAt?, evidenceSnippet?: TriageEvidenceSnippet, evidenceTrail?: TriageEvidenceTrail }`.

`TriageEvidenceSnippet` (alert resolver only, default-collapsed via "Show match span"): `{ before?, match, after?, ruleKey? }`.

`TriageEvidenceTrail` (trust-audit resolver only, default-collapsed via "Show evidence trail"): `{ items: string[] }`.

`TriageGraph` (top-level shape returned by every resolver): `{ issue: TriageIssueSummary, stages: TriageStage[], artifacts: TriageArtifact[], defaultArtifactId?, generatedAt: string, resolverVersion: string }`. Resolver versions stamped per family: `correlation-resolver-v1`, `blast-radius-resolver-v1`, `auth-rbac-resolver-v1`, `update-cve-resolver-v1`, `policy-warning-resolver-v1` (plus the 4 v0.13 resolvers: `alert-resolver-v1`, `cost-signal-resolver-v1`, `collector-health-resolver-v1`, `trust-audit-resolver-v1`).

### 3.103f Glass / theme tokens (v0.14.5)

At `src/components/dashboard/constants.ts`:

| Token | Purpose | Dark value | Light value |
|---|---|---|---|
| `glassPanelNested` | Nested tile gradient stop 1 (lighter) | `rgba(24, 48, 78, 0.92)` | `rgba(255, 255, 255, 1.0)` |
| `glassPanelNested2` | Nested tile gradient stop 2 | `rgba(16, 36, 60, 0.92)` | `rgba(252, 254, 255, 1.0)` |
| `glassBorderCyanStrong` | Nested-tile border (stronger than `glassBorderCyan`) | `rgba(85, 188, 255, 0.42)` | `rgba(8, 145, 178, 0.45)` |

Used by the lifted `Stat` component in `shared.tsx` (every numbered stat tile across the dashboard reads as an elevated panel as of v0.14.5). Card / CollapsibleCard accept an optional `dimGlow?: boolean` prop to dampen the cyan radial halo + accent border-glow on full-width cards that read brighter than peers.

---

## 4. Indexes

| Index Name | Table | Columns | Purpose |
|-----------|-------|---------|---------|
| idx_proxy_traffic_time | proxy_traffic | timestamp | Time-range queries |
| idx_proxy_traffic_model | proxy_traffic | model | Model filter queries |
| idx_proxy_traffic_verdict | proxy_traffic | shield_verdict | Verdict filter queries |
| idx_proxy_traffic_source | proxy_traffic | source | Source filter queries |
| idx_alerts_status | alerts | status | Alert dashboard filters |
| idx_alerts_severity | alerts | severity | Severity filter queries |
| idx_shield_scans_time | shield_scans | scanned_at | Scan history queries |
| idx_audit_time | audit_log | created_at | Audit trail retrieval |
| idx_check_results_scan | security_check_results | scan_id | Scan detail lookup |
| idx_config_models_provider | config_models | provider_id | Models per provider |
| idx_config_models_default | config_models | is_default | Default model lookup |
| idx_metrics_source_time | metric_snapshots | source, recorded_at | Metrics by source |
| idx_metrics_name_time | metric_snapshots | metric_name, recorded_at | Metrics by name |
| idx_cve_records_severity | cve_records | severity | CVE severity filter |
| idx_cve_records_cwe | cve_records | cwe_id | CWE lookup |
| idx_cve_records_shield_category | cve_records | shield_category | Shield category correlation |
| idx_operators_username | operators | username | Username lookup |
| idx_operators_role | operators | role | Role filter queries |
| idx_operator_sessions_operator | operator_sessions | operator_id | Sessions per operator |
| idx_operator_sessions_token | operator_sessions | token_hash | Token lookup on auth |
| idx_operator_sessions_expires | operator_sessions | expires_at | Expired session cleanup |
| idx_custom_correlation_rules_active | custom_correlation_rules | is_active | Active rules lookup |
| idx_trust_audit_run | trust_audit_results | run_id | Findings per run |
| idx_trust_audit_rule | trust_audit_results | rule_id | Rule hit history |
| idx_trust_audit_time | trust_audit_results | audited_at | Time-range audit queries |
| idx_scheduled_report_runs_time | scheduled_report_runs | run_at | Report run history |
| idx_audit_action_time | audit_log | action, created_at | (v0.6.2+) Action-scoped audit queries (e.g., `WHERE action LIKE 'mcp:%'`) |
| idx_correlation_events_created | correlation_events | created_at | (v0.6.2+) Recent correlations lookup |
| idx_correlation_events_rule_time | correlation_events | correlation_rule, created_at | (v0.6.2+) Per-rule correlation history |
| idx_alerts_created_at | alerts | created_at | (v0.6.2+) Recent alerts panel load |
| idx_proxy_traffic_latency | proxy_traffic | latency_ms | (v0.6.2+) Latency outlier analysis for Traffic Monitor |

---

## 5. Foreign Key Relationships

```
config_models.provider_id → config_providers.id (ON DELETE CASCADE)
security_check_results.scan_id → security_scans.id
correlation_events.alert_id → alerts.id
operator_sessions.operator_id → operators.id (ON DELETE CASCADE)
operator_credentials.operator_id → operators.id (ON DELETE CASCADE)
password_reset_tokens.operator_id → operators.id (ON DELETE CASCADE)
magic_link_tokens.operator_id → operators.id (ON DELETE CASCADE)
```

---

## 6. Migrations

Schema migrations are applied on startup. Each migration is idempotent — duplicate-column errors are silently ignored so that re-runs against a fully-migrated database are safe.

| # | Applied In | DDL Summary | Purpose | Idempotent |
|---|------------|-------------|---------|------------|
| 1 | v0.4.3 | `ALTER TABLE proxy_traffic ADD COLUMN source TEXT DEFAULT 'proxy'` | Source tracking for multi-path traffic | Yes |
| 2 | v0.5.0 | `CREATE TABLE cve_records (...)` + 3 indexes | CVE inventory with CWE→shield category mapping | Yes |
| 3 | v0.5.4 | `CREATE TABLE hermes_instances (...)` | Manual Hermes Agent instance management | Yes |
| 4 | v0.6.0 | `CREATE TABLE operators (...)` + 2 indexes | Operator identity for RBAC | Yes |
| 5 | v0.6.0 | `CREATE TABLE operator_sessions (...)` + 3 indexes, FK ON DELETE CASCADE to operators | Session auth storage | Yes |
| 6 | v0.6.1 | `CREATE TABLE custom_correlation_rules (...)` + 1 index | User-defined weighted correlation rules | Yes |
| 7 | v0.6.1 | `CREATE TABLE trust_audit_results (...)` + 3 indexes | Trust Boundary Audit 14-rule findings store | Yes |
| 8 | v0.6.1 | `CREATE TABLE scheduled_report_runs (...)` + 1 index | Scheduled report delivery log | Yes |
| 9 | v0.6.1 | New `config_defaults` keys: `scheduled_reports_*`, `caddy_*`, `trust_audit_*` | Feature-flag + state for Caddy, scheduled reports, trust audit | Yes (INSERT OR IGNORE) |
| 10 | v0.6.1 | New `audit_log.action` enum entries (see §3.7) | Operator lifecycle, trust audit, scheduled report, correlation rule, HTTPS audit trails | Yes (enum is application-validated) |
| 11 | v0.6.1+ | `CREATE TABLE password_reset_tokens (...)` + 2 indexes, FK ON DELETE CASCADE to operators | Hashed one-shot tokens for email-based password recovery | Yes |
| 12 | v0.9.0 | `ALTER TABLE operators ADD COLUMN auth_providers TEXT NOT NULL DEFAULT 'local'` | Multi-auth provider enrollment CSV per operator | Yes (IF NOT EXISTS absorbs re-runs) |
| 13 | v0.9.0 | `CREATE TABLE operator_credentials (...)` + 3 indexes (one unique partial) | Passkey + github_link credential store | Yes |
| 14 | v0.9.1 | `DROP INDEX idx_op_creds_passkey_id` + `CREATE UNIQUE INDEX idx_op_creds_passkey_id ...` | Adversarial review #A1 — passkey credential_id must be globally UNIQUE | Yes (IF EXISTS / IF NOT EXISTS guards) |
| 15 | v0.9.2 | `CREATE TABLE magic_link_tokens (...)` + 2 indexes, FK ON DELETE CASCADE to operators | Hashed one-shot tokens for email-based sign-in | Yes |

**Migration safety:** All schema migrations run within a single transaction per migration. Failures roll back the entire migration. The application refuses to serve traffic until migrations complete successfully.

---

## 7. Data Lifecycle & Retention Policy Matrix

The retention subsystem runs on startup and hourly (piggybacked on the health endpoint). Pruning executes inside a transaction and is logged to `audit_log` as a `retention_applied` entry.

```
Data Created → Stored in SQLite → Retained per policy → Pruned by retention module

Retention enforcement:
  - Trigger: Startup + hourly (via health endpoint)
  - Method: DELETE WHERE time_column < cutoff (in transaction)
  - Settings: Read from config_defaults on each cycle
  - Value 0 = unlimited (table skipped)
```

**Retention policy matrix (enterprise reference):**

| Table | Default Retention | Config Key | Minimum | Maximum | Purge Mechanism | Compliance Reference |
|-------|-------------------|------------|---------|---------|------------------|----------------------|
| proxy_traffic | 3 days | `retention_traffic_days` | 1 | 90 | Hourly DELETE WHERE timestamp < cutoff | Default aligned with low-PII traffic logs |
| shield_scans | 3 days | `retention_traffic_days` | 1 | 90 | Hourly DELETE WHERE scanned_at < cutoff | Co-governed with proxy_traffic |
| metric_snapshots | 3 days | `retention_metrics_days` | 1 | 90 | Hourly DELETE WHERE recorded_at < cutoff | Operational metrics, short by design |
| correlation_events | 3 days | `retention_correlations_days` | 1 | 90 | Hourly DELETE WHERE created_at < cutoff | Telemetry — bounded |
| alerts | 90 days | `retention_alerts_days` | 30 | 365 | Hourly DELETE WHERE created_at < cutoff | Incident tracking, quarterly-window retention |
| incidents | 90 days | `retention_alerts_days` | 30 | 365 | Same as alerts | Linked to alerts via alert_ids |
| audit_log | 365 days | `retention_audit_days` | 90 | 0 (unlimited) | Hourly DELETE WHERE created_at < cutoff; 0 disables pruning | SOC 2 Common Criteria CC6–CC7; ISO 27001 A.12.4 |
| trust_audit_results | 90 days | `retention_alerts_days` (shared) | 30 | 365 | Hourly DELETE WHERE audited_at < cutoff | Evidence retention |
| scheduled_report_runs | 90 days | `retention_alerts_days` (shared) | 30 | 365 | Hourly DELETE WHERE run_at < cutoff | Delivery evidence |
| security_scans | Indefinite | — | — | — | No automatic purge | Kept for posture trend analysis |
| security_check_results | Cascade | — | — | — | Deleted with parent scan (application-managed) | N/A |
| maintenance_items | Indefinite | — | — | — | No automatic purge | Operational checklist |
| access_lists | Indefinite | — | — | — | Operator-managed | Configuration |
| config_providers | Indefinite | — | — | — | Operator-managed | Configuration |
| config_models | Indefinite | — | — | — | Operator-managed | Configuration |
| config_gateways | Indefinite | — | — | — | Operator-managed | Configuration |
| hermes_instances | Indefinite | — | — | — | Operator-managed | Configuration |
| config_defaults | Indefinite | — | — | — | Operator-managed | Configuration |
| cve_records | Indefinite | — | — | — | Re-synced from upstream | CVE record is itself the authoritative reference |
| operators | Lifecycle | — | — | — | Deleted by admin action only | Identity records |
| operator_sessions | ≤ TTL | — | — | — | Expired cleanup piggybacks on health; hard cascade on operator delete | Session management |
| custom_correlation_rules | Lifecycle | — | — | — | Operator-managed | Configuration |

**Setting retention to `0`:** Supported only for `retention_audit_days` and indicates "retain indefinitely" — the pruner skips the `audit_log` table entirely. Changing the audit retention value creates a `retention_settings_updated` audit entry.

**Retention audit trail:** Every retention change is logged with the old and new values. Compliance reviewers can reconstruct the exact retention policy in force at any historical point.

---

## 7.1 Entity Relationship Diagram (Textual)

Foreign key and logical relationships across the current SQLite schema:

```
                    ┌──────────────────────────────────┐
                    │            IDENTITY              │
                    └──────────────────────────────────┘
                    operators (1) ──CASCADE──▶ operator_sessions (N)
                        │
                        │ actor (logical link, not FK)
                        ▼
                    audit_log (N)
                        ▲
                        │ (every mutation writes here)
                        │
         ┌──────────────┴──────────────┐
         │                             │
    CONFIGURATION                  OPERATIONAL
         │                             │
    config_providers (1)          proxy_traffic (N) ────────────┐
         │ CASCADE                                              │
         ▼                        shield_scans (N) ──────────┐  │
    config_models (N)                                        │  │
                                  metric_snapshots (N)       │  │
    config_gateways                                          │  │
    hermes_instances              correlation_events (N) ────┼──┼──▶ alerts (N) ◀── incidents (N)
    access_lists                        │                    │  │         ▲
    config_defaults                     │ alert_id (FK)      │  │         │
    custom_correlation_rules ───────────┘                    │  │  (operator-managed
                                                             │  │   lifecycle)
                                                             │  │
                                  security_scans (1) ────┐   │  │
                                      │ scan_id           │   │  │
                                      ▼                   │   │  │
                                  security_check_results  │   │  │
                                                          │   │  │
                                  trust_audit_results ◀───┼───┘  │
                                  (grouped by run_id)     │      │
                                                          │      │
                                  scheduled_report_runs ◀─┘      │
                                                                 │
                                  maintenance_items               │
                                  cve_records ──(logical link)──▶ │
                                  (CWE → shield_category)         │
```

**Formal foreign keys (enforced via PRAGMA foreign_keys=ON):**
- `config_models.provider_id` → `config_providers.id` ON DELETE CASCADE
- `security_check_results.scan_id` → `security_scans.id`
- `correlation_events.alert_id` → `alerts.id`
- `operator_sessions.operator_id` → `operators.id` ON DELETE CASCADE

**Logical relationships (not FK-enforced, used for joins in application code):**
- `audit_log.actor` → `operators.username` (pseudonymous link; deleting an operator deliberately leaves their historical audit entries intact)
- `alerts.source_event_id` → `proxy_traffic.id` / `shield_scans.id` / `correlation_events.id` (polymorphic; discriminated by `source`)
- `incidents.alert_ids` (JSON) → `alerts.id` array
- `cve_records.shield_category` → shield rule taxonomy (in code, not DB)
- `trust_audit_results.agent_id` → agent identifier (no agent table — agents are discovered, not persisted as first-class rows)

---

## 8. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | ClawNex Engineering | Initial release — 15 tables, 13 indexes |
| 1.1 | 2026-04-02 | ClawNex Engineering | Added agent_ignore_patterns, ai_panel_default, openclaw_* config keys |
| 1.2 | 2026-04-02 | ClawNex Engineering | Audit action types updated: shield_detected (session watcher), shield_scan_observed (observe mode). Access list deny entries enforced as shield rules. |
| 1.3 | 2026-04-05 | ClawNex Engineering | v0.5.0-alpha: Added cve_records table (16 tables total), 3 new indexes for CVE queries, CWE-to-shield category mapping. |
| 1.4 | 2026-04-11 | ClawNex Engineering | v0.5.4-alpha: Added hermes_instances table (17 tables total) for manual Hermes Agent instance management. |
| 1.5 | 2026-04-13 | ClawNex Engineering | v0.6.0: Added operators and operator_sessions tables (19 tables total) for RBAC authentication, 5 new indexes, 1 new FK relationship. |
| 1.6 | 2026-04-22 | ClawNex Engineering | v0.6.1: Added custom_correlation_rules, trust_audit_results, scheduled_report_runs tables (22 tables total), 5 new indexes, new config_defaults keys for Caddy HTTPS / scheduled reports / trust audit, new audit_log action types. |
| 1.7 | 2026-04-22 | ClawNex Engineering | Enterprise review pass: added Data Sensitivity Classification model (None/Internal/Restricted/Sensitive), per-column classification blocks for proxy_traffic / audit_log / operators / operator_sessions / trust_audit_results / scheduled_report_runs, row-growth and primary-key columns in table summary, full retention policy matrix with compliance references (SOC 2 CC6–CC7, ISO 27001 A.12.4), formal migration history (migrations 1–10 mapped to releases), textual ERD with FK and logical relationships, additional audit action types for operator lifecycle and session management. |
| 1.8 | 2026-04-22 | ClawNex Engineering | v0.6.2-alpha: added 5 new performance indexes (`idx_audit_action_time`, `idx_correlation_events_created`, `idx_correlation_events_rule_time`, `idx_alerts_created_at`, `idx_proxy_traffic_latency`); 4 new `config_defaults` keys for Trust Audit caching (`trust_audit_last_report`, `trust_audit_last_run_at`, `trust_audit_last_duration_ms`, `trust_audit_last_summary`); new audit actions `mcp:<tool>:invoked|completed|failed` and `operator_role_changed`. |
| 1.9 | 2026-04-24 | ClawNex Engineering | v0.9.0-alpha multi-auth: added `operators.auth_providers` CSV column (default `'local'`); added new table `operator_credentials` (3.19a) with passkey + github_link discriminator, 3 indexes (`idx_op_creds_operator`, partial `idx_op_creds_passkey_id`, unique partial `idx_op_creds_github_user`). Added `auth_methods_updated`, `passkey_enrolled`, `passkey_revoked`, `passkey_login_failed`, `github_linked`, `github_unlinked`, `github_login_failed` audit actions. New config_defaults keys: `auth_github_enabled`, `auth_github_client_id`, `auth_github_client_secret`, `auth_github_callback_url`. |
| 1.10 | 2026-04-24 | ClawNex Engineering | v0.9.1/v0.9.2 sweep: documented `password_reset_tokens` (§3.19b, was missing since v0.6.1) and new `magic_link_tokens` table (§3.19c, v0.9.2). Table totals updated to 24 (22 primary + 2 ephemeral token stores). ERD FK list extended with `operator_credentials`, `password_reset_tokens`, `magic_link_tokens` → `operators` cascades. Migration history extended with entries 11 (password_reset_tokens), 12 (auth_providers column), 13 (operator_credentials), 14 (v0.9.1 adversarial review #A1 UNIQUE passkey credential_id index), 15 (v0.9.2 magic_link_tokens). New config_defaults key `auth_magic_link_enabled` referenced in §3.19c. |
| 1.11 | 2026-05-05 | ClawNex Engineering | v0.10.0-alpha + v0.11.x-alpha. New §3.100 Policy Framework Tables — `policies` (3.100a) and `policy_rules` (3.100b) with full column specs, vendor-mutation lockdown rules, recommended indexes, and dual-key idempotent migration semantics (`policy_framework_schema_version` + `policy_framework_seed_version`). New §3.101 Token Cost FinOps Pipeline Type Surface — `NormalizedRow` (3.101a, 24 fields), `Signal` (3.101b), `AdapterResult` (3.101c) with adapter-private `signal_context` invariant, `GlossaryEntry` (3.101d). New §3.102 Alert Evidence extensions — `alerts.metadata` JSON for session-watcher source (11 fields), `audit_log.detail` JSON for `shield_review`/`shield_detected` actions (4 fields including redact()'d `payload_excerpt`). |
| 1.12 | 2026-05-08 | ClawNex Engineering | v0.12.0 → v0.15.0-alpha: new §3.103 Mission Control + Triage Graph Type Surface — `ActionVerb` 11-value closed enum (3.103a), `SuggestedAction` shape with display formatter (3.103b), `IncidentFamily` 4-value closed enum (3.103c), Phase 5 finding shapes for the 5 newly-wired resolvers — `CorrelationFinding` / `BlastRadiusFinding` / `AuthRbacFinding` / `UpdateCveFinding` / `PolicyWarningFinding` (3.103d), full Triage Graph type set including `TriageStageId` 5-value canonical order / `TriageLinkState` 6-value taxonomy / `TriageArtifact` shape with `evidenceSnippet` + `evidenceTrail` payloads / per-family `resolverVersion` (3.103e), new theme tokens `glassPanelNested` / `glassPanelNested2` / `glassBorderCyanStrong` for the v0.14.5 Stat tile lift + opt-in `dimGlow` prop (3.103f). |
| 1.13 | 2026-07-02 | ClawNex Engineering | v0.15.2-alpha: Added hermes_ingest_cursors and hermes_events for durable Hermes watcher state and normalized, profile/channel-scoped, content-hash-only Hermes scan events. |

---

*This is a living document. Schema changes will be reflected here.*

---

*ClawNex by ClawNex maintainers — clawnexai.com*
