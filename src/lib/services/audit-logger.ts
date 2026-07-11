/**
 * ClawNex Audit Logger — immutable audit trail for compliance and forensics.
 *
 * Every significant action generates an audit event: config changes, shield blocks,
 * alert acknowledgements, break-glass activation, correlation detections, CVE syncs.
 * The `actor` field distinguishes operator actions ("operator") from system-generated
 * events ("clawnex", "session-watcher", "correlation-engine").
 *
 * Supports queryable filtering by: source, action, actor, resource_type, time range,
 * search text, and action exclusion (useful for hiding noisy agent_event entries).
 *
 * Tamper evidence: in addition to persisting to the `audit_log` SQLite table, every
 * event is ALSO emitted as a single-line JSON record on stdout with the
 * `[CLAWNEX_AUDIT]` prefix. External log aggregators (journalctl, syslog, SIEM) can
 * capture that stream to retain an out-of-process copy of the audit trail, giving
 * tamper-evidence before the full hash-chain design ships. The stdout mirror can be
 * disabled by setting `CLAWNEX_AUDIT_STDOUT=false` (e.g. in tests).
 *
 * Tables: audit_log
 *
 * @module services/audit-logger
 */

import { randomUUID } from 'node:crypto';
import { run, queryAll, queryOne } from '../db/index';
import { logInfo, type LogSource } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditRecord {
  id: string;
  actor: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: string | null;
  source: string;
  created_at: string;
}

/**
 * Audit-list pagination caps. DAST 2026-05-15 #7: the previous max of
 * 1000 still let a logged-in operator (or any caller bypassing the
 * routes) pull large pages in a tight loop, which is both a perf
 * concern and a low-grade exfiltration multiplier. Both bounds are
 * pinned at 100 — the default and the ceiling are intentionally the
 * same so any value above it normalizes downward without UX surprise.
 */
export const DEFAULT_AUDIT_LIMIT = 100;
export const MAX_AUDIT_LIMIT = 100;

/**
 * Parse + clamp a `limit` value to a safe integer in [1, MAX_AUDIT_LIMIT].
 * Accepts the shape routes parse from the query string AND the shape
 * service-layer callers hand to listEvents directly:
 *
 *   - missing / empty / NaN / Infinity / -Infinity → DEFAULT_AUDIT_LIMIT (100)
 *   - negative, zero, fractional<1                → 1 (request at least one row)
 *   - > MAX_AUDIT_LIMIT                           → MAX_AUDIT_LIMIT (100)
 *   - fractional values                           → floored to integer
 *
 * Why the union type: AuditFilters.limit is declared `number`, but the
 * TS guarantee evaporates at runtime — an internal caller could pass
 * NaN or Infinity (computed from another flag, parseInt fall-through,
 * etc.) and the previous `Math.max(NaN, 1) = NaN` would propagate
 * straight into the SQL parameter binding. Routing every limit through
 * this helper folds the finite-safe check into one place.
 */
export function clampAuditLimit(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_AUDIT_LIMIT;
  const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_AUDIT_LIMIT;
  const intN = Math.floor(n);
  if (intN < 1) return 1;
  return Math.min(intN, MAX_AUDIT_LIMIT);
}

/**
 * Route-boundary variant. DAST 2026-05-15 Run 2 #M4: external callers
 * passing limit=Infinity or limit=999999 must get a 400, not silent
 * normalization. clampAuditLimit's tolerant behavior stays for internal
 * service callers (where NaN/Infinity from upstream code paths should
 * still produce a safe SQL parameter). Routes call this instead.
 */
export type AuditLimitParseResult =
  | { ok: true; limit: number }
  | { ok: false; error: string };

