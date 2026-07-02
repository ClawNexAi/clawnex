/**
 * ClawNex Alert Manager
 *
 * Creates, acknowledges, resolves, and queries alerts in the SQLite database.
 * Supports deduplication (same title+source within 5 minutes = update, not create).
 * Broadcasts new alerts via SSE.
 */

import { randomUUID } from 'node:crypto';
import { run, queryAll, queryOne, transaction } from '../db/index';
import { broadcast } from '../events';
import { checkAcceptance } from './risk-acceptance';
import {
  type AlertScope,
  type Origin,
  ALERT_STATUS_SUPPRESSED,
  ORIGIN_PRODUCTION,
  statusesForScope,
  productionOriginSqlClause,
} from '../dashboard/metric-semantics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertRecord {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  source: string;
  source_event_id: string | null;
  status: string;
  acknowledged_by: string | null;
  resolved_at: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertFilters {
  /** Exact status filter. Mutually exclusive with `scope` — if both are
   *  provided, `status` wins so explicit status queries (e.g. `status=open`)
   *  remain backwards-compatible. */
  status?: string;
  severity?: string;
  source?: string;
  excludeSource?: string;
  since?: string;
  limit?: number;
  /** v0.9.3+ canonical filter. `active` = open+acknowledged+investigating
   *  (the user-facing default). `terminal` = resolved+suppressed+false_positive.
   *  `all` = no status filter. When omitted and no `status` is given, the
   *  caller is given the legacy default (everything except suppressed) for
   *  backward compatibility — see `/api/alerts` route which now defaults to
   *  `scope=active` for new dashboard surfaces. */
  scope?: AlertScope;
  /** v0.8.0+: when true, suppressed alerts are layered on top of whatever
   *  `scope` returned. Default false — operators must explicitly opt in. */
  include_suppressed?: boolean;
  /** v0.9.3+ (Phase 2a): when true, restrict to production-grade origins
   *  (production + manual). Excludes shield-test/demo/qa. Use for any
   *  user-facing counter that shouldn't be polluted by test runs. */
  productionOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Deduplication window
// ---------------------------------------------------------------------------

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Create a new alert. If an alert with the same title+source exists within
 * the dedup window and is still open, update it instead of creating a new one.
 *
 * Origin (Phase 2a, v0.9.3+): persisted into `metadata.origin` so production
 * counters can exclude shield-test/demo/qa records by default. Defaults to
 * 'production' when not specified — every existing caller is producing real
 * operational evidence. Shield Tests pass `origin: 'shield-test'` so its
 * generated alerts don't pollute the header/sidebar/Fleet badges.
 */
export function createAlert(
  title: string,
  description: string,
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO',
  source: string,
  metadata?: Record<string, unknown>,
  origin: Origin = ORIGIN_PRODUCTION,
): AlertRecord {
  const now = new Date().toISOString();
  const dedupSince = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

  // Wrap dedup check + insert/update in a transaction to prevent race conditions
  const result = transaction(() => {
    // Check for duplicate
    const existing = queryOne<AlertRecord>(
      `SELECT * FROM alerts
       WHERE title = ? AND source = ? AND status = 'open' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
      [title, source, dedupSince],
    );

    if (existing) {
      // Update existing alert
      run(
        `UPDATE alerts SET description = ?, severity = ?, metadata = ?, updated_at = ? WHERE id = ?`,
        [description, severity, metadata ? JSON.stringify(metadata) : existing.metadata, now, existing.id],
      );

      const updated = { ...existing, description, severity, updated_at: now };
      return { type: 'updated' as const, alert: updated };
    }

    // v0.8.0: check risk acceptance BEFORE inserting. The "rule_id" for
    // an alert is its title (alerts don't have a separate rule_id concept);
    // evidence is [severity, source]. If a matching acceptance exists, the
    // alert is inserted directly with status='suppressed' so it doesn't
    // trigger badges/broadcasts. Operator can still find it via
    // GET /api/alerts?include_suppressed=true.
    let initialStatus = 'open';
    let suppressionAcceptanceId: string | null = null;
    try {
      const check = checkAcceptance({
        source_panel: 'alerts',
        rule_id: title,
        agent_id: typeof metadata?.agent_id === 'string' ? metadata.agent_id : null,
        surface_id: null,
        evidence: [severity, source],
      });
      if (check.accepted && check.acceptance) {
        initialStatus = 'suppressed';
        suppressionAcceptanceId = check.acceptance.id;
      }
    } catch (err) {
      console.warn('[alert-manager] risk-acceptance check failed; alert proceeds as open:', err);
    }

    // Create new alert. Origin lives at the top of metadata so SQL
    // json_extract(metadata, '$.origin') reads it cleanly.
    const id = randomUUID();
    const baseMetadata = { ...(metadata ?? {}), origin };
    const finalMetadata = suppressionAcceptanceId
      ? { ...baseMetadata, suppressed_by_acceptance_id: suppressionAcceptanceId }
      : baseMetadata;
    run(
      `INSERT INTO alerts (id, title, description, severity, source, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, description, severity, source, initialStatus, JSON.stringify(finalMetadata), now, now],
    );

    const alert: AlertRecord = {
      id,
      title,
      description,
      severity,
      source,
      source_event_id: null,
      status: initialStatus,
      acknowledged_by: null,
      resolved_at: null,
      metadata: JSON.stringify(finalMetadata),
      created_at: now,
      updated_at: now,
    };

    return { type: initialStatus === 'suppressed' ? 'suppressed' as const : 'new' as const, alert };
  });

  if (result.type === 'updated') {
    broadcast('alert_updated', result.alert);
  } else if (result.type === 'new') {
    broadcast('alert_new', result.alert);
  }
  // Suppressed alerts are recorded but not broadcast — the operator opted
  // out of being notified about this signature when they accepted the risk.
  return result.alert;
}

/**
 * Acknowledge an alert.
 */
export function acknowledgeAlert(id: string, by: string): AlertRecord | null {
  const now = new Date().toISOString();

  const existing = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [id]);
  if (!existing) return null;

  run(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_by = ?, updated_at = ? WHERE id = ?`,
    [by, now, id],
  );

  const updated = { ...existing, status: 'acknowledged', acknowledged_by: by, updated_at: now };
  broadcast('alert_updated', updated);
  return updated;
}

/**
 * Mark an alert as actively investigating. Distinct from acknowledged:
 *  - acknowledged = "I'm aware, I'll handle it" (handshake)
 *  - investigating = "I'm actively diagnosing root cause" (work in flight)
 *
 * v0.8.4+ ships the UI button. acknowledged_by is reused as the operator
 * identity so the audit trail captures who is investigating.
 */
export function markInvestigating(id: string, by: string): AlertRecord | null {
  const now = new Date().toISOString();

  const existing = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [id]);
  if (!existing) return null;

  run(
    `UPDATE alerts SET status = 'investigating', acknowledged_by = ?, updated_at = ? WHERE id = ?`,
    [by, now, id],
  );

  const updated = { ...existing, status: 'investigating', acknowledged_by: by, updated_at: now };
  broadcast('alert_updated', updated);
  return updated;
}

/**
 * Resolve an alert.
 */
export function resolveAlert(id: string): AlertRecord | null {
  const now = new Date().toISOString();

  const existing = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [id]);
  if (!existing) return null;

  run(
    `UPDATE alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id],
  );

  const updated = { ...existing, status: 'resolved', resolved_at: now, updated_at: now };
  broadcast('alert_updated', updated);
  return updated;
}

