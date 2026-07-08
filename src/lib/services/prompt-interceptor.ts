/**
 * ClawNex Prompt Shield Interceptor
 *
 * Hooks into the OpenClaw connector's event stream to scan every chat_event
 * through the full rule set. Logs results to shield_scans table and generates
 * alerts for BLOCK/REVIEW verdicts. Broadcasts shield events via SSE.
 *
 * This module is initialized once and runs in the background.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { shieldScan } from '../shield/scanner';
import { broadcast } from '../events';
import { run, queryAll, queryOne } from '../db/index';
import { createAlert } from './alert-manager';
import { logEvent } from './audit-logger';
import { ingestEvent } from './correlation-engine';
import type { ShieldScanResult } from '../types';
import { ORIGIN_PRODUCTION, productionOriginSqlClause } from '../dashboard/metric-semantics';
import { createReplayCase, createReviewQueueItem } from './shield-workflow';
import { getActiveInspectionProfile } from './shield-profiles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShieldScanRecord {
  id: string;
  direction: string;
  source_session_id: string | null;
  source_agent_id: string | null;
  content_hash: string;
  layers_triggered: string;
  threat_level: string;
  detail: string | null;
  scanned_at: string;
}

export interface ShieldStats {
  total: number;
  blocked: number;
  reviewed: number;
  allowed: number;
  period: string;
}

// ---------------------------------------------------------------------------
// Core interceptor
// ---------------------------------------------------------------------------

/**
 * Process a chat event through the Prompt Shield and log results.
 * Called from the OpenClaw connector's event handler.
 */
