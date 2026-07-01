/**
 * Shared health-tick + state snapshot helpers.
 *
 * Extracted 2026-04-24 when /api/health was split into public (minimal)
 * and authenticated (/api/health/detailed, full payload) per adversarial
 * review finding #A4. Both endpoints drive the lazy-init "tick" so that
 * whichever one is polled most often in a given deployment keeps the
 * background work alive:
 *   - ensureWatcherStarted / ensureHermesWatcherStarted — idempotent
 *     session-watcher bootstrap (shield scan loop)
 *   - maybeEnforceRetention — hourly DB pruning; piggybacks on health
 *     probes so no separate cron is needed
 *   - ensureSeeded + maybeAutoSyncPricing — model-pricing table bootstrap
 *   - checkBreakGlassExpiry — auto-expire + alert on the break-glass
 *     window so a forgotten override doesn't silently skip shield scans
 *     indefinitely
 *
 * The detailed-state reader (`readDetailedHealth`) is the source of
 * truth for the operational fields that used to live in the public
 * /api/health response (OpenClaw connection, break-glass reason,
 * watcher stats). Those moved behind auth in v0.9.0-alpha hardening.
 *
 * @module services/health-tick
 */

import { getClientCount } from '@/lib/events';
import { getOpenClawConnector } from '@/lib/connectors/openclaw-connector';
import {
  ensureWatcherStarted,
  getWatcherStatus,
} from '@/lib/services/session-watcher-runner';
import {
  ensureHermesWatcherStarted,
  getHermesWatcherStatus,
} from '@/lib/services/hermes-watcher-runner';
import { diagnoseHermes } from '@/lib/services/hermes-diagnostics';
import { maybeEnforceRetention } from '@/lib/db/retention';
import { CLAWNEX_VERSION } from '@/lib/version';
import {
  ensureSeeded,
  maybeAutoSync as maybeAutoSyncPricing,
} from '@/lib/services/model-pricing-store';
import { getSetting, setSetting } from '@/lib/services/config-service';
import { logEvent } from '@/lib/services/audit-logger';
import { createAlert } from '@/lib/services/alert-manager';
import { queryOne } from '@/lib/db/index';
import { broadcast } from '@/lib/events';

// ---------------------------------------------------------------------------
// Break-glass expiry
// ---------------------------------------------------------------------------

/**
 * Check break-glass expiry and auto-deactivate if needed. Side-effects on
 * expiry: persist deactivation state, audit-log the expiry, raise a HIGH
 * alert, and broadcast an SSE event so every dashboard tab refreshes.
 *
 * Called from the tick helper — runs on every health probe, so a long-
 * forgotten break-glass window gets torn down promptly the first time
 * any monitoring tool polls after its TTL.
 */
export interface BreakGlassState {
  active: boolean;
  expires_at: string | null;
  remaining_seconds: number | null;
  reason: string | null;
}

export function checkBreakGlassExpiry(): BreakGlassState {
  const raw = getSetting('break_glass');
  if (!raw) return { active: false, expires_at: null, remaining_seconds: null, reason: null };

  try {
    const state = JSON.parse(raw);
    if (!state.active) return { active: false, expires_at: null, remaining_seconds: null, reason: null };

    const expiresAt = new Date(state.expires_at).getTime();
    if (Date.now() >= expiresAt) {
      // Auto-expire. Count any traffic that bypassed the shield during
      // the window so the alert carries the impact number.
      let unscannedCount = 0;
      try {
        const row = queryOne<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM proxy_traffic WHERE source = 'break-glass' AND timestamp >= ?",
          [state.activated_at],
        );
        unscannedCount = row?.cnt || 0;
      } catch { /* ignore — count is informational */ }

      const actualMinutes = Math.round((Date.now() - new Date(state.activated_at).getTime()) / 60000);

      setSetting('break_glass', JSON.stringify({
        active: false,
        deactivated_at: new Date().toISOString(),
        last_reason: state.reason,
        last_duration_minutes: actualMinutes,
        last_unscanned_count: unscannedCount,
      }));

      logEvent(
        'system', 'break_glass_expired', 'break-glass', 'break_glass',
        `Expired after ${actualMinutes}m. Unscanned traffic: ${unscannedCount} requests.`, 'clawnex',
      );
      createAlert(
        `Break-Glass Expired — ${actualMinutes}m active, ${unscannedCount} unscanned`,
        `Break-glass auto-expired after ${state.duration_minutes}m. ${unscannedCount} requests bypassed the shield.`,
        'HIGH', 'break-glass',
      );
      try {
        broadcast('break_glass_deactivated', { expired: true, duration: actualMinutes, unscanned: unscannedCount });
      } catch { /* ignore — broadcast is best-effort */ }

      return { active: false, expires_at: null, remaining_seconds: null, reason: null };
    }

    const remainingSeconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    return { active: true, expires_at: state.expires_at, remaining_seconds: remainingSeconds, reason: state.reason };
  } catch {
    // Malformed JSON in the setting — treat as inactive so a corrupted
    // row doesn't block the shield forever.
    return { active: false, expires_at: null, remaining_seconds: null, reason: null };
  }
}