export function parseAuditLimitOrReject(raw: string | null | undefined): AuditLimitParseResult {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, limit: DEFAULT_AUDIT_LIMIT };
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim()) {
    return { ok: false, error: `limit must be an integer between 1 and ${MAX_AUDIT_LIMIT}` };
  }
  if (n < 1) {
    return { ok: false, error: `limit must be >= 1` };
  }
  if (n > MAX_AUDIT_LIMIT) {
    return { ok: false, error: `limit must be <= ${MAX_AUDIT_LIMIT}` };
  }
  return { ok: true, limit: n };
}

/**
 * Audit since/until date validator. DAST 2026-05-16 Finding 2: the
 * route previously passed any string through to SQL TEXT comparison —
 * `?since=notadate` silently filtered nothing instead of rejecting.
 * Accepts only strict ISO 8601 (YYYY-MM-DD or full RFC 3339 datetime).
 *
 *   - missing / empty           → { ok: true, value: null }
 *   - valid ISO 8601 string     → { ok: true, value: <normalized> }
 *   - anything else             → { ok: false, error: "..." }
 *
 * Whitespace is trimmed; the round-trip-through-Date check rejects
 * fake-but-parseable shapes like "2099-13-99" (Date.parse coerces these
 * into adjacent valid dates, which would mask invalid input).
 */
export type AuditDateParseResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseAuditDateOrReject(
  raw: string | null | undefined,
  fieldName: 'since' | 'until',
): AuditDateParseResult {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  // Strict shape: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS[.sss][Z|±HH:MM]
  const SHAPE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!SHAPE.test(trimmed)) {
    return { ok: false, error: `${fieldName} must be ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)` };
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return { ok: false, error: `${fieldName} is not a valid date` };
  }
  // Round-trip check: rebuild ISO from the parsed timestamp and require
  // the date components to match. Catches "2099-13-99" → silently coerced
  // by Date.parse into 2100-01-08 in some engines.
  const parsed = new Date(ms);
  const yyyy = parsed.getUTCFullYear().toString().padStart(4, '0');
  const mm = (parsed.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = parsed.getUTCDate().toString().padStart(2, '0');
  const expectedPrefix = `${yyyy}-${mm}-${dd}`;
  if (!trimmed.startsWith(expectedPrefix)) {
    return { ok: false, error: `${fieldName} is not a valid calendar date` };
  }
  return { ok: true, value: trimmed };
}

