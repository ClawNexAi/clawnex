/**
 * Database Retention Policy — sentinel.db
 *
 * Auto-deletes rows older than configurable retention periods.
 * Runs on startup and hourly via health check piggyback.
 *
 * Retention categories (configurable from Configuration tab):
 *   - traffic:      proxy_traffic, shield_scans          (default: 3 days)
 *   - metrics:      metric_snapshots                     (default: 3 days)
 *   - correlations: correlation_events                   (default: 3 days)
 *   - alerts:       alerts, incidents                    (default: 90 days)
 *   - audit:        audit_log                            (default: 365 days, 0 = unlimited)
 *
 * Not pruned:
 *   - config_defaults, config_providers, config_models (configuration — never pruned)
 */

import { run, getDb, queryOne } from './index';

// ---------------------------------------------------------------------------
// Defaults (days) — used when no config_defaults entry exists
// ---------------------------------------------------------------------------

const DEFAULTS: Record<string, number> = {
  retention_traffic_days: 3,
  retention_metrics_days: 3,
  retention_correlations_days: 3,
  retention_alerts_days: 90,
  retention_audit_days: 365,  // 0 = unlimited
};

// ---------------------------------------------------------------------------
// Table → category mapping
// ---------------------------------------------------------------------------

interface PrunableTable {
  table: string;
  timeColumn: string;
  settingKey: string;
}

const PRUNABLE_TABLES: PrunableTable[] = [
  // Traffic
  { table: 'proxy_traffic', timeColumn: 'timestamp', settingKey: 'retention_traffic_days' },
  { table: 'shield_scans', timeColumn: 'scanned_at', settingKey: 'retention_traffic_days' },
  // Metrics
  { table: 'metric_snapshots', timeColumn: 'recorded_at', settingKey: 'retention_metrics_days' },
  // Correlations
  { table: 'correlation_events', timeColumn: 'created_at', settingKey: 'retention_correlations_days' },
  // Alerts & Incidents
  { table: 'alerts', timeColumn: 'created_at', settingKey: 'retention_alerts_days' },
  { table: 'incidents', timeColumn: 'created_at', settingKey: 'retention_alerts_days' },
  // Audit
  { table: 'audit_log', timeColumn: 'created_at', settingKey: 'retention_audit_days' },
];

// ---------------------------------------------------------------------------
// Read retention setting from DB, fallback to default
// ---------------------------------------------------------------------------

function getRetentionDays(settingKey: string): number {
  try {
    const row = queryOne<{ value: string }>(
      "SELECT value FROM config_defaults WHERE key = ?",
      [settingKey]
    );
    if (row?.value) {
      const val = parseInt(row.value, 10);
      if (!isNaN(val) && val >= 0) return val;
    }
  } catch { /* DB may not be ready */ }
  return DEFAULTS[settingKey] ?? 3;
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

let lastRunAt = 0;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Delete rows older than the configured retention period for each category.
 * Returns total number of rows deleted across all tables.
 */
export function enforceRetention(): number {
  let totalDeleted = 0;

  const db = getDb();
  const txn = db.transaction(() => {
    for (const { table, timeColumn, settingKey } of PRUNABLE_TABLES) {
      const days = getRetentionDays(settingKey);

      // 0 = unlimited — skip this table
      if (days === 0) continue;

      // Validate table/column names against allowlist to prevent SQL injection
      const ALLOWED_TABLES = new Set(PRUNABLE_TABLES.map(t => t.table));
      const ALLOWED_COLUMNS = new Set(PRUNABLE_TABLES.map(t => t.timeColumn));
      if (!ALLOWED_TABLES.has(table) || !ALLOWED_COLUMNS.has(timeColumn)) {
        console.error(`[Retention] Invalid table/column: ${table}.${timeColumn} — skipping`);
        continue;
      }
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const result = run(`DELETE FROM ${table} WHERE ${timeColumn} < ?`, [cutoff]);
      if (result.changes > 0) {
        console.log(`[Retention] Pruned ${result.changes} rows from ${table} (older than ${days}d)`);
        totalDeleted += result.changes;
      }
    }
  });

  txn();

  if (totalDeleted > 0) {
    console.log(`[Retention] Total pruned: ${totalDeleted} rows`);
  }

  lastRunAt = Date.now();
  return totalDeleted;
}

/**
 * Run retention if at least one hour has passed since the last run.
 * Safe to call frequently (e.g. from health check endpoint).
 */
export function maybeEnforceRetention(): void {
  if (Date.now() - lastRunAt >= ONE_HOUR_MS) {
    try {
      enforceRetention();
    } catch (err) {
      console.error('[Retention] Hourly enforcement failed:', err);
    }
  }
}

/**
 * Get all current retention settings (for API/UI).
 */
export function getRetentionSettings(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(DEFAULTS)) {
    result[key] = getRetentionDays(key);
  }
  return result;
}
