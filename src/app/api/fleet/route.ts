/**
 * Fleet API — returns fleet data from config_gateways + real system data.
 * GET /api/fleet?since=ISO-8601
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getOpenClawConnector } from "@/lib/connectors/openclaw-connector";
import { getFullSystemReport } from "@/lib/services/system-metrics";
import { getPaperclipStatus } from "@/lib/connectors/paperclip-connector";
import { getAutensaStatus } from "@/lib/connectors/autensa-connector";
import { queryOne, queryAll } from "@/lib/db/index";
import { activeAlertSqlClause, productionOriginSqlClause } from "@/lib/dashboard/metric-semantics";
import { getLatestClawkeeperPosture } from "@/lib/services/posture-service";
import { readOpenClawConfig as readOpenClawConfigHelper, resolveOpenClawPaths } from "@/lib/openclaw-paths";
import { getOpenClawInstalledVersion } from "@/lib/openclaw-version";
import { diagnoseHermes } from "@/lib/services/hermes-diagnostics";
import { gatherCostRows } from "@/lib/services/cost-reporting";
import {
  derived,
  measured,
  nonNegative,
  notApplicable,
  unavailable,
  type TelemetryValue,
} from "@/lib/telemetry/value";
import { config } from "@/lib/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GatewayRow {
  id: string;
  name: string;
  url: string;
  client_name: string;
  is_active: number;
  is_primary: number;
  status: string;
  last_connected_at: string | null;
  last_error: string | null;
}

/** Read and parse openclaw.json once per request */
function readOpenClawConfig(): Record<string, unknown> | null {
  return readOpenClawConfigHelper();
}

type NumberTelemetry = TelemetryValue<number>;

interface FleetTelemetry {
  configuredAgents: NumberTelemetry;
  activeSessions: NumberTelemetry;
  storedSessions: NumberTelemetry;
  cpu: NumberTelemetry;
  memory: NumberTelemetry;
  disk: NumberTelemetry;
  threats: NumberTelemetry;
  alerts: NumberTelemetry;
  p95LatencyMs: NumberTelemetry;
  costUsd: NumberTelemetry;
}

interface FleetApiInstance {
  id: string;
  client: string;
  version: string;
  status: string;
  uptime: number;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  threats: number | null;
  alerts: number | null;
  region: string;
  heartbeat: number;
  agents: number | null;
  sessions: number | null;
  storedSessions: number | null;
  p95: number | null;
  cost: number | null;
  posture: number | null;
  isLive: boolean;
  services: { openclaw: string; paperclip: string; autensa: string };
  telemetry: FleetTelemetry;
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

  const __t0 = Date.now();
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since");

  const connector = getOpenClawConnector();
  const ocStatus = connector.getConnectionStatus();
  const sysReport = getFullSystemReport();
  const paperclip = getPaperclipStatus();
  const autensa = getAutensaStatus();
  const ocConfig = readOpenClawConfig();

  // TODO(perf): /api/fleet aggregates across ~10 tables (alerts, proxy_traffic,
  // metric_snapshots, config_gateways, shield_scans, config_defaults) plus the
  // openclaw config file and two in-memory connectors. Most individual queries
  // are indexed and fast (<50ms), but the handler still does ~8 DB round-trips
  // sequentially. A proper fix would cache the fleet summary for ~3-5s since
  // the dashboard polls this. Left as-is for now — warm p50 is ~170ms which
  // is acceptable pre-OSS.

