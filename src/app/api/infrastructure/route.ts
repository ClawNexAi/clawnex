/**
 * Infrastructure API
 * GET /api/infrastructure
 *
 * Returns system metrics (CPU, memory, disk) and service liveness checks.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getFullSystemReport } from "@/lib/services/system-metrics";
import { config } from "@/lib/config";
import { getOpenClawConnector } from "@/lib/connectors/openclaw-connector";
import { getPaperclipStatus, startPaperclipPoller } from "@/lib/connectors/paperclip-connector";
import { getAutensaStatus, startAutensaPoller } from "@/lib/connectors/autensa-connector";
import { queryAll, run } from "@/lib/db/index";
import { checkLiteLLM as checkLiteLLMImpl } from "@/lib/health/litellm-check";
import { assertSafeProviderHttpFetchTarget, providerEndpointUrl } from "@/lib/services/config-service";
import { diagnoseHermes } from "@/lib/services/hermes-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ServiceCheck {
  name: string;
  url: string;
  status: "online" | "degraded" | "offline" | "not_configured";
  latency: number;
  error?: string;
  detail?: string;
  // Item #4 (Mission Control §8.3b):
  // version: adapter version string (e.g. "v4.12" for openclaw, "state.db"
  //   for hermes, "HTTP" for paperclip). Sourced from connector status when
  //   available; otherwise falls back to name-based canonical strings from
  //   the demo fixture pattern (COLLECTOR_HEALTH_DEMO in demo-fixtures.ts).
  version?: string;
  // ingestion_summary: short human-readable text like "2,733 events · 0 errors".
  //   Computed from shield_scans row count for the openclaw watcher;
  //   undefined for services that have no ingestion concept (LiteLLM, disk, etc.).
  ingestion_summary?: string;
  observed_at: string | null;
  stale_after_ms: number | null;
  last_seen_ms_ago: number | null;
  activity_state: "measured" | "stale" | "unavailable" | "not_applicable";
  transport?: string;
}

function observationFields(
  observedAt: string | null,
  staleAfterMs: number | null,
): Pick<ServiceCheck, "observed_at" | "stale_after_ms" | "last_seen_ms_ago" | "activity_state"> {
  const parsed = observedAt ? Date.parse(observedAt) : Number.NaN;
  const age = Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null;
  return {
    observed_at: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    stale_after_ms: staleAfterMs,
    last_seen_ms_ago: age,
    activity_state: age == null
      ? "unavailable"
      : staleAfterMs != null && age > staleAfterMs
        ? "stale"
        : "measured",
  };
}

/**
 * Basic service check — is the endpoint reachable?
 */
