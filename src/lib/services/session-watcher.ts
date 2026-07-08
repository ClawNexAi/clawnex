/**
 * ClawNex Session Log Watcher
 *
 * Monitors OpenClaw's JSONL session files for new messages and scans them
 * through the 163-detection shield (plus any operator-authored custom rules). Logs results to proxy_traffic table and
 * generates alerts for BLOCK/REVIEW verdicts.
 *
 * READ-ONLY access to ~/.openclaw/ — never writes to session files.
 * This is critical for trust: operators need assurance that ClawNex
 * observes but doesn't tamper with agent conversations.
 *
 * How it works:
 * 1. On startup, indexes all .jsonl files in ~/.openclaw/agents/* /sessions/
 * 2. Every 10 seconds (configurable), checks for new files and new lines
 * 3. For each new message, extracts text content and runs shieldScan()
 * 4. Results logged to proxy_traffic with source: "session-watcher"
 * 5. BLOCK/REVIEW verdicts generate alerts via alert-manager
 *
 * Scans ALL agent session directories (not just main) — covers the full fleet.
 * Internal traffic whitelist is applied automatically to suppress false positives
 * from legitimate system prompts (SOUL.md, MEMORY.md, etc.).
 *
 * Tables: proxy_traffic (writes), alerts (on BLOCK/REVIEW)
 *
 * @module services/session-watcher
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { config } from '../config';
import { shieldScan, outboundScan, getPersistedWhitelist, redact } from '../shield/scanner';
import { run, queryAll } from '../db/index';
import { broadcast } from '../events';
import { createAlert } from './alert-manager';
import { logEvent } from './audit-logger';
import { ingestEvent } from './correlation-engine';
import { sanitizeLogField } from '../security/log-sanitize';
import { createReplayCase, createReviewQueueItem } from './shield-workflow';
import { getActiveInspectionProfile } from './shield-profiles';
import type { ShieldScanResult } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionMessage {
  type: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      totalTokens?: number;
      cost?: {
        total?: number;
      };
    };
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

export interface WatcherStats {
  running: boolean;
  filesWatched: number;
  messagesScanned: number;
  lastScanTime: string | null;
  errors: number;
  sessionsDirectory: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Byte offsets for each tracked file */
const fileOffsets = new Map<string, number>();

/** Cumulative stats */
let messagesScanned = 0;
let lastScanTime: string | null = null;
let errorCount = 0;