  // Count active alerts (open + acknowledged + investigating, production
  // origins only). Per the canonical contract in
  // `lib/dashboard/metric-semantics.ts`, "active" is the single right answer
  // for any user-facing alert count that doesn't explicitly filter on
  // terminal states. Suppressed alerts are excluded because the operator
  // already opted out of being notified about them. Test-generated alerts
  // (origin = shield-test/demo/qa) are also excluded so a Shield Tests run
  // doesn't pollute the Fleet badge.
  let openAlerts = 0;
  try {
    const activeClause = activeAlertSqlClause();
    const prodClause = productionOriginSqlClause('metadata');
    const alertCount = queryOne<{ cnt: number }>(
      since
        ? `SELECT COUNT(*) as cnt FROM alerts WHERE ${activeClause} AND ${prodClause} AND created_at >= ?`
        : `SELECT COUNT(*) as cnt FROM alerts WHERE ${activeClause} AND ${prodClause} AND created_at >= datetime('now', '-24 hours')`,
      since ? [since] : []
    );
    openAlerts = alertCount?.cnt || 0;
  } catch {}

  // Count shield blocks. Same provenance rule: exclude test-generated scans
  // (Shield Tests panel run-all) and session-watcher retroactive detections.
  // shield_scans uses `detail` as its JSON column (not `metadata`).
  let shieldBlocks = 0;
  try {
    const ssProdClause = productionOriginSqlClause('detail');
    const blockCount = queryOne<{ cnt: number }>(
      since
        ? `SELECT COUNT(*) as cnt FROM proxy_traffic WHERE (shield_verdict = 'BLOCK' OR blocked = 1) AND source != 'session-watcher' AND timestamp >= ?`
        : `SELECT COUNT(*) as cnt FROM proxy_traffic WHERE (shield_verdict = 'BLOCK' OR blocked = 1) AND source != 'session-watcher' AND timestamp >= datetime('now', '-24 hours')`,
      since ? [since] : []
    );
    shieldBlocks = blockCount?.cnt || 0;
    // proxy_traffic doesn't carry origin in detail JSON yet (that table is
    // populated by the LiteLLM proxy, not by /api/shield/scan). For shield
    // BLOCK verdicts surfaced from shield_scans elsewhere we use ssProdClause
    // to filter test runs out — the Fleet metric specifically tracks proxy
    // blocks though, so test runs against /api/shield/scan don't show up
    // here regardless. Reference kept for symmetry with shield-stats.
    void ssProdClause;
  } catch {}

  // Configured agents are an inventory measurement. Do not substitute the
  // connector's active-agent count: those answer different questions.
  let agentCount = 0;
  if (ocConfig) {
    const agentsList = (ocConfig?.agents as { list?: Array<{ id: string }> })?.list || [];
    agentCount = agentsList.length;
  }

  // Session count from session files
  let sessionCount = 0;
  try {
    const ocHome = resolveOpenClawPaths().home;
    if (ocHome) {
      const sessDir = path.join(ocHome, "agents", "main", "sessions");
      sessionCount = fs.readdirSync(sessDir).filter(f => f.endsWith(".jsonl")).length;
    }
  } catch {}

  // OpenClaw version — prefer the installed CLI/package over
  // openclaw.json meta.lastTouchedVersion, which can lag after upgrades.
  const ocVersion = getOpenClawInstalledVersion() || "unknown";

  // Cost comes from the same canonical orchestrator used by Token & Cost
  // Intel. Per-source totals are never summed; the headline chooses the best
  // covered source and carries that provenance in telemetry.
  let costTelemetry: NumberTelemetry = unavailable("cost-reporting", "No usable cost rows were observed in the selected window");
  try {
    const sinceMs = since ? Date.parse(since) : Date.now() - 24 * 60 * 60 * 1000;
    const report = await gatherCostRows({ sinceMs: Number.isFinite(sinceMs) ? sinceMs : undefined, instance: "openclaw-local" });
    const total = nonNegative(report.headline?.total);
    if (report.headline && total != null) {
      costTelemetry = derived(total, `cost-reporting:${report.headline.source}`, {
        reason: `Highest covered source total; ${report.perSource[report.headline.source].count} rows`,
      });
    }
  } catch (err) {
    costTelemetry = unavailable("cost-reporting", err instanceof Error ? err.message : "Cost reporting failed");
  }