export function interceptChatEvent(payload: Record<string, unknown>): ShieldScanResult | null {
  const content = (payload.content as string) || (payload.message as string) || '';
  if (!content || content.length === 0) return null;

  const sessionId = (payload.sessionId as string) || (payload.session_id as string) || null;
  const agentId = (payload.agentId as string) || (payload.agent_id as string) || null;

  try {
    const result = shieldScan(content, { includeRedacted: false });
    const activeProfile = getActiveInspectionProfile();

    // Store in shield_scans table
    const scanId = randomUUID();
    const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const layersTriggered = result.stats.categories.join(',');

    try {
      run(
        `INSERT INTO shield_scans (id, direction, source_session_id, source_agent_id, content_hash, layers_triggered, threat_level, detail, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scanId,
          'inbound',
          sessionId,
          agentId,
          contentHash,
          layersTriggered || 'none',
          result.verdict,
          // origin = production: this path handles real chat traffic
          // intercepted from the OpenClaw event stream. Shield Tests use a
          // separate code path (/api/shield/scan) and tag origin='shield-test'.
          JSON.stringify({
            origin: ORIGIN_PRODUCTION,
            score: result.score,
            detections: result.detections.length,
            elapsed: result.elapsed,
            stats: result.stats,
          }),
          new Date().toISOString(),
        ],
      );
    } catch (dbErr) {
      console.error('[PromptInterceptor] DB write error:', dbErr);
    }

    try {
      createReplayCase({
        text: content,
        sourceType: 'shield_scan',
        sourceId: scanId,
        original: result,
        actor: 'clawnex',
      });
      createReviewQueueItem({
        sourceType: 'shield_scan',
        sourceId: scanId,
        verdict: result.verdict,
        score: result.score,
        detections: result.detections,
        summary: `OpenClaw Shield REVIEW: ${result.detections[0]?.name || 'Suspicious content'}`,
        profileId: activeProfile.id,
      });
    } catch (workflowErr) {
      console.error('[PromptInterceptor] workflow write error:', workflowErr);
    }

    // Generate alerts for BLOCK/REVIEW verdicts. Production origin so they
    // count toward Fleet/sidebar/header active-alert badges.
    if (result.verdict === 'BLOCK') {
      createAlert(
        `Shield BLOCK: ${result.detections[0]?.name || 'Threat detected'}`,
        `Chat content blocked by Prompt Shield. Score: ${result.score}, Detections: ${result.detections.length}. Session: ${sessionId || 'unknown'}`,
        'CRITICAL',
        'shield',
        undefined,
        ORIGIN_PRODUCTION,
      );
    } else if (result.verdict === 'REVIEW') {
      createAlert(
        `Shield REVIEW: ${result.detections[0]?.name || 'Suspicious content'}`,
        `Chat content flagged for review by Prompt Shield. Score: ${result.score}, Detections: ${result.detections.length}. Session: ${sessionId || 'unknown'}`,
        'HIGH',
        'shield',
        undefined,
        ORIGIN_PRODUCTION,
      );
    }

    // Broadcast shield scan event via SSE
    broadcast('shield_scan', {
      scanId,
      sessionId,
      agentId,
      verdict: result.verdict,
      score: result.score,
      detections: result.detections.length,
      categories: result.stats.categories,
      elapsed: result.elapsed,
      timestamp: new Date().toISOString(),
    });

    // Feed into correlation engine
    if (result.verdict !== 'ALLOW') {
      ingestEvent({
        source: 'shield',
        eventType: result.verdict.toLowerCase(),
        sessionId: sessionId || undefined,
        agentId: agentId || undefined,
        severity: result.verdict === 'BLOCK' ? 'CRITICAL' : 'HIGH',
        detail: `Score: ${result.score}, Detections: ${result.detections.length}`,
        metadata: { score: result.score, detections: result.detections.length, categories: result.stats.categories },
      });
    }

    // Audit log
    if (result.verdict !== 'ALLOW') {
      logEvent(
        'clawnex',
        `shield_${result.verdict.toLowerCase()}`,
        'chat',
        sessionId || undefined,
        `Score: ${result.score}, Detections: ${result.detections.length}`,
        'shield',
      );
    }

    return result;
  } catch (err) {
    console.error('[PromptInterceptor] Scan error:', err);
    return null;
  }
}

/**
 * Get shield scan statistics over a time window.
 *
 * Provenance (Phase 2a): by default excludes test-generated scans (origin =
 * shield-test/demo/qa) so a Shield Tests run doesn't pollute the
 * dashboard's "Shield Blocks" badge. Pass `includeTestGenerated: true` for
 * audit/lab views (e.g. the Shield Tests panel showing its own history).
 * Legacy records without an origin set are treated as production.
 */
export function getShieldStats(
  sinceParam?: string,
  opts?: { includeTestGenerated?: boolean },
): ShieldStats {
  const since = sinceParam || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const includeTest = Boolean(opts?.includeTestGenerated);
  const prodFilter = includeTest ? '' : ` AND ${productionOriginSqlClause('detail')}`;

  try {
    const total = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ?${prodFilter}`,
      [since],
    );
    const blocked = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ? AND threat_level = 'BLOCK'${prodFilter}`,
      [since],
    );
    const reviewed = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ? AND threat_level = 'REVIEW'${prodFilter}`,
      [since],
    );
    const allowed = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ? AND threat_level = 'ALLOW'${prodFilter}`,
      [since],
    );

    return {
      total: total?.cnt ?? 0,
      blocked: blocked?.cnt ?? 0,
      reviewed: reviewed?.cnt ?? 0,
      allowed: allowed?.cnt ?? 0,
      period: sinceParam ? 'custom' : '24h',
    };
  } catch (err) {
    console.error('[PromptInterceptor] Stats query error:', err);
    return { total: 0, blocked: 0, reviewed: 0, allowed: 0, period: sinceParam ? 'custom' : '24h' };
  }
}

// ---------------------------------------------------------------------------
// Hour-bucketed stats (added for Mission Control Detection Trend, Item #1)
// ---------------------------------------------------------------------------

export interface ShieldHourBucket {
  hour: string;   // ISO-8601 hour string e.g. "2026-05-05T14:00:00Z"
  total: number;
  allowed: number;
  reviewed: number;
  blocked: number;
}

/**
 * Return per-hour counts for the [sinceMs, untilMs] window.
 *
 * SQLite does not have date_trunc() — strftime('%Y-%m-%dT%H:00:00Z', …) is
 * the equivalent on a UTC-stored ISO-8601 scanned_at column. The GROUP BY
 * operates on that computed string so every row in a given hour collapses to
 * one bucket.
 *
 * Rows are returned in ascending order (oldest first) so the caller can feed
 * them directly into an SVG polyline without sorting.
 */
export function getShieldStatsHourly(
  sinceMs: number,
  untilMs: number,
  opts?: { includeTestGenerated?: boolean },
): ShieldHourBucket[] {
  const since = new Date(sinceMs).toISOString();
  const until = new Date(untilMs).toISOString();
  const includeTest = Boolean(opts?.includeTestGenerated);
  const prodFilter = includeTest ? '' : ` AND ${productionOriginSqlClause('detail')}`;

  try {
    // One query: GROUP BY hour, count by threat_level with conditional sums.
    // Using SUM(CASE …) is standard SQL and works in both SQLite and Postgres.
    const rows = queryAll<{
      hour: string;
      total: number;
      allowed: number;
      reviewed: number;
      blocked: number;
    }>(
      `SELECT
         strftime('%Y-%m-%dT%H:00:00Z', scanned_at) AS hour,
         COUNT(*)                                      AS total,
         SUM(CASE WHEN threat_level = 'ALLOW' THEN 1 ELSE 0 END) AS allowed,
         SUM(CASE WHEN threat_level = 'REVIEW' THEN 1 ELSE 0 END) AS reviewed,
         SUM(CASE WHEN threat_level = 'BLOCK'  THEN 1 ELSE 0 END) AS blocked
       FROM shield_scans
       WHERE scanned_at >= ?
         AND scanned_at <= ?
         ${prodFilter}
       GROUP BY hour
       ORDER BY hour ASC`,
      [since, until],
    );
    return rows.map((r) => ({
      hour: r.hour,
      total: Number(r.total),
      allowed: Number(r.allowed),
      reviewed: Number(r.reviewed),
      blocked: Number(r.blocked),
    }));
  } catch (err) {
    console.error('[PromptInterceptor] Hourly stats query error:', err);
    return [];
  }
}

/**
 * Get recent shield scan history.
 *
 * Provenance (Phase 2a-fix): mirrors getShieldStats — by default excludes
 * test-generated scans (origin = shield-test/demo/qa) so the Shield History
 * feed and instance-filtered shield-stats path don't leak test/demo records
 * into operator-facing views. Pass `includeTestGenerated: true` for audit
 * surfaces that explicitly want to see test runs (e.g. the Welcome Wizard's
 * first-shield-test signal). Legacy records without an origin set are
 * treated as production.
 */
export function getShieldHistory(
  limit = 50,
  since?: string,
  opts?: { includeTestGenerated?: boolean },
): ShieldScanRecord[] {
  const includeTest = Boolean(opts?.includeTestGenerated);
  const prodFilter = includeTest ? '' : ` AND ${productionOriginSqlClause('detail')}`;

  try {
    if (since) {
      return queryAll<ShieldScanRecord>(
        `SELECT * FROM shield_scans WHERE scanned_at >= ?${prodFilter} ORDER BY scanned_at DESC LIMIT ?`,
        [since, limit],
      );
    }
    return queryAll<ShieldScanRecord>(
      `SELECT * FROM shield_scans WHERE 1=1${prodFilter} ORDER BY scanned_at DESC LIMIT ?`,
      [limit],
    );
  } catch (err) {
    console.error('[PromptInterceptor] History query error:', err);
    return [];
  }
}
