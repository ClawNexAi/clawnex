/**
 * ClawNex Database Schema — SQLite via better-sqlite3.
 *
 * Defines 27 tables covering:
 * - Core data: metrics, security scans, alerts, incidents, shield scans,
 *   correlations, audit log, proxy traffic
 * - Configuration: providers, models, gateways, defaults, access lists,
 *   CVE records, maintenance items
 *
 * All tables use IF NOT EXISTS — safe to re-run on every startup.
 * Primary keys are TEXT (UUIDs) except metric_snapshots (AUTOINCREMENT).
 * Timestamps are ISO 8601 TEXT, not UNIX epoch — human-readable in DB browsers.
 *
 * Indexes are created for frequently queried columns (time-based, status, severity).
 * Foreign keys are enforced via PRAGMA foreign_keys = ON in db/index.ts.
 *
 * Migrations are additive ALTER TABLE statements in the MIGRATIONS array.
 * Each runs inside try/catch — duplicate column errors are silently ignored,
 * making migrations idempotent and safe to re-run.
 *
 * @module db/schema
 */

export const SCHEMA = `
-- Time-series metrics snapshots (1-min resolution, 7-day retention)
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  metadata TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Security scan results
CREATE TABLE IF NOT EXISTS security_scans (
  id TEXT PRIMARY KEY,
  scanner TEXT NOT NULL,
  overall_grade TEXT,
  overall_score REAL,
  total_checks INTEGER,
  passed_checks INTEGER,
  failed_checks INTEGER,
  raw_output TEXT,
  parsed_results TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Individual check results
CREATE TABLE IF NOT EXISTS security_check_results (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES security_scans(id),
  check_id TEXT NOT NULL,
  check_name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT,
  detail TEXT,
  remediation TEXT,
  sentinel_check_id TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  acknowledged_by TEXT,
  resolved_at TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Incidents
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  alert_ids TEXT,
  timeline TEXT,
  root_cause TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt shield scan log
CREATE TABLE IF NOT EXISTS shield_scans (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,
  source_session_id TEXT,
  source_agent_id TEXT,
  content_hash TEXT NOT NULL,
  layers_triggered TEXT,
  threat_level TEXT NOT NULL,
  detail TEXT,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Correlation events
CREATE TABLE IF NOT EXISTS correlation_events (
  id TEXT PRIMARY KEY,
  correlation_rule TEXT NOT NULL,
  source_events TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  alert_id TEXT REFERENCES alerts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit trail
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  detail TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rate limiter persistence (CX-R14-12). In-memory windows reset on process
-- restart, which lets an attacker burn the limit, force a restart (or wait
-- one), and start over. Persisting timestamps means a hot restart of the
-- dashboard does not give an attacker a fresh window. Cleanup is in-process
-- (we age out >60s entries on each check); this table grows briefly under
-- load and stays small at steady state.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key_id TEXT PRIMARY KEY,
  timestamps TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_updated ON rate_limit_buckets(updated_at);

-- Maintenance checklists
CREATE TABLE IF NOT EXISTS maintenance_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  is_automated INTEGER DEFAULT 0,
  auto_check_source TEXT,
  last_completed_at TEXT,
  next_due_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Access control lists
CREATE TABLE IF NOT EXISTS access_lists (
  id TEXT PRIMARY KEY,
  list_type TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Model providers (LM Studio, OpenAI-compatible endpoints)
CREATE TABLE IF NOT EXISTS config_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Models discovered/configured per provider
CREATE TABLE IF NOT EXISTS config_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES config_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  name TEXT,
  is_default INTEGER DEFAULT 0,
  context_window INTEGER DEFAULT 131072,
  max_output INTEGER DEFAULT 16384,
  supports_reasoning INTEGER DEFAULT 0,
  supports_vision INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gateway instances (OpenClaw gateways to monitor)
CREATE TABLE IF NOT EXISTS config_gateways (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  token TEXT DEFAULT '',
  client_name TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  is_primary INTEGER DEFAULT 0,
  status TEXT DEFAULT 'unknown',
  last_connected_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hermes Agent instances
CREATE TABLE IF NOT EXISTS hermes_instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  home_path TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  status TEXT DEFAULT 'unknown',
  last_checked_at TEXT,
  last_error TEXT,
  session_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default settings
CREATE TABLE IF NOT EXISTS config_defaults (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CVE Records (synced from OpenClawCVEs repo)
CREATE TABLE IF NOT EXISTS cve_records (
  cve_id TEXT PRIMARY KEY,
  severity TEXT DEFAULT '',
  cvss REAL,
  title TEXT NOT NULL,
  date_published TEXT,
  ghsa_id TEXT DEFAULT '',
  affected_versions TEXT DEFAULT '',
  fixed_version TEXT DEFAULT '',
  cwes TEXT DEFAULT '',
  packages TEXT DEFAULT '',
  html_url TEXT DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cve_severity ON cve_records(severity);
CREATE INDEX IF NOT EXISTS idx_metrics_source_time ON metric_snapshots(source, recorded_at);
CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metric_snapshots(metric_name, recorded_at);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_shield_scans_time ON shield_scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_check_results_scan ON security_check_results(scan_id);
CREATE INDEX IF NOT EXISTS idx_config_models_provider ON config_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_config_models_default ON config_models(is_default);

-- Proxy traffic log
CREATE TABLE IF NOT EXISTS proxy_traffic (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  direction TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  upstream_url TEXT,
  prompt_hash TEXT,
  messages_count INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  shield_verdict TEXT,
  shield_score INTEGER,
  shield_detections TEXT,
  blocked INTEGER DEFAULT 0,
  block_reason TEXT,
  session_id TEXT,
  status_code INTEGER,
  error TEXT,
  source TEXT DEFAULT 'proxy'
);

CREATE INDEX IF NOT EXISTS idx_proxy_traffic_time ON proxy_traffic(timestamp);
CREATE INDEX IF NOT EXISTS idx_proxy_traffic_model ON proxy_traffic(model);
CREATE INDEX IF NOT EXISTS idx_proxy_traffic_verdict ON proxy_traffic(shield_verdict);
CREATE INDEX IF NOT EXISTS idx_proxy_traffic_source ON proxy_traffic(source);

-- Configurable Rule & Policy Framework (v1)
CREATE TABLE IF NOT EXISTS policies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  source          TEXT NOT NULL CHECK(source IN ('curated','system','custom')),
  lifecycle       TEXT NOT NULL DEFAULT 'starter' CHECK(lifecycle IN ('draft','lab','starter','strict','custom')),
  version         TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS policy_rules (
  id              TEXT PRIMARY KEY,
  policy_id       TEXT NOT NULL,
  rule_key        TEXT NOT NULL,
  name            TEXT NOT NULL,
  pattern         TEXT NOT NULL,
  flags           TEXT NOT NULL DEFAULT '',
  is_regex        INTEGER NOT NULL DEFAULT 0 CHECK(is_regex IN (0,1)),
  direction       TEXT NOT NULL CHECK(direction IN ('inbound','outbound','both')),
  severity        TEXT NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  action          TEXT NOT NULL DEFAULT 'score' CHECK(action IN ('score','allow','redact','review','block')),
  exceptions      TEXT NOT NULL DEFAULT '',
  lifecycle       TEXT CHECK(lifecycle IS NULL OR lifecycle IN ('draft','lab','starter','strict','custom')),
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(policy_id) REFERENCES policies(id) ON DELETE CASCADE,
  UNIQUE(policy_id, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_policy_id ON policy_rules(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_rules_direction ON policy_rules(direction);
CREATE INDEX IF NOT EXISTS idx_policy_rules_enabled ON policy_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_policies_enabled ON policies(enabled);
CREATE INDEX IF NOT EXISTS idx_policies_source ON policies(source);
`;