  // Calculate p95 only when a positive latency sample exists. An empty sample
  // is unavailable, not a measured 0 ms.
  let p95Telemetry: NumberTelemetry = unavailable("proxy_traffic.latency_ms", "No positive latency samples were observed");
  try {
    const latency = queryOne<{ p95: number; sample_count: number; observed_at: string | null }>(
      `SELECT latency_ms AS p95,
              (SELECT COUNT(*) FROM proxy_traffic WHERE latency_ms > 0) AS sample_count,
              (SELECT MAX(timestamp) FROM proxy_traffic WHERE latency_ms > 0) AS observed_at
         FROM proxy_traffic
        WHERE latency_ms > 0
        ORDER BY latency_ms DESC
        LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * 0.05 AS INTEGER) FROM proxy_traffic WHERE latency_ms > 0)`
    );
    const p95 = nonNegative(latency?.p95);
    if (p95 != null && (latency?.sample_count ?? 0) > 0) {
      p95Telemetry = measured(p95, "proxy_traffic.latency_ms", {
        observedAt: latency?.observed_at,
        staleAfterMs: 5 * 60 * 1000,
        reason: `${latency?.sample_count ?? 0} positive latency samples`,
      });
    }
  } catch {}

  // Posture (Phase 3): the Fleet table column previously called "Posture"
  // is now sourced from the canonical Host Security hardening score in
  // posture-service.ts. The composite threat-pressure score from
  // threat-score.ts is a different concept and is not used as the
  // fleet-row "posture" anymore. This change makes the Fleet row, the
  // Readiness Banner, and the Security Posture panel all show the same
  // number for the same scan.
  //
  // The JSON response key is renamed `hardening` (alongside the legacy
  // `posture` alias for transitional backward-compat with any external
  // consumers; the dashboard reads `hardening` going forward). Renames
  // visible to operators happen in the dashboard UI only.
  let postureScore: number | null = null;
  try {
    const latest = getLatestClawkeeperPosture();
    postureScore = latest ? latest.score : null;
  } catch {}

  // Derive client name: config_defaults.display_name → hostname → "local"
  let clientName = "local";
  try {
    const displayNameRow = queryOne<{ value: string }>(
      "SELECT value FROM config_defaults WHERE key = 'display_name'"
    );
    if (displayNameRow?.value) {
      clientName = displayNameRow.value;
    } else {
      clientName = os.hostname();
    }
  } catch {
    try { clientName = os.hostname(); } catch {}
  }

  // Build the local instance
  const observedNow = new Date().toISOString();
  const configuredAgentsTelemetry = ocConfig
    ? measured(agentCount, "openclaw.json:agents.list", { observedAt: observedNow, staleAfterMs: 60_000 })
    : unavailable<number>("openclaw.json:agents.list", "OpenClaw configuration is unavailable");
  const activeSessionsTelemetry = ocStatus.connected
    ? measured(ocStatus.sessions, "openclaw-gateway:active-sessions", { observedAt: ocStatus.lastEvent || observedNow, staleAfterMs: 30_000 })
    : unavailable<number>("openclaw-gateway:active-sessions", "OpenClaw Gateway is not connected");
  const storedSessionsTelemetry = ocConfig
    ? measured(sessionCount, "openclaw-session-files", { observedAt: observedNow, staleAfterMs: 60_000 })
    : unavailable<number>("openclaw-session-files", "OpenClaw session inventory is unavailable");
  const localInstance: FleetApiInstance = {
    id: "openclaw-local",
    client: clientName,
    version: ocVersion,
    status: ocStatus.connected ? "healthy" : ocStatus.lastError ? "critical" : "degraded",
    uptime: process.uptime(),
    cpu: sysReport.system?.cpuUsage ?? 0,
    mem: sysReport.system?.memUsage ?? 0,
    disk: sysReport.disk?.length > 0 ? parseInt(String(sysReport.disk[0]?.usePct || "0")) : 0,
    threats: shieldBlocks,
    alerts: openAlerts,
    region: "Local",
    heartbeat: Date.now(),
    agents: configuredAgentsTelemetry.value,
    sessions: activeSessionsTelemetry.value,
    storedSessions: storedSessionsTelemetry.value,
    p95: p95Telemetry.value,
    cost: costTelemetry.value == null ? null : Math.round(costTelemetry.value * 100) / 100,
    posture: postureScore,
    isLive: true,
    services: {
      openclaw: ocStatus.connected ? "online" : "offline",
      paperclip: paperclip.status,
      autensa: autensa.status,
    },
    telemetry: {
      configuredAgents: configuredAgentsTelemetry,
      activeSessions: activeSessionsTelemetry,
      storedSessions: storedSessionsTelemetry,
      cpu: measured(sysReport.system?.cpuUsage ?? 0, "host-system-metrics", { staleAfterMs: 30_000 }),
      memory: measured(sysReport.system?.memUsage ?? 0, "host-system-metrics", { staleAfterMs: 30_000 }),
      disk: measured(sysReport.disk?.length > 0 ? parseInt(String(sysReport.disk[0]?.usePct || "0")) : 0, "host-system-metrics", { staleAfterMs: 60_000 }),
      threats: measured(shieldBlocks, "proxy_traffic:block-verdicts", { staleAfterMs: 30_000 }),
      alerts: measured(openAlerts, "alerts:active-production", { staleAfterMs: 30_000 }),
      p95LatencyMs: p95Telemetry,
      costUsd: costTelemetry,
    },
  };