/**
 * List alerts with optional filters.
 *
 * Status precedence:
 *   1. Explicit `status` (legacy callers / single-status queries) → exact match.
 *   2. Explicit `scope` (active/terminal/all) → IN-list per metric-semantics.
 *   3. Neither → backward-compat default of "everything except suppressed."
 *      Note: this legacy default is preserved here so callers that haven't
 *      migrated to `scope` keep their current behavior. New code should pass
 *      `scope: 'active'`. The `/api/alerts` route now defaults to active scope
 *      for unspecified requests starting in v0.9.3.
 *
 * `include_suppressed=true` is layered on top of the chosen scope/status to
 * also include suppressed records — useful for risk-acceptance review views.
 */
export function listAlerts(filters?: AlertFilters): AlertRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  } else if (filters?.scope) {
    const statuses = statusesForScope(filters.scope);
    if (filters.scope !== 'all') {
      // Build IN clause with placeholders for safe parameterization. We could
      // embed the literals (statuses are constants from metric-semantics) but
      // parameterized form is preferred for any column predicate.
      const inClause = statuses.map(() => '?').join(', ');
      let clause = `status IN (${inClause})`;
      // include_suppressed adds suppressed back even if scope omitted it.
      if (filters.include_suppressed && filters.scope === 'active') {
        clause = `(${clause} OR status = ?)`;
        conditions.push(clause);
        params.push(...statuses, ALERT_STATUS_SUPPRESSED);
      } else {
        conditions.push(clause);
        params.push(...statuses);
      }
    }
    // scope='all' adds no status filter.
  } else if (!filters?.include_suppressed) {
    // Legacy default: exclude suppressed only. Preserved for backward compat
    // with callers (MCP tools, reports) that haven't migrated to `scope`.
    conditions.push("status != ?");
    params.push(ALERT_STATUS_SUPPRESSED);
  }
  if (filters?.severity) {
    conditions.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters?.source) {
    conditions.push('source = ?');
    params.push(filters.source);
  }
  if (filters?.excludeSource) {
    conditions.push('source != ?');
    params.push(filters.excludeSource);
  }
  if (filters?.since) {
    conditions.push('created_at >= ?');
    params.push(filters.since);
  }
  if (filters?.productionOnly) {
    // metadata is the alerts JSON column. Legacy records (no origin set)
    // are treated as production by `productionOriginSqlClause`.
    conditions.push(productionOriginSqlClause('metadata'));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 100;

  return queryAll<AlertRecord>(
    `SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit],
  );
}

/**
 * Count alerts matching the given filters. Cheaper than `listAlerts` when the
 * caller only needs `total`. Implementation mirrors `listAlerts`'s WHERE
 * construction so the two stay in lock-step on semantic changes.
 */
export function countAlerts(filters?: Omit<AlertFilters, 'limit'>): number {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  } else if (filters?.scope) {
    const statuses = statusesForScope(filters.scope);
    if (filters.scope !== 'all') {
      const inClause = statuses.map(() => '?').join(', ');
      let clause = `status IN (${inClause})`;
      if (filters.include_suppressed && filters.scope === 'active') {
        clause = `(${clause} OR status = ?)`;
        conditions.push(clause);
        params.push(...statuses, ALERT_STATUS_SUPPRESSED);
      } else {
        conditions.push(clause);
        params.push(...statuses);
      }
    }
  } else if (!filters?.include_suppressed) {
    conditions.push("status != ?");
    params.push(ALERT_STATUS_SUPPRESSED);
  }
  if (filters?.severity) {
    conditions.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters?.source) {
    conditions.push('source = ?');
    params.push(filters.source);
  }
  if (filters?.excludeSource) {
    conditions.push('source != ?');
    params.push(filters.excludeSource);
  }
  if (filters?.since) {
    conditions.push('created_at >= ?');
    params.push(filters.since);
  }
  if (filters?.productionOnly) {
    // metadata is the alerts JSON column. Legacy records (no origin set)
    // are treated as production by `productionOriginSqlClause`.
    conditions.push(productionOriginSqlClause('metadata'));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts ${where}`, params);
  return row?.cnt ?? 0;
}
