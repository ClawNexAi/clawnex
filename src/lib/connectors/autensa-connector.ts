/**
 * ClawNex Autensa (Mission Control) Connector — READ-ONLY health + agent poller.
 *
 * Polls:
 *   GET http://127.0.0.1:4000/api/health (with Bearer token) every 30s
 *   GET http://127.0.0.1:4000/api/agents (with Bearer token) every 30s
 *
 * Graceful degradation if Autensa is down.
 * Uses AUTENSA_TOKEN from config (MC_API_TOKEN / AUTENSA_TOKEN in .env.local).
 */

import { config } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutensaAgent {
  id: string;
  name?: string;
  status?: string;
  model?: string;
  [key: string]: unknown;
}

export interface AutensaStatus {
  name: string;
  url: string;
  status: 'online' | 'degraded' | 'offline';
  latency: number;
  version?: string;
  error?: string;
  lastChecked: string;
  agents: AutensaAgent[];
  agentCount: number;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 5_000;

let cachedStatus: AutensaStatus = {
  name: 'Autensa (Mission Control)',
  url: config.autensa.url,
  status: 'offline',
  latency: 0,
  lastChecked: new Date().toISOString(),
  agents: [],
  agentCount: 0,
};

let pollTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.autensa.token) {
    headers['Authorization'] = `Bearer ${config.autensa.token}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

async function pollHealth(): Promise<{ ok: boolean; latency: number; version?: string; details?: Record<string, unknown>; error?: string }> {
  const url = `${config.autensa.url}/api/health`;
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: getAuthHeaders(),
    });
    clearTimeout(timeout);

    const latency = Math.round(performance.now() - start);

    if (!res.ok) {
      return { ok: false, latency, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    let details: Record<string, unknown> | undefined;
    let version: string | undefined;
    try {
      const data = await res.json();
      details = data;
      version = data.version || data.app_version;
    } catch {
      // Response may not be JSON
    }

    return { ok: true, latency, version, details };
  } catch (err: unknown) {
    const latency = Math.round(performance.now() - start);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      latency,
      error: isAbort ? `Timeout after ${TIMEOUT_MS}ms` : (err instanceof Error ? err.message : 'Unknown error'),
    };
  }
}

async function pollAgents(): Promise<AutensaAgent[]> {
  const url = `${config.autensa.url}/api/agents`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: getAuthHeaders(),
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    if (Array.isArray(data)) return data as AutensaAgent[];
    if (data && typeof data === 'object' && Array.isArray(data.agents)) return data.agents as AutensaAgent[];
    return [];
  } catch {
    return [];
  }
}

async function poll(): Promise<AutensaStatus> {
  const checkedAt = new Date().toISOString();

  const [healthResult, agents] = await Promise.all([pollHealth(), pollAgents()]);

  if (!healthResult.ok) {
    cachedStatus = {
      name: 'Autensa (Mission Control)',
      url: config.autensa.url,
      status: 'offline',
      latency: healthResult.latency,
      error: healthResult.error,
      lastChecked: checkedAt,
      agents: [],
      agentCount: 0,
    };
    return cachedStatus;
  }

  cachedStatus = {
    name: 'Autensa (Mission Control)',
    url: config.autensa.url,
    status: 'online',
    latency: healthResult.latency,
    version: healthResult.version,
    lastChecked: checkedAt,
    agents,
    agentCount: agents.length,
    details: healthResult.details,
  };
  return cachedStatus;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start polling Autensa health + agents every 30 seconds.
 */
export function startAutensaPoller(): void {
  if (pollTimer) return;

  // Initial poll
  poll().catch((err) => console.warn('[Autensa] Initial poll failed:', err));

  pollTimer = setInterval(() => {
    poll().catch((err) => console.warn('[Autensa] Poll error:', err));
  }, POLL_INTERVAL_MS);

  console.log('[Autensa] Health poller started (30s interval)');
}

/**
 * Get the current cached status (never blocks).
 */
export function getAutensaStatus(): AutensaStatus {
  return cachedStatus;
}