/**
 * Migrations to run after initial schema creation.
 * Each statement is run individually wrapped in try/catch so
 * "duplicate column" errors from re-runs are silently ignored.
 */
export const MIGRATIONS: string[] = [
  "ALTER TABLE proxy_traffic ADD COLUMN source TEXT DEFAULT 'proxy'",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_config_models_unique ON config_models(provider_id, model_id)",
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    rate_limit INTEGER DEFAULT 60,
    last_used_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  )`,
  // 2026-04-11: Model pricing table — stores per-model cost rates for the
  // Token & Cost Intel panel. Auto-seeded from data/litellm-model-prices.json
  // on first boot and refreshed from LiteLLM's GitHub at the pinned tag via
  // the /api/config/model-pricing/sync endpoint. See also services/model-pricing-store.ts.
  `CREATE TABLE IF NOT EXISTS model_prices (
    model_id TEXT PRIMARY KEY,
    input_per_token REAL NOT NULL DEFAULT 0,
    output_per_token REAL NOT NULL DEFAULT 0,
    cache_read_per_token REAL,
    cache_write_per_token REAL,
    provider TEXT,
    source TEXT NOT NULL DEFAULT 'bundled',
    source_version TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_model_prices_provider ON model_prices(provider)",
  "CREATE INDEX IF NOT EXISTS idx_model_prices_source ON model_prices(source)",

  // 2026-04-11: RBAC — operator identity table for role-based access control.
  `CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','security_manager','operator','viewer','auditor')),
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    login_count INTEGER DEFAULT 0,
    failed_login_count INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_username ON operators(username)",

  // 2026-04-11: RBAC — operator session tokens for authentication.
  `CREATE TABLE IF NOT EXISTS operator_sessions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_sessions_token ON operator_sessions(token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_operator ON operator_sessions(operator_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON operator_sessions(expires_at)",

  // 2026-04-13: Add email column to operators (may already exist in fresh installs)
  "ALTER TABLE operators ADD COLUMN email TEXT",

  // 2026-04-19: Password reset tokens
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens(token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_reset_tokens_operator ON password_reset_tokens(operator_id)",

  // 2026-04-22 (Task 9 — perf): indexes to eliminate full scans on hot paths.
  // - correlation_events ORDER BY created_at DESC LIMIT (list + dedup)
  // - alerts WHERE created_at >= ? (10-min recent + 24h fleet count)
  // - proxy_traffic latency_ms ORDER BY DESC (p95 calculation)
  "CREATE INDEX IF NOT EXISTS idx_correlation_events_created ON correlation_events(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_correlation_events_rule_time ON correlation_events(correlation_rule, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_proxy_traffic_latency ON proxy_traffic(latency_ms)",

  // 2026-04-23 (v0.8.0-alpha — Risk Acceptance): operator-explicit suppression
  // of findings across Trust Audit / Blast Radius / Correlations / Alerts.
  // Each row records WHO accepted WHAT, WHY, UNTIL WHEN, and the evidence
  // snapshot at accept time (used for delta detection — auto-revoke when
  // evidence changes). Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md
  `CREATE TABLE IF NOT EXISTS risk_acceptances (
    id TEXT PRIMARY KEY,
    finding_signature TEXT NOT NULL,
    scope_level TEXT NOT NULL CHECK(scope_level IN ('finding','agent_rule','rule_global')),
    source_panel TEXT NOT NULL CHECK(source_panel IN ('trust_audit','blast_radius_combo','blast_radius_lint','correlations','alerts')),
    rule_id TEXT NOT NULL,
    agent_id TEXT,
    surface_id TEXT,
    evidence_snapshot TEXT NOT NULL,
    accepted_by TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_by TEXT,
    revoke_reason TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_risk_acceptances_signature ON risk_acceptances(finding_signature)",
  "CREATE INDEX IF NOT EXISTS idx_risk_acceptances_expiry ON risk_acceptances(expires_at)",

  // 2026-04-23 (v0.9.0-alpha — Multi-auth providers): operators can have
  // multiple credentials beyond username+password. The auth_providers CSV
  // tracks which providers are enabled for each operator (always includes
  // 'local' as the break-glass fallback). The operator_credentials table
  // stores Passkey credentials (WebAuthn registrations) and GitHub OAuth
  // links. Spec: docs/superpowers/specs/2026-04-23-multi-auth-providers-design.md §3
  "ALTER TABLE operators ADD COLUMN auth_providers TEXT NOT NULL DEFAULT 'local'",

  `CREATE TABLE IF NOT EXISTS operator_credentials (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    credential_type TEXT NOT NULL CHECK(credential_type IN ('passkey','github_link')),
    -- Passkey-specific (NULL for github_link rows)
    credential_id TEXT,
    public_key TEXT,
    counter INTEGER DEFAULT 0,
    transports TEXT,
    -- GitHub-link-specific (NULL for passkey rows)
    github_user_id INTEGER,
    github_username TEXT,
    -- Common
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_op_creds_operator ON operator_credentials(operator_id)",
  "CREATE INDEX IF NOT EXISTS idx_op_creds_passkey_id ON operator_credentials(credential_id) WHERE credential_id IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_op_creds_github_user ON operator_credentials(github_user_id) WHERE github_user_id IS NOT NULL",

  // 2026-04-24 (v0.9.0-alpha — adversarial review finding #A1): passkey
  // credential_id must be globally unique. WebAuthn guarantees this
  // cryptographically (128+ bits random), but the non-unique index mirrored
  // github_user_id's symmetry loosely. Upgrading to UNIQUE closes the
  // defense-in-depth gap. The old non-unique index is dropped first so the
  // migration is idempotent; if any duplicate ever slipped in, the CREATE
  // UNIQUE will fail loudly and surface the issue instead of corrupting auth.
  "DROP INDEX IF EXISTS idx_op_creds_passkey_id",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_op_creds_passkey_id ON operator_credentials(credential_id) WHERE credential_id IS NOT NULL",

  // 2026-04-24 (v0.9.2-alpha — Magic Link auth backend): email-delivered
  // one-shot sign-in tokens. Each row is a single pending login attempt;
  // consumed_at marks the token as spent (atomic UPDATE pattern — see
  // providers/magic-link.ts). Hash-only storage so a DB read never exposes
  // a usable token. Mirrors the password_reset_tokens table shape.
  // Spec: docs/go-live-checklist.md Phase 1 v0.9.2.
  `CREATE TABLE IF NOT EXISTS magic_link_tokens (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    ip TEXT,
    user_agent TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_hash ON magic_link_tokens(token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_operator ON magic_link_tokens(operator_id)",

  // 2026-04-26: ClawNex rebrand cleanup — historical audit_log rows used
  // 'sentinel' as both the source designator (built-in rule-pack identifier)
  // and the actor name for system-driven inserts. The v0.9 rebrand renames
  // both to 'clawnex'. These UPDATEs are idempotent: after the first run
  // there are no rows with the legacy value, so subsequent boots are no-ops.
  "UPDATE audit_log SET source = 'clawnex' WHERE source = 'sentinel'",
  "UPDATE audit_log SET actor = 'clawnex' WHERE actor = 'sentinel'",

  // 2026-05-03 (Policy Framework v1 — Gate 2.1 fix-up): persist regex
  // flags alongside the pattern source so /i, /g, /gi, /u survive the
  // serialization round-trip. Without the column, COG-SOUL's /i flag was
  // dropped and the reviewer's 2026-05-01 probe set would silently fail at the
  // Gate 4 cutover. The column is added via ALTER TABLE for existing
  // dev DBs (BASE_SCHEMA already declares it for fresh installs).
  // NOT NULL DEFAULT '' is safe because existing rows will populate the
  // empty-flags case (matches "no flags" behavior).
  "ALTER TABLE policy_rules ADD COLUMN flags TEXT NOT NULL DEFAULT ''",
];
