/**
 * ClawNex Paperclip Connector — READ-ONLY observability of the Paperclip
 * agent-orchestration platform.
 *
 * v0.9.2 expansion (2026-04-25): the original module only polled GET /api/health
 * for an online/offline signal. Paperclip exposes a much richer REST API
 * (agents, activity, costs, approvals, dashboard) that ClawNex was ignoring.
 * The new fetchers below extend the connector to surface that data when an
 * API key + company ID are configured — the health poll still works without
 * either, so the existing fleet/infrastructure callers continue to function
 * unmodified.
 *
 * Auth model: Paperclip's data endpoints require `Authorization: Bearer
 * <token>`. ClawNex reads the token from `PAPERCLIP_API_KEY` env (or
 * `config.paperclip.apiKey`). Without a token, the dashboard/agents/activity/
 * costs/approvals fetchers all return null and the connector falls back to
 * the unauth health poll.
 *
 * Spec: docs/paperclip-integration-design-2026-04-25.md
 */

import { config } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaperclipStatus {
  name: string;
  url: string;
  status: 'online' | 'degraded' | 'offline';
  latency: number;
  version?: string;
  error?: string;
  lastChecked: string;
  details?: Record<string, unknown>;
}

/** Aggregated dashboard view — Paperclip's `/api/companies/{id}/dashboard`
 *  returns this in a single call. Populated only when API key + company ID
 *  are configured and the request succeeds. */
export interface PaperclipDashboard {
  agentCounts: Record<string, number>;          // by status: active / idle / running / error / paused
  taskCounts: Record<string, number>;           // by status: backlog / todo / in_progress / blocked / done
  staleTasks: Array<{ id: string; title: string; updatedAt: string; agentId?: string }>;
  costSummary: { spendCents: number; budgetCents: number; utilizationPct: number };
  recentActivity: Array<PaperclipActivityEntry>;
}

export interface PaperclipActivityEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
}

export interface PaperclipAgent {
  id: string;
  name: string;
  role?: string;
  status: string;
  model?: string;
  parentAgentId?: string;
}

export interface PaperclipApproval {
  id: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected';
  payload: Record<string, unknown>;
  requestedBy?: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNotes?: string;
}