async function checkService(name: string, url: string, opts: { providerGuard?: boolean } = {}): Promise<ServiceCheck> {
  const start = performance.now();
  try {
    if (opts.providerGuard) {
      const safety = await assertSafeProviderHttpFetchTarget(url, `infrastructure service check ${name}`);
      if (safety.blocked) {
        return {
          name,
          url,
          status: "offline",
          latency: Math.round(performance.now() - start),
          error: safety.reason || "blocked provider target",
          ...observationFields(null, 30_000),
        };
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store", redirect: "error" });
    clearTimeout(timeout);
    const latency = Math.round(performance.now() - start);
    return {
      name,
      url,
      status: res.ok ? "online" : "degraded",
      latency,
      ...observationFields(new Date().toISOString(), 30_000),
      transport: new URL(url).protocol.replace(":", "").toUpperCase(),
    };
  } catch (err: unknown) {
    const latency = Math.round(performance.now() - start);
    return {
      name,
      url,
      status: "offline",
      latency,
      error: err instanceof Error ? err.message : "Unknown error",
      ...observationFields(null, 30_000),
    };
  }
}

/**
 * LiteLLM proxy status — adapter that delegates to the extracted
 * launch-final implementation in src/lib/health/litellm-check.ts.
 *
 * internal reviewer 2026-05-09 contract: status driven by fast liveness only;
 * deep model-health is best-effort enrichment for the detail line.
 * See litellm-check.ts header for the full architecture rationale.
 *
 * The extracted module takes injected fetch + provider-count query so
 * scripts/verify-litellm-health-checks.ts can mock both.
 */
async function checkLiteLLM(port: number): Promise<ServiceCheck> {
  const result = await checkLiteLLMImpl(port, {
    queryProviderCountImpl: () => {
      try {
        const rows = queryAll<{ count: number }>(
          "SELECT COUNT(*) as count FROM config_providers WHERE is_active = 1 AND type != 'openclaw'"
        );
        return rows.length > 0 ? rows[0].count : 0;
      } catch {
        return 1; // DB not ready — fall through to network checks
      }
    },
    logDegradedEventImpl: logDegradedEvent,
  });
  return {
    ...result,
    ...observationFields(result.status === "online" ? new Date().toISOString() : null, 30_000),
    transport: "HTTP",
  };
}

/**
 * Log a degraded event to the audit trail (throttled to 1 per 5 minutes per service)
 */
const degradedEventCache: Record<string, number> = {};
function logDegradedEvent(service: string, detail: string): void {
  const now = Date.now();
  const lastLogged = degradedEventCache[service] || 0;
  if (now - lastLogged < 300000) return; // 5 min throttle
  degradedEventCache[service] = now;
  try {
    run(
      `INSERT INTO audit_log (id, actor, action, resource, detail, created_at) VALUES (?, 'system-monitor', 'service_degraded', ?, ?, datetime('now'))`,
      [require("crypto").randomUUID(), service, detail]
    );
  } catch {}
}

// ---------------------------------------------------------------------------
// Item #4: version + ingestion_summary per service
// ---------------------------------------------------------------------------

/**
 * Build a version string for a named service.
 *
 * Resolution order:
 *   1. The Paperclip connector status .version field (only for "Paperclip").
 *   2. Name-based canonical strings matching the COLLECTOR_HEALTH_DEMO
 *      fixture pattern (src/components/dashboard/panels/mission-control/
 *      demo-fixtures.ts). These are the honest defaults when no richer
 *      source exists.
 *
 * Returns undefined for services where a version string is not meaningful
 * (e.g. system-level disk or the ClawNex self-check).
 */
function serviceVersion(
  name: string,
  paperclipVersion?: string,
): string | undefined {
  const lc = name.toLowerCase();
  // Paperclip has a real version from its HTTP health endpoint.
  if (lc.includes("paperclip") && paperclipVersion) return paperclipVersion;
  // Transport and storage identities are exposed separately. Do not present
  // HTTP, WS, or state.db as measured software versions.
  if (lc.includes("openclaw") || lc.includes("hermes") || lc.includes("litellm") || lc.includes("autensa")) return undefined;
  return undefined;
}

/**
 * Build an ingestion_summary string for a named service.
 *
 * OpenClaw ingestion is the traffic ClawNex actually accepted from OpenClaw's
 * session watcher. Shield scan count is a different metric and must not be
 * presented as total ingestion.
 *
 * All other services return undefined — callers must not render the field
 * when absent.
 */
function serviceIngestionSummary(name: string): string | undefined {
  const lc = name.toLowerCase();
  if (!lc.includes("openclaw")) return undefined;

  try {
    const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const total = queryAll<{ cnt: number; latest: string | null }>(
      `SELECT COUNT(*) AS cnt, MAX(timestamp) AS latest
         FROM proxy_traffic
        WHERE source = 'session-watcher' AND timestamp >= ?`,
      [since24h],
    );
    const count = total[0]?.cnt ?? 0;
    return `${count.toLocaleString()} session events observed in 24h`;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'dashboard:view');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    // Only start connector pollers if explicitly configured (not default localhost)
    const paperclipExplicit = config.paperclip?.url && config.paperclip.url !== "http://127.0.0.1:3100";
    const autensaExplicit = config.autensa?.url && config.autensa.url !== "http://127.0.0.1:4000";
    if (paperclipExplicit) startPaperclipPoller();
    if (autensaExplicit) startAutensaPoller();

    // Collect system metrics
    const report = getFullSystemReport();

    // Check service liveness — only check services that are configured
    const serviceChecks: Array<Promise<ServiceCheck>> = [
      checkService("ClawNex", `http://127.0.0.1:${config.port}/api/health`),
    ];

    // LiteLLM proxy — two-phase health check (fast liveness + deep model validation)
    const litellmPort = config.litellm?.port || 4001;
    serviceChecks.push(checkLiteLLM(litellmPort));

    // Only check configured providers from the database
    try {
      const providers = queryAll<{ name: string; base_url: string; type: string; is_active: number }>(
        "SELECT name, base_url, type, is_active FROM config_providers WHERE is_active = 1 AND type != 'openclaw'"
      );
      for (const p of providers) {
        serviceChecks.push(checkService(p.name, providerEndpointUrl(p.base_url, "models"), { providerGuard: true }));
      }
    } catch {}

    // Optional services — only check if configured in environment
    if (config.paperclip?.url && config.paperclip.url !== "http://127.0.0.1:3100") {
      serviceChecks.push(checkService("Paperclip", `${config.paperclip.url}/api/health`));
    }
    if (config.autensa?.url && config.autensa.url !== "http://127.0.0.1:4000") {
      serviceChecks.push(checkService("Autensa", `${config.autensa.url}/api/health`));
    }

    const services = await Promise.all(serviceChecks);

    // Gather connector statuses
    const ocConnector = getOpenClawConnector();
    const ocStatus = ocConnector.getConnectionStatus();

    // Add connector-sourced statuses to services
    services.push({
      name: "OpenClaw Gateway (WebSocket)",
      url: config.openclaw.url,
      status: ocStatus.connected ? "online" : "offline",
      latency: 0, // WebSocket — no HTTP latency
      error: ocStatus.lastError || undefined,
      ...observationFields(ocStatus.connected ? new Date().toISOString() : ocStatus.lastEvent, 30_000),
      transport: "WebSocket",
    });

    const hermesDiagnostics = diagnoseHermes();
    services.push({
      name: "Hermes Agent",
      url: hermesDiagnostics.stateDbPath,
      status: hermesDiagnostics.available
        ? hermesDiagnostics.status === "live" ? "online" : "degraded"
        : "not_configured",
      latency: 0,
      error: hermesDiagnostics.available ? undefined : hermesDiagnostics.statusDetail || undefined,
      detail: hermesDiagnostics.statusDetail || undefined,
      ingestion_summary: `${hermesDiagnostics.messages.last24h.toLocaleString()} messages observed · ${hermesDiagnostics.messages.lastId.toLocaleString()} cursor`,
      ...observationFields(hermesDiagnostics.lastActivity, 7 * 24 * 60 * 60 * 1000),
      transport: "SQLite (read-only)",
    });

    // Only include Paperclip/Autensa connector data if explicitly configured
    const paperclipStatus = getPaperclipStatus();
    const autensaStatus = getAutensaStatus();

    if (paperclipExplicit) {
      const paperclipIdx = services.findIndex((s) => s.name === "Paperclip");
      if (paperclipIdx >= 0) {
        services[paperclipIdx] = {
          name: paperclipStatus.name,
          url: paperclipStatus.url,
          status: paperclipStatus.status,
          latency: paperclipStatus.latency,
          error: paperclipStatus.error,
          ...observationFields(paperclipStatus.lastChecked || null, 30 * 60 * 1000),
          transport: "HTTP",
        };
      } else {
        services.push({
          name: paperclipStatus.name,
          url: paperclipStatus.url,
          status: paperclipStatus.status,
          latency: paperclipStatus.latency,
          error: paperclipStatus.error,
          ...observationFields(paperclipStatus.lastChecked || null, 30 * 60 * 1000),
          transport: "HTTP",
        });
      }
    }

    if (autensaExplicit) {
      const autensaIdx = services.findIndex((s) => s.name.includes("Autensa") || s.name.includes("Mission Control"));
      if (autensaIdx >= 0) {
        services[autensaIdx] = {
          name: autensaStatus.name,
          url: autensaStatus.url,
          status: autensaStatus.status,
          latency: autensaStatus.latency,
          error: autensaStatus.error,
          ...observationFields(autensaStatus.lastChecked || null, 30 * 60 * 1000),
          transport: "HTTP",
        };
      } else {
        services.push({
          name: autensaStatus.name,
          url: autensaStatus.url,
          status: autensaStatus.status,
          latency: autensaStatus.latency,
          error: autensaStatus.error,
          ...observationFields(autensaStatus.lastChecked || null, 30 * 60 * 1000),
          transport: "HTTP",
        });
      }
    }

    // Item #4: annotate each ServiceCheck with version + ingestion_summary.
    // These are computed from connector data / shield_scans — non-fatal if absent.
    const paperclipVer = paperclipExplicit ? paperclipStatus.version : undefined;
    for (const svc of services) {
      const ver = serviceVersion(svc.name, paperclipVer);
      if (ver !== undefined) svc.version = ver;
      const ing = serviceIngestionSummary(svc.name);
      if (ing !== undefined) svc.ingestion_summary = ing;
    }

    return NextResponse.json({
      system: report.system,
      disk: report.disk,
      services,
      openclaw: {
        connected: ocStatus.connected,
        authenticated: ocStatus.authenticated,
        sessions: ocStatus.sessions,
        agents: ocStatus.agents,
        lastEvent: ocStatus.lastEvent,
        lastError: ocStatus.lastError,
      },
      hermes: hermesDiagnostics,
      ...(paperclipExplicit ? {
        paperclip: {
          status: paperclipStatus.status,
          latency: paperclipStatus.latency,
          version: paperclipStatus.version,
          lastChecked: paperclipStatus.lastChecked,
        },
      } : {}),
      ...(autensaExplicit ? {
        autensa: {
          status: autensaStatus.status,
          latency: autensaStatus.latency,
          version: autensaStatus.version,
          agentCount: autensaStatus.agentCount,
          lastChecked: autensaStatus.lastChecked,
        },
      } : {}),
      timestamp: report.collectedAt,
    });
  } catch (error) {
    console.error("[Infrastructure API] Error:", error);
    return NextResponse.json(
      { error: "Failed to collect infrastructure metrics" },
      { status: 500 }
    );
  }
}
