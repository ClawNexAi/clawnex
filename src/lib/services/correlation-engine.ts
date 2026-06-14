/**
 * ClawNex Correlation Engine
 *
 * Detects multi-step attack patterns by correlating events from different sources
 * (shield scans, alerts, connector events, system metrics) within a sliding
 * time window.
 *
 * Architecture:
 * - In-memory sliding window (5 minutes) of recent events
 * - 6 correlation rules run on every ingested event
 * - Deduplication: same rule+session within 60 seconds = ignored
 * - Detected correlations are stored in DB and trigger alerts
 *
 * Rules:
 * - Attack Chain: 2+ shield BLOCKs from same session → CRITICAL
 * - Token Burn: 3+ token spike events → HIGH (denial-of-wallet)
 * - Service Cascade: 2+ services going offline → CRITICAL
 * - Auth Storm: 3+ auth failures → HIGH (brute force)
 * - Drift Alert: workspace file changes + shield detections → HIGH
 * - Config Anomaly: config changes + security events → CRITICAL (insider threat)
 *
 * Why in-memory window: correlations need sub-second response time. Querying
 * the DB for recent events on every ingest would be too slow. The window is
 * pruned on every ingest call, keeping memory bounded.
 *
 * @module services/correlation-engine
 */

import { randomUUID } from 'node:crypto';
import { run, queryAll, queryOne } from '../db/index';
import { broadcast } from '../events';
import { createAlert } from './alert-manager';
import { logEvent } from './audit-logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrelationEvent {
  id: string;
  source: string;
  eventType: string;
  sessionId?: string;
  agentId?: string;
  severity?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface CorrelationRecord {
  id: string;
  correlation_rule: string;
  source_events: string;
  description: string;
  severity: string;
  alert_id: string | null;
  created_at: string;
}