const OPEN_READ_NOFOLLOW = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function extractTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    } else if (block.type === 'thinking' && block.thinking) {
      parts.push(block.thinking);
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Provider detection from model name
// ---------------------------------------------------------------------------

function detectProvider(model: string | undefined): string {
  if (!model) return 'unknown';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  if (model.startsWith('gemini')) return 'google';
  if (model.startsWith('qwen')) return 'lmstudio';
  if (model.startsWith('llama') || model.startsWith('meta-')) return 'meta';
  if (model.startsWith('mistral') || model.startsWith('mixtral')) return 'mistral';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Process a single parsed session entry
// ---------------------------------------------------------------------------

function processEntry(entry: SessionMessage, sessionFilename: string): void {
  if (entry.type !== 'message' || !entry.message) return;

  const role = entry.message.role;
  if (role !== 'user' && role !== 'assistant') return;

  const content = extractTextContent(entry.message.content);
  if (!content || content.trim().length === 0) return;

  // Skip internal routing/delivery messages that aren't real model traffic
  const model = entry.message.model || null;
  if (model === 'delivery-mirror' || model === 'delivery') return;

  const direction = role === 'user' ? 'inbound' : 'outbound';
  const provider = detectProvider(model ?? undefined);
  const sessionId = path.basename(sessionFilename, '.jsonl');

  // Token and cost data
  const usage = entry.message.usage;
  const inputTokens = usage?.input ?? null;
  const outputTokens = usage?.output ?? null;
  const totalTokens = usage?.totalTokens ?? null;
  const costUsd = usage?.cost?.total ?? null;

  // Shield scan — apply whitelist for internal agent traffic (same as LiteLLM path)
  let scanResult: ShieldScanResult;
  try {
    scanResult = direction === 'inbound'
      ? shieldScan(content, { whitelistRules: getPersistedWhitelist() })
      : outboundScan(content);
  } catch (err) {
    console.error('[SessionWatcher] Shield scan error', {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
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
        model,
        provider,
        'session-log',
        promptHash,
        1,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        null, // latency not available for log-based scanning
        scanResult.verdict,
        scanResult.score,
        JSON.stringify(scanResult.detections),
        0, // can't block retroactively
        null,
        sessionId,
        null,
        null,
        'session-watcher',
      ],
    );
  } catch (err) {
    console.error('[SessionWatcher] DB write error', {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
    errorCount++;
  }

  try {
    const activeProfile = getActiveInspectionProfile();
    createReplayCase({
      text: content,
      sourceType: 'proxy_traffic',
      sourceId: trafficId,
      original: scanResult,
      actor: 'session-watcher',
    });
    createReviewQueueItem({
      sourceType: 'proxy_traffic',
      sourceId: trafficId,
      verdict: scanResult.verdict,
      score: scanResult.score,
      detections: scanResult.detections,
      summary: `Session Shield REVIEW: ${scanResult.detections[0]?.name || 'Suspicious content'}`,
      profileId: activeProfile.id,
    });
  } catch (workflowErr) {
    console.error('[SessionWatcher] workflow write error', {
      error: workflowErr instanceof Error ? sanitizeLogField(workflowErr.message) : sanitizeLogField(workflowErr),
    });
  }

  // Broadcast via SSE (fire-and-forget)
  try {
    broadcast('proxy_traffic', {
      id: trafficId,
      direction,
      model,
      provider,
      upstream_url: 'session-log',
      shield_verdict: scanResult.verdict,
      shield_score: scanResult.score,
      shield_detections: scanResult.detections,
      blocked: 0,
      session_id: sessionId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cost_usd: costUsd,
      source: 'session-watcher',
      timestamp: new Date().toISOString(),
    });
  } catch { /* ignore */ }

  // Audit + alert path for non-ALLOW verdicts. Order matters here:
  //   1. Build a privacy-preserving payload_excerpt (redact() applied).
  //   2. Persist the audit event FIRST so we can capture audit_event_id.
  //   3. Emit createAlert with metadata={audit_event_id, ...} so the UI
  //      can deep-link directly without fallback correlation.
  //   4. Feed the correlation engine.
  //
  // payload_excerpt strategy (privacy + match-centering):
  //   - Apply redact() to strip emails / phones / SSNs / CCs / IPs from
  //     non-matched regions (the matched samples themselves are emitted
  //     by the scanner with rule-specific partial redaction already).
  //   - If the redacted payload is small (<= 4KB), keep it whole.
  //   - Otherwise capture the first 2KB + last 2KB. Detection samples
  //     are still searchable inside that window for the API-side
  //     match-centering pass.
  //
  // Sensitive token surfacing rule (per operator brief): operator must be
  // able to confirm what triggered the alert. The detection.samples are
  // already partially redacted at scan time; the surrounding excerpt is
  // run through redact() so we never store raw secondary PII alongside.
  let auditEventId: string | null = null;
  if (scanResult.verdict !== 'ALLOW') {
    const auditAction = scanResult.verdict === 'BLOCK' ? 'shield_detected' : 'shield_review';

    const redactedPayload = redact(content);
    const MAX_EXCERPT = 4096;
    const payloadExcerpt = redactedPayload.length <= MAX_EXCERPT
      ? redactedPayload
      : redactedPayload.slice(0, MAX_EXCERPT / 2) + '\n…[truncated]…\n' + redactedPayload.slice(-MAX_EXCERPT / 2);

    // Structured JSON detail so the /api/alerts/:id/evidence endpoint can
    // parse it cleanly. Also keep the original human-readable summary at
    // the top via `summary` for the existing AuditEvidence list rendering
    // (which shows `detail` directly when no JSON-aware viewer is wired up).
    const detectionNames = scanResult.detections.slice(0, 5).map(d => d.name).join(', ');
    const detailObj = {
      summary: `Direction: ${direction} | Score: ${scanResult.score} | Verdict: ${scanResult.verdict} | Model: ${model || 'unknown'} | Detections: ${detectionNames}`,
      shield_detections: scanResult.detections,
      prompt_hash: promptHash,
      payload_excerpt: payloadExcerpt,
      payload_excerpt_truncated: redactedPayload.length > MAX_EXCERPT,
      payload_total_length: content.length,
      proxy_traffic_id: trafficId,
      session_id: sessionId,
      model,
      provider,
      direction,
      verdict: scanResult.verdict,
      score: scanResult.score,
    };

    const auditRec = logEvent(
      'session-watcher',
      auditAction,
      'session',
      sessionId,
      JSON.stringify(detailObj),
      'session-watcher',
    );
    auditEventId = auditRec.id;
  }

  // Generate alerts for BLOCK/REVIEW verdicts — severity mapped from shield score.
  // metadata carries audit_event_id (forward link, primary path) plus the rest of the
  // shield context so the EvidencePanel / API endpoint can render without re-querying
  // the audit row when the operator only needs the headline fields.
  if (scanResult.verdict === 'BLOCK' || scanResult.verdict === 'REVIEW') {
    const alertMetadata: Record<string, unknown> = {
      audit_event_id: auditEventId,
      source_event_id: trafficId,
      session_id: sessionId,
      direction,
      model,
      provider,
      verdict: scanResult.verdict,
      score: scanResult.score,
      detection_count: scanResult.detections.length,
      primary_rule_key: scanResult.detections[0]?.rule_key ?? scanResult.detections[0]?.id ?? null,
      primary_rule_name: scanResult.detections[0]?.name ?? null,
    };

    if (scanResult.verdict === 'BLOCK') {
      const alertSeverity = scanResult.score >= 80 ? 'CRITICAL' : scanResult.score >= 60 ? 'HIGH' : 'MEDIUM';
      createAlert(
        `Session Shield BLOCK: ${scanResult.detections[0]?.name || 'Threat detected'}`,
        `Session log content blocked by Shield. Score: ${scanResult.score}, Detections: ${scanResult.detections.length}. Session: ${sessionId}, Direction: ${direction}, Model: ${model || 'unknown'}`,
        alertSeverity,
        'session-watcher',
        alertMetadata,
      );
    } else {
      const alertSeverity = scanResult.score >= 50 ? 'HIGH' : scanResult.score >= 25 ? 'MEDIUM' : 'LOW';
      createAlert(
        `Session Shield REVIEW: ${scanResult.detections[0]?.name || 'Suspicious content'}`,
        `Session log content flagged for review. Score: ${scanResult.score}, Detections: ${scanResult.detections.length}. Session: ${sessionId}, Direction: ${direction}, Model: ${model || 'unknown'}`,
        alertSeverity,
        'session-watcher',
        alertMetadata,
      );
    }
  }

  // Feed into correlation engine for non-ALLOW verdicts
  if (scanResult.verdict !== 'ALLOW') {
    ingestEvent({
      source: 'session-watcher',
      eventType: scanResult.verdict.toLowerCase(),
      sessionId,
      severity: scanResult.score >= 80 ? 'CRITICAL' : scanResult.score >= 60 ? 'HIGH' : scanResult.score >= 25 ? 'MEDIUM' : 'LOW',
      detail: `Score: ${scanResult.score}, Detections: ${scanResult.detections.length}, Direction: ${direction}`,
      metadata: {
        score: scanResult.score,
        detections: scanResult.detections.length,
        categories: scanResult.stats.categories,
        model,
        direction,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/**
 * Initialize offsets for all existing files — start from the end
 * but read the last N lines to catch very recent messages.
 */
export function initializeOffsets(): void {
  const sessionsDir = config.sessionWatcher.path;

  let files: string[];
  try {
    files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
  } catch (err) {
    console.error('[SessionWatcher] Cannot read sessions directory', {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
    return;
  }

  for (const file of files) {
    const fullPath = path.join(sessionsDir, file);
    try {
      const fd = fs.openSync(fullPath, OPEN_READ_NOFOLLOW);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) continue;
        const fileSize = stat.size;

        // Read the tail of the file (last ~8KB) to catch recent messages
        const tailBytes = Math.min(fileSize, 8192);
        const startOffset = Math.max(0, fileSize - tailBytes);

        const buffer = Buffer.alloc(tailBytes);
        fs.readSync(fd, buffer, 0, tailBytes, startOffset);
        const tailText = buffer.toString('utf-8');

        // Split into lines, skip partial first line if we started mid-file
        const lines = tailText.split('\n').filter((l) => l.trim().length > 0);
        const startIdx = startOffset > 0 ? 1 : 0; // skip partial first line
        const recentLines = lines.slice(startIdx).slice(-10); // last 10 lines

        for (const line of recentLines) {
          try {
            const entry = JSON.parse(line) as SessionMessage;
            processEntry(entry, file);
          } catch {
            // Skip malformed JSON
          }
        }

        // Set offset to end of file so we don't re-scan
        fileOffsets.set(file, fileSize);
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      console.error("[SessionWatcher] Error initializing file", {
        file: sanitizeLogField(file),
        error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
      });
      errorCount++;
    }
  }

  console.log(`[SessionWatcher] Initialized with ${files.length} files tracked`);
}

/**
 * Poll for changes in all session files across ALL agent directories.
 * Reads only new bytes since last offset.
 */
export function pollFiles(): void {
  // Scan all agent directories for session files
  const agentsRoot = (config.sessionWatcher as { agentsRoot?: string }).agentsRoot || path.join(os.homedir(), '.openclaw', 'agents');
  const allFiles: Array<{ file: string; fullPath: string; agentId: string }> = [];

  try {
    const agents = fs.readdirSync(agentsRoot);
    for (const agentId of agents) {
      const sessDir = path.join(agentsRoot, agentId, 'sessions');
      try {
        const sessFiles = fs.readdirSync(sessDir).filter((f: string) => f.endsWith('.jsonl'));
        for (const f of sessFiles) {
          allFiles.push({ file: `${agentId}/${f}`, fullPath: path.join(sessDir, f), agentId });
        }
      } catch {}
    }
  } catch {
    // Fallback to legacy single-directory mode
    const sessionsDir = config.sessionWatcher.path;
    try {
      const files = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl'));
      for (const f of files) {
        allFiles.push({ file: f, fullPath: path.join(sessionsDir, f), agentId: 'main' });
      }
    } catch (err) {
      console.error('[SessionWatcher] Cannot read sessions directory', {
        error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
      });
      errorCount++;
      return;
    }
  }

  // Detect deleted files — remove from tracker
  const currentFileKeys = new Set(allFiles.map(f => f.file));
  const trackedFiles = Array.from(fileOffsets.keys());
  for (const tracked of trackedFiles) {
    if (!currentFileKeys.has(tracked)) {
      fileOffsets.delete(tracked);
    }
  }

  for (const { file, fullPath } of allFiles) {

    let fd: number;
    let stat: fs.Stats;
    try {
      fd = fs.openSync(fullPath, OPEN_READ_NOFOLLOW);
      stat = fs.fstatSync(fd);
      if (!stat.isFile()) {
        fs.closeSync(fd);
        fileOffsets.delete(file);
        continue;
      }
    } catch {
      // File may have been deleted between readdir and open
      fileOffsets.delete(file);
      continue;
    }

    const currentSize = stat.size;
    const lastOffset = fileOffsets.get(file);

    if (lastOffset === undefined) {
      // New file — start from end (don't scan old content for new files found during polling)
      fileOffsets.set(file, currentSize);
      fs.closeSync(fd);
      continue;
    }

    if (currentSize <= lastOffset) {
      // File truncated or unchanged
      if (currentSize < lastOffset) {
        // File was truncated (e.g., session reset) — reset offset
        fileOffsets.set(file, currentSize);
      }
      fs.closeSync(fd);
      continue;
    }

    // Read new bytes
    const bytesToRead = currentSize - lastOffset;

    try {
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, lastOffset);
      const newText = buffer.toString('utf-8');

      // Parse lines
      const lines = newText.split('\n').filter((l) => l.trim().length > 0);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as SessionMessage;
          processEntry(entry, file);
        } catch {
          // Skip malformed JSON — common for partial writes
        }
      }

      // Update offset
      fileOffsets.set(file, currentSize);
    } catch (err) {
      console.error("[SessionWatcher] Error reading file", {
        file: sanitizeLogField(file),
        error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
      });
      errorCount++;
    } finally {
      fs.closeSync(fd);
    }
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function getStats(): WatcherStats {
  return {
    running: false, // overridden by runner
    filesWatched: fileOffsets.size,
    messagesScanned,
    lastScanTime,
    errors: errorCount,
    sessionsDirectory: config.sessionWatcher.path,
  };
}

/**
 * Get recent scanned messages from session watcher.
 */
export function getRecentScans(limit = 50): Record<string, unknown>[] {
  try {
    return queryAll<Record<string, unknown>>(
      "SELECT * FROM proxy_traffic WHERE source = 'session-watcher' ORDER BY timestamp DESC LIMIT ?",
      [limit],
    );
  } catch (err) {
    console.error('[SessionWatcher] Recent scans query error', {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
    return [];
  }
}

/**
 * Reset state (for testing).
 */
export function reset(): void {
  fileOffsets.clear();
  messagesScanned = 0;
  lastScanTime = null;
  errorCount = 0;
}
