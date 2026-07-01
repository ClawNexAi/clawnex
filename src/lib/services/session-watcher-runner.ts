/**
 * ClawNex Session Watcher Runner
 *
 * Lifecycle management for the session log watcher polling loop.
 * Provides start/stop/status operations and lazy initialization.
 */

import { config } from '../config';
import {
  initializeOffsets,
  pollFiles,
  getStats,
  reset,
} from './session-watcher';
import { sanitizeLogField } from '../security/log-sanitize';

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
 * Start the session watcher polling loop.
 */
export function startWatcher(): void {
  if (running) {
    console.log('[SessionWatcher] Already running');
    return;
  }

  if (!config.sessionWatcher.enabled) {
    console.log('[SessionWatcher] Disabled via config (SESSION_WATCHER_ENABLED=false)');
    return;
  }

  console.log(`[SessionWatcher] Starting — polling ${config.sessionWatcher.path} every ${config.sessionWatcher.pollIntervalMs}ms`);

  // Initialize: scan tail of existing files
  try {
    initializeOffsets();
  } catch (err) {
    console.error('[SessionWatcher] Failed to initialize offsets', {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
  }

  running = true;
  startedAt = Date.now();

  // Start polling loop
  pollInterval = setInterval(() => {
    try {
      pollFiles();
    } catch (err) {
      console.error('[SessionWatcher] Poll error', {
        error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
      });
    }
  }, config.sessionWatcher.pollIntervalMs);

  console.log('[SessionWatcher] Started');
}

/**
 * Trigger an immediate poll cycle (without waiting for the interval).
 */
export function pollNow(): void {
  if (!running) return;
  try {
    pollFiles();
  } catch (err) {
    console.error('[SessionWatcher] Manual poll error', {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
  }
}

/**
 * Change the polling interval (restarts the interval timer).
 */
export function setPollInterval(ms: number): void {
  if (!running || !pollInterval) return;
  clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    try {
      pollFiles();
    } catch (err) {
      console.error('[SessionWatcher] Poll error', {
        error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
      });
    }
  }, ms);
  console.log("[SessionWatcher] Interval changed", { intervalMs: ms });
}

/**
 * Stop the session watcher polling loop.
 */
export function stopWatcher(): void {
  if (!running) return;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  running = false;
  startedAt = null;
  console.log('[SessionWatcher] Stopped');
}

/**
 * Get the current watcher status.
 */
export function getWatcherStatus(): {
  running: boolean;
  enabled: boolean;
  uptime: number | null;
  startedAt: number | null;
  filesWatched: number;
  messagesScanned: number;
  lastScanTime: string | null;
  errors: number;
  pollIntervalMs: number;
  sessionsDirectory: string;
} {
  const stats = getStats();
  return {
    running,
    enabled: config.sessionWatcher.enabled,
    uptime: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null,
    startedAt,
    filesWatched: stats.filesWatched,
    messagesScanned: stats.messagesScanned,
    lastScanTime: stats.lastScanTime,
    errors: stats.errors,
    pollIntervalMs: config.sessionWatcher.pollIntervalMs,
    sessionsDirectory: stats.sessionsDirectory,
  };
}

// ---------------------------------------------------------------------------
// Lazy init (call from health endpoint or other entry points)
// ---------------------------------------------------------------------------

let initDone = false;

/**
 * Ensure the watcher is started. Safe to call multiple times.
 */
export function ensureWatcherStarted(): void {
  if (initDone) return;
  initDone = true;

  try {
    startWatcher();
  } catch (err) {
    console.error('[SessionWatcher] Failed to auto-start', {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
    initDone = false;
  }
}