export interface CorrelationFilters {
  severity?: string;
  since?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Correlation Rules
// ---------------------------------------------------------------------------

type CorrelationRule = {
  id: string;
  name: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH';
  check: (events: CorrelationEvent[]) => CorrelationMatch | null;
};

interface CorrelationMatch {
  description: string;
  matchedEvents: CorrelationEvent[];
}

// ---------------------------------------------------------------------------
// Sliding window
// ---------------------------------------------------------------------------

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const eventWindow: CorrelationEvent[] = [];
const recentCorrelations = new Set<string>(); // dedup key: rule+session within 60s
const CORRELATION_DEDUP_MS = 60_000;

// CX-R14-07: hard cap on in-memory events. Without a cap, a flood attack
// (rapid shield scans, auth storms, connector spam) pushes thousands of
// events per second into eventWindow and pruneWindow only removes by AGE.
// At 5 min × 1000 events/s = 300K event objects + metadata in memory — a
// DoS vector on the Node process. With the cap, when the window is full
// we drop the oldest before adding the new one, bounding memory regardless
// of ingest rate.
const MAX_EVENTS_IN_WINDOW = 10_000;

function pruneWindow(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (eventWindow.length > 0 && eventWindow[0].timestamp < cutoff) {
    eventWindow.shift();
  }
  // Hard cap (size-based): drop oldest until under MAX_EVENTS_IN_WINDOW.
  // Runs AFTER time-based pruning so steady-state load isn't affected;
  // only kicks in during ingest bursts.
  while (eventWindow.length > MAX_EVENTS_IN_WINDOW) {
    eventWindow.shift();
  }
}

function dedupKey(rule: string, events: CorrelationEvent[]): string {
  const sessionIds = events
    .map((e) => e.sessionId || e.agentId || 'none')
    .sort()
    .join(',');
  return `${rule}:${sessionIds}`;
}

// ---------------------------------------------------------------------------
// Rule Definitions
// ---------------------------------------------------------------------------

const RULES: CorrelationRule[] = [
  {
    id: 'attack_chain',
    name: 'Attack Chain',
    description: 'Multiple shield BLOCKs from same session within window = coordinated attack',
    severity: 'CRITICAL',
    check(events) {
      // Group shield blocks by session
      const shieldBlocks = events.filter(
        (e) => e.source === 'shield' && e.eventType === 'block',
      );
      const bySession = new Map<string, CorrelationEvent[]>();
      for (const e of shieldBlocks) {
        const key = e.sessionId || 'unknown';
        if (!bySession.has(key)) bySession.set(key, []);
        bySession.get(key)!.push(e);
      }
      for (const entry of Array.from(bySession.entries())) {
        const [session, group] = entry;
        if (group.length >= 2 && session !== 'unknown') {
          return {
            description: `Coordinated attack detected: ${group.length} shield BLOCKs from session ${session} within 5-minute window`,
            matchedEvents: group,
          };
        }
      }
      return null;
    },
  },
  {
    id: 'token_burn',
    name: 'Token Burn',
    description: 'Rapid metric increases in token usage = denial-of-wallet',
    severity: 'HIGH',
    check(events) {
      const tokenEvents = events.filter(
        (e) => e.source === 'metrics' && e.eventType === 'token_spike',
      );
      if (tokenEvents.length >= 3) {
        return {
          description: `Token burn detected: ${tokenEvents.length} rapid token usage spikes within 5-minute window. Possible denial-of-wallet attack.`,
          matchedEvents: tokenEvents,
        };
      }
      return null;
    },
  },
  {
    id: 'service_cascade',
    name: 'Service Cascade',
    description: 'Multiple services going offline within window = infrastructure issue',
    severity: 'CRITICAL',
    check(events) {
      const offlineEvents = events.filter(
        (e) => e.eventType === 'service_offline' || e.eventType === 'service_error',
      );
      // Require different services
      const uniqueServices = new Set(offlineEvents.map((e) => e.detail || e.agentId));
      if (uniqueServices.size >= 2) {
        return {
          description: `Service cascade detected: ${uniqueServices.size} services went offline within 5-minute window (${Array.from(uniqueServices).join(', ')})`,
          matchedEvents: offlineEvents,
        };
      }
      return null;
    },
  },
  {
    id: 'auth_storm',
    name: 'Auth Storm',
    description: 'Multiple failed auth events = brute force attempt',
    severity: 'HIGH',
    check(events) {
      const authFails = events.filter(
        (e) => e.eventType === 'auth_failure' || e.eventType === 'auth_denied',
      );
      if (authFails.length >= 3) {
        return {
          description: `Auth storm detected: ${authFails.length} failed authentication attempts within 5-minute window. Possible brute force.`,
          matchedEvents: authFails,
        };
      }
      return null;
    },
  },
  {
    id: 'drift_alert',
    name: 'Drift Alert',
    description: 'Workspace file changes + elevated shield detections = possible compromise',
    severity: 'HIGH',
    check(events) {
      const fileChanges = events.filter((e) => e.eventType === 'file_change' || e.eventType === 'workspace_drift');
      const shieldEvents = events.filter(
        (e) => e.source === 'shield' && (e.eventType === 'block' || e.eventType === 'review'),
      );
      if (fileChanges.length > 0 && shieldEvents.length > 0) {
        const combined = [...fileChanges, ...shieldEvents];
        return {
          description: `Drift alert: ${fileChanges.length} workspace file change(s) coinciding with ${shieldEvents.length} shield detection(s). Possible compromise.`,
          matchedEvents: combined,
        };
      }
      return null;
    },
  },
  {
    id: 'config_anomaly',
    name: 'Config Anomaly',
    description: 'Config changes correlating with security events = insider threat',
    severity: 'CRITICAL',
    check(events) {
      const configChanges = events.filter(
        (e) => e.eventType === 'config_change' || e.eventType === 'config_update',
      );
      const securityEvents = events.filter(
        (e) => e.source === 'shield' || e.eventType === 'auth_failure',
      );
      if (configChanges.length > 0 && securityEvents.length >= 2) {
        const combined = [...configChanges, ...securityEvents];
        return {
          description: `Config anomaly: ${configChanges.length} config change(s) correlating with ${securityEvents.length} security event(s). Possible insider threat.`,
          matchedEvents: combined,
        };
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Ingest an event into the correlation engine.
 * Prunes the sliding window, adds the event, and runs all correlation rules.
 */
export function ingestEvent(event: Omit<CorrelationEvent, 'id' | 'timestamp'> & { timestamp?: number }): void {
  const fullEvent: CorrelationEvent = {
    id: randomUUID(),
    ...event,
    timestamp: event.timestamp || Date.now(),
  };

  eventWindow.push(fullEvent);
  // Prune AFTER push so the size cap applies to the post-push array — a
  // single shift handles both age-out and overflow under load.
  pruneWindow();

  // Run correlation rules
  for (const rule of RULES) {
    try {
      const match = rule.check(eventWindow);
      if (!match) continue;

      // Deduplicate
      const dk = dedupKey(rule.id, match.matchedEvents);
      if (recentCorrelations.has(dk)) continue;
      recentCorrelations.add(dk);
      setTimeout(() => recentCorrelations.delete(dk), CORRELATION_DEDUP_MS);

      // Create correlation record
      const corrId = randomUUID();
      const now = new Date().toISOString();
      const sourceEvents = JSON.stringify(
        match.matchedEvents.map((e) => ({
          id: e.id,
          source: e.source,
          type: e.eventType,
          session: e.sessionId,
          agent: e.agentId,
          time: new Date(e.timestamp).toISOString(),
        })),
      );

      // Create alert
      const alert = createAlert(
        `Correlation: ${rule.name}`,
        match.description,
        rule.severity,
        'correlation-engine',
        { correlationId: corrId, rule: rule.id, eventCount: match.matchedEvents.length },
      );

      try {
        run(
          `INSERT INTO correlation_events (id, correlation_rule, source_events, description, severity, alert_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [corrId, rule.id, sourceEvents, match.description, rule.severity, alert.id, now],
        );
      } catch (dbErr) {
        console.error('[CorrelationEngine] DB write error:', dbErr);
      }

      // Broadcast
      broadcast('correlation_detected', {
        id: corrId,
        rule: rule.id,
        ruleName: rule.name,
        description: match.description,
        severity: rule.severity,
        eventCount: match.matchedEvents.length,
        alertId: alert.id,
        timestamp: now,
      });

      // Audit log
      logEvent(
        'clawnex',
        'correlation_detected',
        'correlation',
        corrId,
        `${rule.name}: ${match.matchedEvents.length} events correlated. Alert: ${alert.id}`,
        'correlation-engine',
      );

      console.log(`[CorrelationEngine] ${rule.name} detected: ${match.description}`);
    } catch (err) {
      console.error(`[CorrelationEngine] Rule ${rule.id} error:`, err);
    }
  }
}

/**
 * List correlations with optional filters.
 */
export function listCorrelations(filters?: CorrelationFilters): CorrelationRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.severity) {
    conditions.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters?.since) {
    conditions.push('created_at >= ?');
    params.push(filters.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 100;

  try {
    return queryAll<CorrelationRecord>(
      `SELECT * FROM correlation_events ${where} ORDER BY created_at DESC LIMIT ?`,
      [...params, limit],
    );
  } catch (err) {
    console.error('[CorrelationEngine] List error:', err);
    return [];
  }
}

/**
 * Get a single correlation by ID.
 */
export function getCorrelation(id: string): CorrelationRecord | undefined {
  try {
    return queryOne<CorrelationRecord>(
      'SELECT * FROM correlation_events WHERE id = ?',
      [id],
    );
  } catch (err) {
    console.error('[CorrelationEngine] Get error:', err);
    return undefined;
  }
}

/**
 * Get current window size (for diagnostics).
 */
export function getWindowSize(): number {
  pruneWindow();
  return eventWindow.length;
}