export interface AuditFilters {
  source?: string;
  action?: string;
  actor?: string;
  resource_type?: string;
  since?: string;
  until?: string;
  limit?: number;
  exclude_actions?: string[];
  search?: string;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Log an audit event.
 */
export function logEvent(
  actor: string,
  action: string,
  resourceType?: string,
  resourceId?: string,
  detail?: string,
  source: string = 'clawnex',
): AuditRecord {
  const id = randomUUID();
  const now = new Date().toISOString();

  try {
    run(
      `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, actor, action, resourceType || null, resourceId || null, detail || null, source, now],
    );
  } catch (err) {
    console.error('[AuditLogger] Write error:', err);
  }

  // Mirror every audit event to stdout as a single-line JSON record so external
  // log aggregators (journalctl, syslog, SIEM) can capture an out-of-process copy.
  // This provides tamper-evidence: anyone with host access can modify the SQLite
  // audit_log table, but they cannot retract stdout lines already consumed by the
  // system journal. Disabled by setting CLAWNEX_AUDIT_STDOUT=false (default on).
  if (process.env.CLAWNEX_AUDIT_STDOUT !== 'false') {
    try {
      console.log('[CLAWNEX_AUDIT]', JSON.stringify({
        ts: now,
        id,
        actor,
        action,
        resource_type: resourceType ?? null,
        resource_id: resourceId ?? null,
        detail: detail ?? null,
        source,
      }));
    } catch {
      // Never let a stdout serialization failure break audit writes.
    }
  }

  // Mirror every audit event to the structured service log so the Infrastructure
  // log viewer has a steady stream of real entries. High-volume actions (agent_event,
  // chat_event) are filtered out to keep the viewer readable.
  if (action !== 'agent_event' && action !== 'chat_event') {
    try {
      // Map the audit "source" to a LogSource enum. Default to "system" for anything
      // we don't explicitly recognize — the logger's type system is intentionally narrow.
      const logSource: LogSource = ((): LogSource => {
        const s = (source || '').toLowerCase();
        if (s.includes('shield')) return 'shield';
        if (s.includes('watcher')) return 'watcher';
        if (s.includes('connector') || s.includes('openclaw')) return 'connector';
        if (s.includes('api')) return 'api';
        return 'system';
      })();
      logInfo(logSource, `${action}${resourceType ? ` (${resourceType})` : ''}`, {
        actor,
        resource_id: resourceId,
        detail,
        audit_id: id,
      });
    } catch {
      // Never let a logger failure break audit writes.
    }
  }

  return {
    id,
    actor,
    action,
    resource_type: resourceType || null,
    resource_id: resourceId || null,
    detail: detail || null,
    source,
    created_at: now,
  };
}

/**
 * Audit write for actions that must fail closed when durable accountability
 * cannot be established (for example, revealing raw forensic evidence).
 * Unlike logEvent(), database errors propagate to the caller.
 */
export function logEventStrict(
  actor: string,
  action: string,
  resourceType?: string,
  resourceId?: string,
  detail?: string,
  source: string = 'clawnex',
): AuditRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  run(
    `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, actor, action, resourceType || null, resourceId || null, detail || null, source, now],
  );
  if (process.env.CLAWNEX_AUDIT_STDOUT !== 'false') {
    console.log('[CLAWNEX_AUDIT]', JSON.stringify({
      ts: now, id, actor, action,
      resource_type: resourceType ?? null,
      resource_id: resourceId ?? null,
      detail: detail ?? null,
      source,
    }));
  }
  return {
    id, actor, action,
    resource_type: resourceType || null,
    resource_id: resourceId || null,
    detail: detail || null,
    source,
    created_at: now,
  };
}

/**
 * List audit events with optional filters.
 */
export function listEvents(filters?: AuditFilters): AuditRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.source) {
    conditions.push('source = ?');
    params.push(filters.source);
  }
  if (filters?.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }
  if (filters?.actor) {
    conditions.push('actor = ?');
    params.push(filters.actor);
  }
  if (filters?.resource_type) {
    conditions.push('resource_type = ?');
    params.push(filters.resource_type);
  }
  if (filters?.since) {
    conditions.push('created_at >= ?');
    params.push(filters.since);
  }
  if (filters?.until) {
    conditions.push('created_at <= ?');
    params.push(filters.until);
  }
  if (filters?.exclude_actions && filters.exclude_actions.length > 0) {
    const placeholders = filters.exclude_actions.map(() => '?').join(',');
    conditions.push(`action NOT IN (${placeholders})`);
    params.push(...filters.exclude_actions);
  }
  if (filters?.search) {
    conditions.push('(action LIKE ? OR actor LIKE ? OR detail LIKE ? OR resource_type LIKE ? OR resource_id LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term, term, term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // Defense-in-depth: re-route through clampAuditLimit so the SQL
  // parameter is always a safe integer in [1, MAX_AUDIT_LIMIT] —
  // including when an internal caller hands us NaN, Infinity, or a
  // fractional number that nullish-coalesce + Math.max would have
  // silently propagated into the LIMIT placeholder.
  const limit = clampAuditLimit(filters?.limit);

  return queryAll<AuditRecord>(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit],
  );
}

/**
 * Count audit events older than a given date.
 */
export function countEvents(olderThan: string): number {
  const row = queryOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM audit_log WHERE created_at <= ?',
    [olderThan],
  );
  return row?.cnt ?? 0;
}

/**
 * Delete audit events older than a given date.
 * Returns the number of deleted rows.
 */
export function deleteEvents(olderThan: string): number {
  const count = countEvents(olderThan);
  if (count > 0) {
    run('DELETE FROM audit_log WHERE created_at <= ?', [olderThan]);
  }
  return count;
}
