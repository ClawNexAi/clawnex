/**
 * Hermes Agent Watcher Runner
 *
 * Lifecycle management for the Hermes message watcher polling loop.
 * Mirrors session-watcher-runner.ts — provides start/stop/status and lazy init.
 *
 * @module services/hermes-watcher-runner
 */

import { config } from '../config';
import { isHermesAvailable } from './hermes-db';
import {
  initializeHermesWatcher,
  pollHermesMessages,
  getHermesWatcherStats,
} from './hermes-watcher';
import { logEvent } from './audit-logger';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pollInterval: ReturnType<typeof setInterval> | null = null;
let running = false;
let startedAt: number | null = null;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the Hermes watcher polling loop.
 */
export function startHermesWatcher(): void {
  if (running) {
    console.log('[HermesWatcher] Already running');
    return;
  }

  if (!config.hermes.enabled) {
    console.log('[HermesWatcher] Disabled via config (HERMES_WATCHER_ENABLED=false)');
    return;
  }

  if (!isHermesAvailable()) {
    console.log('[HermesWatcher] Hermes state.db not found — skipping');
    return;
  }

  console.log(`[HermesWatcher] Starting — polling every ${config.hermes.pollIntervalMs}ms`);

  // Initialize: find the current high-water mark
  try {
    initializeHermesWatcher();
  } catch (err) {
    console.error('[HermesWatcher] Failed to initialize:', err);
  }

  running = true;
  startedAt = Date.now();

  // Audit trail: log the watcher startup so Hermes has an audit footprint
  try {
    const stats = getHermesWatcherStats();
    logEvent(
      'hermes-watcher', 'hermes_watcher_started', 'hermes', 'hermes-watcher',
      `Hermes watcher started. Monitoring ~/.hermes/state.db. High-water mark: message ${stats.lastProcessedId}. Poll interval: ${config.hermes.pollIntervalMs}ms.`,
    );
  } catch { /* silent */ }

  // Start polling loop
  pollInterval = setInterval(() => {
    try {
      pollHermesMessages();
    } catch (err) {
      console.error('[HermesWatcher] Poll error:', err);
    }
  }, config.hermes.pollIntervalMs);

  console.log('[HermesWatcher] Started');
}

/**
 * Stop the Hermes watcher polling loop.
 */
export function stopHermesWatcher(): void {
  if (!running) return;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  running = false;
  startedAt = null;
  console.log('[HermesWatcher] Stopped');
}

/**
 * Get the current Hermes watcher status.
 */
export function getHermesWatcherStatus(): {
  running: boolean;
  enabled: boolean;
  uptime: number | null;
  startedAt: number | null;
  messagesScanned: number;
  lastScanTime: string | null;
  errors: number;
  pollIntervalMs: number;
  hermesAvailable: boolean;
  sourceId: string;
  lastProcessedId: number;
} {
  const stats = getHermesWatcherStats();
  return {
    running,
    enabled: config.hermes.enabled,
    uptime: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null,
    startedAt,
    messagesScanned: stats.messagesScanned,
    lastScanTime: stats.lastScanTime,
    errors: stats.errors,
    pollIntervalMs: config.hermes.pollIntervalMs,
    hermesAvailable: stats.hermesAvailable,
    sourceId: stats.sourceId,
    lastProcessedId: stats.lastProcessedId,
  };
}

// ---------------------------------------------------------------------------
// Lazy init (call from health endpoint or other entry points)
// ---------------------------------------------------------------------------

let initDone = false;

/**
 * Ensure the Hermes watcher is started. Safe to call multiple times.
 */
export function ensureHermesWatcherStarted(): void {
  if (initDone) return;
  initDone = true;

  try {
    startHermesWatcher();
  } catch (err) {
    console.error('[HermesWatcher] Failed to auto-start:', err);
    initDone = false;
  }
}
