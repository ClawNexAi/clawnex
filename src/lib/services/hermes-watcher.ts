/**
 * Hermes Agent Message Watcher
 *
 * Polls Hermes state.db messages table for new entries, shield-scans each one,
 * and logs results to proxy_traffic with source='hermes-watcher'.
 *
 * Mirrors the session-watcher pattern but reads from Hermes's SQLite database
 * instead of OpenClaw's JSONL session files. Each message is scanned through
 * the shield and generates alerts for BLOCK/REVIEW verdicts.
 *
 * READ-ONLY access to ~/.hermes/state.db — never writes to Hermes data.
 *
 * @module services/hermes-watcher
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import { getHermesDb, getHermesHome, isHermesAvailable } from './hermes-db';
import { shieldScan, outboundScan, getPersistedWhitelist } from '../shield/scanner';
import { queryOne, run } from '../db/index';
import { broadcast } from '../events';
import { createAlert } from './alert-manager';
import { recordShieldEvidence } from './shield-evidence';
import { ingestEvent } from './correlation-engine';
import type { ShieldScanResult } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HermesMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  timestamp: string | number | null;
  finish_reason: string | null;
  model: string | null;
  platform: string | null;
  title: string | null;
  billing_provider: string | null;
}

export interface HermesWatcherStats {
  running: boolean;
  messagesScanned: number;
  lastScanTime: string | null;
  errors: number;
  hermesAvailable: boolean;
  lastProcessedId: number;
  sourceId: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let lastProcessedMessageId = 0;
let messagesScanned = 0;
let lastScanTime: string | null = null;
let errorCount = 0;

function hermesSourceId(): string {
  const homeHash = crypto.createHash('sha256').update(getHermesHome()).digest('hex').slice(0, 12);
  return `hermes:home:${homeHash}`;
}

function sourceSegment(value: string | null | undefined, fallback: string): string {
  const segment = (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return segment || fallback;
}

function activeHermesProfileName(): string | null {
  try {
    const profile = fs.readFileSync(path.join(getHermesHome(), 'active_profile'), 'utf8').trim();
    return profile || null;
  } catch {
    return null;
  }
}

function hermesEventSourceId(row: HermesMessageRow): string {
  const profile = sourceSegment(activeHermesProfileName(), 'unknown-profile');
  const channel = sourceSegment(row.platform, 'unknown-channel');
  return `hermes:profile:${profile}:channel:${channel}`;
}

function coerceHermesTimestamp(value: string | number | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = asNumber > 10_000_000_000 ? asNumber : asNumber * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readPersistedCursor(): number | null {
  try {
    const row = queryOne<{ last_message_id: number }>(
      "SELECT last_message_id FROM hermes_ingest_cursors WHERE source_id = ?",
      [hermesSourceId()],
    );
    if (row && Number.isFinite(row.last_message_id)) return Number(row.last_message_id);
  } catch (err) {
    console.warn('[HermesWatcher] Failed to read persisted cursor:', err instanceof Error ? err.message : err);
  }
  return null;
}

function updatePersistedCursor(messageId: number, messageTimestamp: string | null, lastError: string | null = null): void {
  try {
    run(
      `INSERT INTO hermes_ingest_cursors (source_id, home_path, last_message_id, last_message_timestamp, last_ingested_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'))
       ON CONFLICT(source_id) DO UPDATE SET
         home_path = excluded.home_path,
         last_message_id = excluded.last_message_id,
         last_message_timestamp = excluded.last_message_timestamp,
         last_ingested_at = excluded.last_ingested_at,
         last_error = excluded.last_error,
         updated_at = datetime('now')`,
      [hermesSourceId(), getHermesHome(), messageId, messageTimestamp, lastError],
    );
  } catch (err) {
    console.error('[HermesWatcher] Failed to persist cursor:', err);
    errorCount++;
  }
}

function persistHermesEvent(row: HermesMessageRow, opts: {
  direction: string;
  platform: string;
  promptHash: string;
  scanResult: ShieldScanResult;
  trafficId: string;
}): void {
  try {
    const eventSourceId = hermesEventSourceId(row);
    run(
      `INSERT OR REPLACE INTO hermes_events
         (id, source_id, message_id, session_id, role, direction, platform, model, content_hash,
          shield_verdict, shield_score, detections_count, traffic_id, message_timestamp, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        `${eventSourceId}:${row.id}`,
        eventSourceId,
        row.id,
        row.session_id,
        row.role,
        opts.direction,
        opts.platform,
        row.model,
        opts.promptHash,
        opts.scanResult.verdict,
        opts.scanResult.score,
        opts.scanResult.detections.length,
        opts.trafficId,
        coerceHermesTimestamp(row.timestamp),
      ],
    );
  } catch (err) {
    console.error('[HermesWatcher] Failed to persist normalized Hermes event:', err);
    errorCount++;
  }
}

// ---------------------------------------------------------------------------
// Provider detection from Hermes model format (provider/model)
// ---------------------------------------------------------------------------

function detectProvider(model: string | null): string {
  if (!model) return 'unknown';
  // Hermes uses provider/model format like openai/gpt-5.4
  const slashIdx = model.indexOf('/');
  if (slashIdx > 0) return model.slice(0, slashIdx);
  // Fallback heuristic
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  if (model.startsWith('gemini')) return 'google';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Process a single Hermes message
// ---------------------------------------------------------------------------

function processMessage(row: HermesMessageRow): void {
  const content = row.content;
  if (!content || content.trim().length === 0) return;

  const direction = row.role === 'user' ? 'inbound' : 'outbound';
  const provider = detectProvider(row.model);
  const sessionId = row.session_id;
  const platform = row.platform || 'unknown';

  // Shield scan — apply whitelist for internal traffic
  let scanResult: ShieldScanResult;
  try {
    scanResult = direction === 'inbound'
      ? shieldScan(content, { whitelistRules: getPersistedWhitelist() })
      : outboundScan(content);
  } catch (err) {
    console.error('[HermesWatcher] Shield scan error:', err);
    errorCount++;
    return;
  }

  messagesScanned++;
  lastScanTime = new Date().toISOString();

  const promptHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  const trafficId = uuid();

  // Log to proxy_traffic (fire-and-forget)
  try {
    run(
      `INSERT INTO proxy_traffic (id, timestamp, direction, model, provider, upstream_url, prompt_hash, messages_count, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, shield_verdict, shield_score, shield_detections, blocked, block_reason, session_id, status_code, error, source)
       VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trafficId,
        direction,
        row.model,
        provider,
        `hermes:${platform}`,
        promptHash,
        1,
        null, // input_tokens — not available per-message from Hermes
        null, // output_tokens
        null, // total_tokens
        null, // cost_usd
        null, // latency not available
        scanResult.verdict,
        scanResult.score,
        JSON.stringify(scanResult.detections),
        0, // can't block retroactively
        null,
        sessionId,
        null,
        null,
        'hermes-watcher',
      ],
    );
  } catch (err) {
    console.error('[HermesWatcher] DB write error:', err);
    errorCount++;
  }

  // Broadcast via SSE (fire-and-forget)
  try {
    broadcast('proxy_traffic', {
      id: trafficId,
      direction,
      model: row.model,
      provider,
      upstream_url: `hermes:${platform}`,
      shield_verdict: scanResult.verdict,
      shield_score: scanResult.score,
      shield_detections: scanResult.detections,
      blocked: 0,
      session_id: sessionId,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      cost_usd: null,
      source: 'hermes-watcher',
      timestamp: new Date().toISOString(),
    });
  } catch { /* ignore */ }

  persistHermesEvent(row, {
    direction,
    platform,
    promptHash,
    scanResult,
    trafficId,
  });

  const alertEvidence = scanResult.verdict !== 'ALLOW'
    ? recordShieldEvidence({
        actor: 'hermes-watcher',
        action: scanResult.verdict === 'BLOCK' ? 'shield_detected' : 'shield_review',
        auditSource: 'hermes-watcher',
        resourceType: 'session',
        resourceId: sessionId,
        content,
        scanResult,
        direction,
        promptHash,
        proxyTrafficId: trafficId,
        sessionId,
        model: row.model,
        provider,
        summaryContext: { Platform: platform },
      }).alertMetadata
    : undefined;

  // Generate alerts for BLOCK/REVIEW verdicts
  if (scanResult.verdict === 'BLOCK') {
    const alertSeverity = scanResult.score >= 80 ? 'CRITICAL' : scanResult.score >= 60 ? 'HIGH' : 'MEDIUM';
    createAlert(
      `Hermes Shield BLOCK: ${scanResult.detections[0]?.name || 'Threat detected'}`,
      `Hermes message blocked by Shield. Score: ${scanResult.score}, Detections: ${scanResult.detections.length}. Session: ${sessionId}, Direction: ${direction}, Model: ${row.model || 'unknown'}, Platform: ${platform}`,
      alertSeverity,
      'hermes-watcher',
      alertEvidence,
    );
  } else if (scanResult.verdict === 'REVIEW') {
    const alertSeverity = scanResult.score >= 50 ? 'HIGH' : scanResult.score >= 25 ? 'MEDIUM' : 'LOW';
    createAlert(
      `Hermes Shield REVIEW: ${scanResult.detections[0]?.name || 'Suspicious content'}`,
      `Hermes message flagged for review. Score: ${scanResult.score}, Detections: ${scanResult.detections.length}. Session: ${sessionId}, Direction: ${direction}, Model: ${row.model || 'unknown'}, Platform: ${platform}`,
      alertSeverity,
      'hermes-watcher',
      alertEvidence,
    );
  }

  // Feed into correlation engine for non-ALLOW verdicts
  if (scanResult.verdict !== 'ALLOW') {
    ingestEvent({
      source: 'hermes-watcher',
      eventType: scanResult.verdict.toLowerCase(),
      sessionId,
      severity: scanResult.score >= 80 ? 'CRITICAL' : scanResult.score >= 60 ? 'HIGH' : scanResult.score >= 25 ? 'MEDIUM' : 'LOW',
      detail: `Score: ${scanResult.score}, Detections: ${scanResult.detections.length}, Direction: ${direction}, Platform: ${platform}`,
      metadata: {
        score: scanResult.score,
        detections: scanResult.detections.length,
        categories: scanResult.stats.categories,
        model: row.model,
        direction,
        platform,
      },
    });
  }

}

