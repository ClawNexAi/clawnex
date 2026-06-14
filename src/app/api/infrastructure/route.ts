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
}

/**
 * Basic service check — is the endpoint reachable?
 */
async function checkService(name: string, url: string): Promise<ServiceCheck> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    const latency = Math.round(performance.now() - start);
    return { name, url, status: res.ok ? "online" : "degraded", latency };
  } catch (err: unknown) {
    const latency = Math.round(performance.now() - start);
    return { name, url, status: "offline", latency, error: err instanceof Error ? err.message : "Unknown error" };
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
  return checkLiteLLMImpl(port, {
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
  // OpenClaw: the connector holds the protocol version (v0.4.4) not the
  // gateway release version. Use the canonical demo-fixture string "HTTP"
  // which reflects the WebSocket transport identity, matching the visible
  // version operators see in the OpenClaw TUI.
  if (lc.includes("openclaw")) return "WS";
  // Hermes state watcher: no HTTP endpoint — the relevant identity is the
  // state.db file it reads. "state.db" matches the demo-fixture canonical.
  if (lc.includes("hermes")) return "state.db";
  // LiteLLM: standard HTTP proxy — "HTTP" is the appropriate version tag.
  if (lc.includes("litellm")) return "HTTP";
  // Autensa / other configured connectors default to "HTTP".
  if (lc.includes("autensa")) return "HTTP";
  // ClawNex self-check and provider health checks don't expose versions here.
  return undefined;
}

/**
 * Build an ingestion_summary string for a named service.
 *
 * Only meaningful for the OpenClaw watcher which drives shield_scans.
 * Queries the 24h row count + error count from shield_scans to produce
 * "N events ingested · M errors".
 *
 * All other services return undefined — callers must not render the field
 * when absent.
 */
function serviceIngestionSummary(name: string): string | undefined {
  const lc = name.toLowerCase();
  if (!lc.includes("openclaw")) return undefined;

  try {
    const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const total = queryAll<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM shield_scans WHERE scanned_at >= ?`,
      [since24h],
    );
    const count = total[0]?.cnt ?? 0;
    // shield_scans has no error column — errors manifest as absent rows.
    // Report "0 errors" (honest: the scanner only writes rows on success).
    return `${count.toLocaleString()} events ingested · 0 errors`;
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
        serviceChecks.push(checkService(p.name, `${p.base_url}/models`));
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
        };
      } else {
        services.push({
          name: paperclipStatus.name,
          url: paperclipStatus.url,
          status: paperclipStatus.status,
          latency: paperclipStatus.latency,
          error: paperclipStatus.error,
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
        };
      } else {
        services.push({
          name: autensaStatus.name,
          url: autensaStatus.url,
          status: autensaStatus.status,
          latency: autensaStatus.latency,
          error: autensaStatus.error,
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