// ---------------------------------------------------------------------------
// Tick + detailed state
// ---------------------------------------------------------------------------

/**
 * Run every lazy-init + periodic task that used to live inline in the
 * health route. Called from both /api/health (public, minimal response)
 * and /api/health/detailed (authenticated, full response) so whichever
 * endpoint sees traffic keeps the tick alive. Safe to call on every
 * request — each task rate-limits itself internally.
 */
export function runHealthTick(): void {
  ensureWatcherStarted();
  ensureHermesWatcherStarted();
  maybeEnforceRetention();

  try {
    ensureSeeded();
    // Fire-and-forget: GitHub auto-sync must not block the response.
    maybeAutoSyncPricing().catch(() => { /* logged by the service */ });
  } catch { /* pricing init errors never block health */ }

  // Break-glass is evaluated here so the auto-expire path fires even on
  // detailed-endpoint calls. The caller that needs the return value can
  // call checkBreakGlassExpiry() separately.
  checkBreakGlassExpiry();
}

/**
 * Build the full operational payload. Callers must be authenticated
 * (or localhost) — this includes OpenClaw connection state, break-glass
 * reason, watcher internals that previously leaked anonymously.
 */
export function readDetailedHealth() {
  const breakGlass = checkBreakGlassExpiry();
  const connector = getOpenClawConnector();
  const ocStatus = connector.getConnectionStatus();
  const watcherStatus = getWatcherStatus();
  const hermesStatus = getHermesWatcherStatus();
  const hermesDiagnostics = diagnoseHermes();

  return {
    status: 'ok' as const,
    name: 'ClawNex',
    version: CLAWNEX_VERSION,
    uptime: Math.floor(process.uptime()),
    sseClients: getClientCount(),
    openclaw: {
      connected: ocStatus.connected,
      authenticated: ocStatus.authenticated,
      lastEvent: ocStatus.lastEvent,
      lastError: ocStatus.lastError,
      reconnectAttempts: ocStatus.reconnectAttempts,
      sessions: ocStatus.sessions,
      agents: ocStatus.agents,
    },
    breakGlass: {
      active: breakGlass.active,
      expires_at: breakGlass.expires_at,
      remaining_seconds: breakGlass.remaining_seconds,
      reason: breakGlass.reason,
    },
    sessionWatcher: {
      running: watcherStatus.running,
      enabled: watcherStatus.enabled,
      uptime: watcherStatus.uptime,
      filesWatched: watcherStatus.filesWatched,
      messagesScanned: watcherStatus.messagesScanned,
      lastScanTime: watcherStatus.lastScanTime,
      errors: watcherStatus.errors,
    },
    hermesWatcher: {
      running: hermesStatus.running,
      enabled: hermesStatus.enabled,
      uptime: hermesStatus.uptime,
      messagesScanned: hermesStatus.messagesScanned,
      lastScanTime: hermesStatus.lastScanTime,
      errors: hermesStatus.errors,
      hermesAvailable: hermesStatus.hermesAvailable,
      pollIntervalMs: hermesStatus.pollIntervalMs,
      sourceId: hermesStatus.sourceId,
      lastProcessedId: hermesStatus.lastProcessedId,
      diagnostics: hermesDiagnostics,
    },
    timestamp: new Date().toISOString(),
  };
}
