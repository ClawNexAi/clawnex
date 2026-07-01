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

/** Build cost rates map from openclaw.json providers */
function buildCostMap(ocConfig: Record<string, unknown>): Record<string, { input: number; output: number }> {
  const providers = (ocConfig?.models as Record<string, unknown>)?.providers as Record<string, { models?: Array<{ id: string; cost?: { input: number; output: number } }> }> || {};
  const costMap: Record<string, { input: number; output: number }> = {};
  for (const prov of Object.values(providers)) {
    for (const m of prov.models || []) {
      if (m.cost) costMap[m.id] = { input: m.cost.input, output: m.cost.output };
    }
  }
  return costMap;
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

  // Agent count from openclaw.json
  let agentCount = 0;
  if (ocConfig) {
    const agentsList = (ocConfig?.agents as { list?: Array<{ id: string }> })?.list || [];
    agentCount = agentsList.filter(a => a.id !== "main").length;
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

  // Calculate cost
  let totalCost = 0;
  try {
    const tracked = queryOne<{ total: number }>(
      since
        ? "SELECT COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE 0 END), 0) as total FROM proxy_traffic WHERE timestamp >= ?"
        : "SELECT COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE 0 END), 0) as total FROM proxy_traffic WHERE timestamp >= datetime('now', '-30 days')",
      since ? [since] : undefined
    );
    totalCost = tracked?.total || 0;

    if (ocConfig) {
      const costMap = buildCostMap(ocConfig);
      const localModels = queryAll<{ model: string; input_tokens: number; output_tokens: number }>(
        since
          ? `SELECT model, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens
             FROM proxy_traffic WHERE (cost_usd IS NULL OR cost_usd = 0) AND model IS NOT NULL AND total_tokens > 0 AND timestamp >= ? GROUP BY model`
          : `SELECT model, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens
             FROM proxy_traffic WHERE (cost_usd IS NULL OR cost_usd = 0) AND model IS NOT NULL AND total_tokens > 0 AND timestamp >= datetime('now', '-30 days') GROUP BY model`,
        since ? [since] : undefined
      );
      for (const lm of localModels) {
        const rates = costMap[lm.model];
        if (rates) totalCost += (lm.input_tokens * rates.input) + (lm.output_tokens * rates.output);
      }
    }
  } catch {}
  totalCost = Math.round(totalCost * 100) / 100;

  // Calculate p95 latency from recent traffic
  let p95 = 0;
  try {
    const latency = queryOne<{ p95: number }>(
      "SELECT latency_ms as p95 FROM proxy_traffic WHERE latency_ms > 0 ORDER BY latency_ms DESC LIMIT 1 OFFSET (SELECT COUNT(*) / 20 FROM proxy_traffic WHERE latency_ms > 0)"
    );
    p95 = latency?.p95 || 0;
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
  const localInstance = {
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
    agents: agentCount || ocStatus.agents || 0,
    sessions: sessionCount || ocStatus.sessions || 0,
    p95,
    cost: totalCost,
    posture: postureScore,
    isLive: true,
    services: {
      openclaw: ocStatus.connected ? "online" : "offline",
      paperclip: paperclip.status,
      autensa: autensa.status,
    },
  };

  // Only include local instance when OpenClaw is actually present on this machine.
  // Fresh installs (no openclaw.json, no connection) return an empty array so the
  // welcome screen can render instead of a bogus "local" row.
  const hasOpenClaw = ocStatus.connected || ocConfig != null;
  const instances: Array<typeof localInstance> = hasOpenClaw ? [localInstance] : [];
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
        uptime: 0, cpu: 0, mem: 0, disk: 0, threats: 0, alerts: 0,
        region: "Remote",
        heartbeat: gw.last_connected_at ? new Date(gw.last_connected_at).getTime() : 0,
        agents: 0, sessions: 0, p95: 0, cost: 0,
        posture: gw.status === "connected" ? 80 : 30,
        isLive: gw.status === "connected",
        services: {
          openclaw: gw.status === "connected" ? "online" : "offline",
          paperclip: "offline" as const,
          autensa: "offline" as const,
        },
      });
    }
  } catch {}

  // Hermes Agent fleet instance
  try {
    const { isHermesAvailable, getHermesDb } = require("@/lib/services/hermes-db");
    const { config: appConfig } = require("@/lib/config");
    if (appConfig.hermes.enabled && isHermesAvailable()) {
      const hermesDb = getHermesDb();
      if (hermesDb) {
        const now = Date.now() / 1000;
        const sessionRow = hermesDb.prepare("SELECT COUNT(*) as cnt FROM sessions WHERE started_at > ?").get(now - 86400) as { cnt: number } | undefined;
        const costRow = hermesDb.prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) as cost FROM sessions WHERE started_at > ?").get(now - 86400) as { cost: number } | undefined;
        const agentRow = hermesDb.prepare("SELECT COUNT(DISTINCT source) as cnt FROM sessions WHERE started_at > ?").get(now - 86400) as { cnt: number } | undefined;
        const lastRow = hermesDb.prepare("SELECT started_at FROM sessions ORDER BY started_at DESC LIMIT 1").get() as { started_at: number } | undefined;
        const cnt = sessionRow?.cnt ?? 0;
        instances.push({
          id: "hermes-local",
          client: "Hermes Agent",
          version: "0.8.0",
          status: cnt > 0 ? "healthy" : "degraded",
          uptime: lastRow ? (now - lastRow.started_at) : 0,
          cpu: 0, mem: 0, disk: 0, threats: 0, alerts: 0,
          region: "Local",
          heartbeat: lastRow ? lastRow.started_at * 1000 : 0,
          agents: agentRow?.cnt ?? 0,
          sessions: cnt,
          p95: 0,
          cost: costRow?.cost ?? 0,
          posture: null as number | null,
          isLive: cnt > 0,
          services: { openclaw: "offline" as const, paperclip: "offline" as const, autensa: "offline" as const },
        });
      }
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
      sessions: ocStatus.sessions,
      agents: ocStatus.agents,
      lastEvent: ocStatus.lastEvent,
      lastError: ocStatus.lastError,
    },
    threatTrend,
    timestamp: new Date().toISOString(),
  });
  console.log(`[api/fleet:GET] ${Date.now() - __t0}ms instances=${instances.length}`);
  return response;
}