  // Only include local instance when OpenClaw is actually present on this machine.
  // Fresh installs (no openclaw.json, no connection) return an empty array so the
  // welcome screen can render instead of a bogus "local" row.
  const hasOpenClaw = ocStatus.connected || ocConfig != null;
  const instances: FleetApiInstance[] = hasOpenClaw ? [localInstance] : [];
  try {
    const gateways = queryAll<GatewayRow>(
      "SELECT * FROM config_gateways WHERE is_active = 1 ORDER BY is_primary DESC, name ASC",
    );
    for (const gw of gateways) {
      if (gw.is_primary) continue;
      instances.push({
        id: gw.id,
        client: gw.client_name || gw.name,
        version: "--",
        status: gw.status === "connected" ? "healthy" : gw.status === "error" ? "critical" : "degraded",
        uptime: 0, cpu: null, mem: null, disk: null, threats: null, alerts: null,
        region: "Remote",
        heartbeat: gw.last_connected_at ? new Date(gw.last_connected_at).getTime() : 0,
        agents: null, sessions: null, storedSessions: null, p95: null, cost: null,
        posture: gw.status === "connected" ? 80 : 30,
        isLive: gw.status === "connected",
        services: {
          openclaw: gw.status === "connected" ? "online" : "offline",
          paperclip: "offline" as const,
          autensa: "offline" as const,
        },
        telemetry: {
          configuredAgents: unavailable("remote-gateway", "Remote agent inventory is not implemented"),
          activeSessions: unavailable("remote-gateway", "Remote session telemetry is not implemented"),
          storedSessions: unavailable("remote-gateway", "Remote session inventory is not implemented"),
          cpu: unavailable("remote-gateway", "Remote host metrics are not implemented"),
          memory: unavailable("remote-gateway", "Remote host metrics are not implemented"),
          disk: unavailable("remote-gateway", "Remote host metrics are not implemented"),
          threats: unavailable("remote-gateway", "Remote threat telemetry is not implemented"),
          alerts: unavailable("remote-gateway", "Remote alert telemetry is not implemented"),
          p95LatencyMs: unavailable("remote-gateway", "Remote latency telemetry is not implemented"),
          costUsd: unavailable("remote-gateway", "Remote cost telemetry is not implemented"),
        },
      });
    }
  } catch {}