// ---------------------------------------------------------------------------
// Initialization & Polling
// ---------------------------------------------------------------------------

/**
 * Initialize the watcher — find the highest existing message ID to start from.
 */
export function initializeHermesWatcher(): void {
  const db = getHermesDb();
  if (!db) return;

  try {
    const persistedCursor = readPersistedCursor();
    if (persistedCursor !== null) {
      lastProcessedMessageId = persistedCursor;
      console.log(`[HermesWatcher] Initialized — restored persisted cursor at message ID ${lastProcessedMessageId}`);
      return;
    }

    const row = db.prepare("SELECT MAX(id) as maxId, MAX(timestamp) as maxTimestamp FROM messages").get() as { maxId: number | null; maxTimestamp: string | null } | undefined;
    lastProcessedMessageId = row?.maxId ?? 0;
    updatePersistedCursor(lastProcessedMessageId, coerceHermesTimestamp(row?.maxTimestamp ?? null));
    console.log(`[HermesWatcher] Initialized — starting from message ID ${lastProcessedMessageId}`);
  } catch (err) {
    console.error('[HermesWatcher] Failed to initialize:', err);
    errorCount++;
  }
}

/**
 * Poll for new messages since lastProcessedMessageId.
 */
export function pollHermesMessages(): void {
  const db = getHermesDb();
  if (!db) return;

  try {
    const rows = db.prepare(
      `SELECT m.id, m.session_id, m.role, m.content, m.tool_calls,
              m.timestamp, m.finish_reason,
              s.model, s.source AS platform, s.title, s.billing_provider
       FROM messages m
       JOIN sessions s ON m.session_id = s.id
       WHERE m.id > ?
         AND m.role IN ('user', 'assistant')
         AND m.content IS NOT NULL AND LENGTH(m.content) > 0
       ORDER BY m.id ASC
       LIMIT 100`
    ).all(lastProcessedMessageId) as HermesMessageRow[];

    for (const row of rows) {
      processMessage(row);
      lastProcessedMessageId = row.id;
      updatePersistedCursor(row.id, coerceHermesTimestamp(row.timestamp));
    }
  } catch (err) {
    console.error('[HermesWatcher] Poll error:', err);
    errorCount++;
    updatePersistedCursor(lastProcessedMessageId, null, err instanceof Error ? err.message : 'Hermes poll error');
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function getHermesWatcherStats(): HermesWatcherStats {
  return {
    running: false, // overridden by runner
    messagesScanned,
    lastScanTime,
    errors: errorCount,
    hermesAvailable: isHermesAvailable(),
    lastProcessedId: lastProcessedMessageId,
    sourceId: hermesSourceId(),
  };
}

/**
 * Reset state (for testing).
 */
export function resetHermesWatcher(): void {
  lastProcessedMessageId = 0;
  messagesScanned = 0;
  lastScanTime = null;
  errorCount = 0;
}