export interface PaperclipObservability {
  status: PaperclipStatus;
  dashboard: PaperclipDashboard | null;
  agents: PaperclipAgent[] | null;
  activity: PaperclipActivityEntry[] | null;
  approvals: PaperclipApproval[] | null;
  /** True iff API key + company ID are configured. When false, only `status`
   *  is populated (health-poll mode). */
  enriched: boolean;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 5_000;

let cachedStatus: PaperclipStatus = {
  name: 'Paperclip',
  url: config.paperclip.url,
  status: 'offline',
  latency: 0,
  lastChecked: new Date().toISOString(),
};

let pollTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

async function poll(): Promise<PaperclipStatus> {
  const url = `${config.paperclip.url}/api/health`;
  const start = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    const latency = Math.round(performance.now() - start);

    if (!res.ok) {
      cachedStatus = {
        name: 'Paperclip',
        url: config.paperclip.url,
        status: 'degraded',
        latency,
        error: `HTTP ${res.status}: ${res.statusText}`,
        lastChecked: checkedAt,
      };
      return cachedStatus;
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

    cachedStatus = {
      name: 'Paperclip',
      url: config.paperclip.url,
      status: 'online',
      latency,
      version,
      lastChecked: checkedAt,
      details,
    };
    return cachedStatus;
  } catch (err: unknown) {
    const latency = Math.round(performance.now() - start);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';

    cachedStatus = {
      name: 'Paperclip',
      url: config.paperclip.url,
      status: 'offline',
      latency,
      error: isAbort ? `Timeout after ${TIMEOUT_MS}ms` : (err instanceof Error ? err.message : 'Unknown error'),
      lastChecked: checkedAt,
    };
    return cachedStatus;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start polling Paperclip health endpoint every 30 seconds.
 */
export function startPaperclipPoller(): void {
  if (pollTimer) return;

  // Initial poll
  poll().catch((err) => console.warn('[Paperclip] Initial poll failed:', err));

  pollTimer = setInterval(() => {
    poll().catch((err) => console.warn('[Paperclip] Poll error:', err));
  }, POLL_INTERVAL_MS);

  console.log('[Paperclip] Health poller started (30s interval)');
}

/**
 * Get the current cached status (never blocks).
 */
export function getPaperclipStatus(): PaperclipStatus {
  return cachedStatus;
}

// ---------------------------------------------------------------------------
// Authenticated data fetchers (v0.9.2 enrichment)
//
// All authed fetchers are SAFE on misconfig: they return null when the API
// key or company ID is absent, and they never throw — every error is captured
// in the returned status object via getPaperclipObservability(). This keeps
// callers (the infrastructure route, future panels) unconditional — they can
// always call getPaperclipObservability() without checking for config first.
// ---------------------------------------------------------------------------

interface AuthedFetchOpts {
  path: string;
  signal?: AbortSignal;
}

async function authedFetch<T>(opts: AuthedFetchOpts): Promise<T | null> {
  const apiKey = config.paperclip.apiKey;
  if (!apiKey) return null;

  const url = `${config.paperclip.url}${opts.path}`;
  const controller = opts.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: opts.signal ?? controller!.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (timeout) clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    if (timeout) clearTimeout(timeout);
    return null;
  }
}

/** Aggregated dashboard — single call to Paperclip's company dashboard endpoint.
 *  Returns null if API key, company ID, or fetch fails. */
export async function getPaperclipDashboard(): Promise<PaperclipDashboard | null> {
  const cid = config.paperclip.companyId;
  if (!cid) return null;
  return authedFetch<PaperclipDashboard>({ path: `/api/companies/${encodeURIComponent(cid)}/dashboard` });
}

/** All agents in the configured company. Returns null if unconfigured. */
export async function getPaperclipAgents(): Promise<PaperclipAgent[] | null> {
  const cid = config.paperclip.companyId;
  if (!cid) return null;
  return authedFetch<PaperclipAgent[]>({ path: `/api/companies/${encodeURIComponent(cid)}/agents` });
}

/** Recent activity / audit trail. Default limit 25 entries (Paperclip
 *  caps higher; this keeps the ClawNex panel response compact). */
export async function getPaperclipActivity(limit = 25): Promise<PaperclipActivityEntry[] | null> {
  const cid = config.paperclip.companyId;
  if (!cid) return null;
  const path = `/api/companies/${encodeURIComponent(cid)}/activity?limit=${limit}`;
  return authedFetch<PaperclipActivityEntry[]>({ path });
}

/** Approvals queue. Default filter `pending` — that's the security-relevant
 *  surface (which actions are awaiting board review). Pass `''` for all. */
export async function getPaperclipApprovals(status: 'pending' | 'approved' | 'rejected' | '' = 'pending'): Promise<PaperclipApproval[] | null> {
  const cid = config.paperclip.companyId;
  if (!cid) return null;
  const qs = status ? `?status=${status}` : '';
  return authedFetch<PaperclipApproval[]>({ path: `/api/companies/${encodeURIComponent(cid)}/approvals${qs}` });
}

/** Single-call public entry point — gathers status + every enrichment
 *  field in parallel. Designed for the infrastructure / fleet / future
 *  Paperclip-panel surfaces so callers don't need to orchestrate four
 *  parallel HTTP calls. Returns enriched=false when API key / company
 *  are unconfigured (callers can hide enrichment UI in that case). */
export async function getPaperclipObservability(): Promise<PaperclipObservability> {
  const status = getPaperclipStatus();
  const enriched = Boolean(config.paperclip.apiKey && config.paperclip.companyId);

  if (!enriched || status.status === 'offline') {
    return { status, dashboard: null, agents: null, activity: null, approvals: null, enriched };
  }

  const [dashboard, agents, activity, approvals] = await Promise.all([
    getPaperclipDashboard(),
    getPaperclipAgents(),
    getPaperclipActivity(25),
    getPaperclipApprovals('pending'),
  ]);

  return { status, dashboard, agents, activity, approvals, enriched };
}