  // Hermes Agent fleet instance — source state comes from the same
  // diagnostics service used by Health and Infrastructure so "live/stale/
  // unreadable" means one thing across the product.
  try {
    const hermes = diagnoseHermes();
    if (config.hermes.enabled && hermes.installed) {
      const hermesObservedAt = hermes.lastActivity;
      const hermesFreshness = 7 * 24 * 60 * 60 * 1000;
      const hermesSessions = hermes.available
        ? measured(hermes.sessions.last24h, "hermes.state.db:sessions", { observedAt: hermesObservedAt, staleAfterMs: hermesFreshness })
        : unavailable<number>("hermes.state.db:sessions", hermes.statusDetail || "Hermes state database is unavailable");
      const hermesAgents = notApplicable<number>("hermes.state.db", "Hermes exposes channels and sessions, not an agent inventory");
      instances.push({
        id: "hermes-local",
        client: "Hermes Agent",
        version: hermes.activeProfile ? `profile:${hermes.activeProfile}` : "state.db",
        status: hermes.available
          ? hermes.status === "live" ? "healthy" : "degraded"
          : "critical",
        uptime: hermes.lastActivityAgeSeconds ?? 0,
        cpu: null, mem: null, disk: null, threats: null, alerts: null,
        region: "Local",
        heartbeat: hermes.lastActivity ? new Date(hermes.lastActivity).getTime() : 0,
        agents: null,
        sessions: hermesSessions.value,
        storedSessions: hermes.available ? hermes.sessions.total : null,
        p95: null,
        cost: null,
        posture: null as number | null,
        isLive: hermes.status === "live",
        services: { openclaw: "offline" as const, paperclip: "offline" as const, autensa: "offline" as const },
        telemetry: {
          configuredAgents: hermesAgents,
          activeSessions: hermesSessions,
          storedSessions: hermes.available
            ? measured(hermes.sessions.total, "hermes.state.db:sessions", { observedAt: hermesObservedAt, staleAfterMs: hermesFreshness })
            : unavailable("hermes.state.db:sessions", hermes.statusDetail || "Hermes state database is unavailable"),
          cpu: notApplicable("hermes.state.db", "Hermes does not expose host CPU telemetry"),
          memory: notApplicable("hermes.state.db", "Hermes does not expose host memory telemetry"),
          disk: notApplicable("hermes.state.db", "Hermes does not expose host disk telemetry"),
          threats: unavailable("hermes.state.db", "Hermes threat totals are not available from state.db"),
          alerts: unavailable("hermes.state.db", "Hermes alert totals are not available from state.db"),
          p95LatencyMs: notApplicable("hermes.state.db", "Hermes does not expose request latency in state.db"),
          costUsd: unavailable("hermes.state.db", "No usable Hermes cost rows were observed"),
        },
      });
    }
  } catch {}

  // Threat trend from metric snapshots
  let threatTrend: number[] = [];
  try {
    const scores = queryAll<{ metric_value: number }>(
      "SELECT metric_value FROM metric_snapshots WHERE metric_name = 'threat_score' AND source = 'correlation-engine' ORDER BY recorded_at DESC LIMIT 12"
    );
    threatTrend = scores.map(s => s.metric_value).reverse();
  } catch {}

  const response = NextResponse.json({
    instances,
    total: instances.length,
    healthy: instances.filter(i => i.status === "healthy").length,
    openclaw: {
      connected: ocStatus.connected,
      authenticated: ocStatus.authenticated,
      sessions: activeSessionsTelemetry.value,
      agents: configuredAgentsTelemetry.value,
      storedSessions: storedSessionsTelemetry.value,
      telemetry: {
        configuredAgents: configuredAgentsTelemetry,
        activeSessions: activeSessionsTelemetry,
        storedSessions: storedSessionsTelemetry,
      },
      lastEvent: ocStatus.lastEvent,
      lastError: ocStatus.lastError,
    },
    threatTrend,
    timestamp: new Date().toISOString(),
  });
  console.log(`[api/fleet:GET] ${Date.now() - __t0}ms instances=${instances.length}`);
  return response;
}
