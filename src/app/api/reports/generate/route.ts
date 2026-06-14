/**
 * POST /api/reports/generate
 * Generates executive reports from real data across multiple APIs.
 *
 * Body: { reportType: string, format: "pdf" | "md" | "xlsx", timeRange: string }
 * Returns: { content: string, filename: string, format: string, generatedAt: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { checkRateLimit } from "@/lib/rate-limiter";
import { queryAll, queryOne } from "@/lib/db/index";
import { CLAWNEX_VERSION } from "@/lib/version";
import { setSetting } from "@/lib/services/config-service";
import { activeAlertSqlClause } from "@/lib/dashboard/metric-semantics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CX-R14-08 — cap each per-table query so a 30-day consolidated report
// can't pull 10 × 10K rows × multiple tables into memory and stringify them
// into Markdown/CSV. 2000 is comfortable headroom for normal SOC volumes:
// even at 60+ alerts/day a 30-day report fits well under the cap, and an
// operator who genuinely needs the long tail can paginate with explicit
// time-range narrowing. Used everywhere `LIMIT ${REPORT_ROW_CAP}` used to be hard-coded.
const REPORT_ROW_CAP = 2000;

// Reports per minute per operator. Generation itself is CPU+memory heavy
// (queryAll across multiple tables → Markdown render → optional XLSX/PDF
// transform), and even with the row cap an authenticated operator can pin
// the Node process if they fire-hose this endpoint. 6/minute = 1 every 10s
// is generous for human use and aggressive for runaway scripts.
const REPORT_RATE_LIMIT_PER_MIN = 6;

interface AlertRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  source: string;
  created_at: string;
  resolved_at: string | null;
  acknowledged_by: string | null;
}

interface ShieldScanRow {
  id: string;
  direction: string;
  layers_triggered: string;
  threat_level: string;
  detail: string | null;
  scanned_at: string;
}

interface AuditRow {
  id: string;
  actor: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: string | null;
  source: string;
  created_at: string;
}

interface CorrelationRow {
  id: string;
  correlation_rule: string;
  source_events: string;
  severity: string;
  status: string;
  created_at: string;
}

interface MetricRow {
  source: string;
  metric_name: string;
  metric_value: number;
  recorded_at: string;
}

function getSince(timeRange: string): string {
  const ms: Record<string, number> = {
    "1h": 3600000,
    "6h": 21600000,
    "24h": 86400000,
    "7d": 604800000,
    "30d": 2592000000,
  };
  return new Date(Date.now() - (ms[timeRange] || 86400000)).toISOString();
}

function generateFleetPosture(since: string): string {
  const alerts = queryAll<AlertRow>(
    `SELECT * FROM alerts WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );
  const openAlerts = alerts.filter((a) => a.status === "open");
  const criticalAlerts = openAlerts.filter((a) => a.severity === "CRITICAL");
  const highAlerts = openAlerts.filter((a) => a.severity === "HIGH");

  const shieldStats = queryOne<{ total: number; blocked: number; reviewed: number; allowed: number }>(
    `SELECT COUNT(*) as total,
       SUM(CASE WHEN threat_level = 'BLOCK' THEN 1 ELSE 0 END) as blocked,
       SUM(CASE WHEN threat_level = 'REVIEW' THEN 1 ELSE 0 END) as reviewed,
       SUM(CASE WHEN threat_level = 'ALLOW' THEN 1 ELSE 0 END) as allowed
     FROM shield_scans WHERE scanned_at >= ?`,
    [since]
  );

  const auditCount = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM audit_log WHERE created_at >= ?`,
    [since]
  );

  let score = 100;
  if (criticalAlerts.length > 0) score -= criticalAlerts.length * 15;
  if (highAlerts.length > 0) score -= highAlerts.length * 8;
  if ((shieldStats?.blocked ?? 0) > 5) score -= 10;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return `# Fleet Posture Summary

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Security Posture

| Metric | Value |
|--------|-------|
| Posture Score | ${score}/100 |
| Grade | ${grade} |
| Status | ${score >= 80 ? "HEALTHY" : score >= 60 ? "DEGRADED" : "CRITICAL"} |

## Alert Overview

| Severity | Open | Total |
|----------|------|-------|
| CRITICAL | ${criticalAlerts.length} | ${alerts.filter((a) => a.severity === "CRITICAL").length} |
| HIGH | ${highAlerts.length} | ${alerts.filter((a) => a.severity === "HIGH").length} |
| MEDIUM | ${openAlerts.filter((a) => a.severity === "MEDIUM").length} | ${alerts.filter((a) => a.severity === "MEDIUM").length} |
| LOW | ${openAlerts.filter((a) => a.severity === "LOW").length} | ${alerts.filter((a) => a.severity === "LOW").length} |
| **Total** | **${openAlerts.length}** | **${alerts.length}** |

## Shield Summary

| Metric | Count |
|--------|-------|
| Total Scans | ${shieldStats?.total ?? 0} |
| Blocked | ${shieldStats?.blocked ?? 0} |
| Under Review | ${shieldStats?.reviewed ?? 0} |
| Allowed | ${shieldStats?.allowed ?? 0} |

## Audit Trail

- **Total events in period:** ${auditCount?.cnt ?? 0}

${openAlerts.length > 0 ? `## Open Alerts\n\n${openAlerts.slice(0, 10).map((a) => `- **[${a.severity}]** ${a.title} (${a.source}) — ${new Date(a.created_at).toLocaleString()}`).join("\n")}` : "No open alerts."}
`;
}

function generateIncidentReport(since: string): string {
  const alerts = queryAll<AlertRow>(
    `SELECT * FROM alerts WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );
  const correlations = queryAll<CorrelationRow>(
    `SELECT * FROM correlation_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );
  const criticalAlerts = alerts.filter((a) => a.severity === "CRITICAL" || a.severity === "HIGH");

  return `# Incident Report

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Summary

- **Total Alerts:** ${alerts.length}
- **Critical/High Alerts:** ${criticalAlerts.length}
- **Correlations Detected:** ${correlations.length}
- **Open Incidents:** ${alerts.filter((a) => a.status === "open").length}

## Alert Timeline

| Time | Severity | Title | Source | Status |
|------|----------|-------|--------|--------|
${alerts.slice(0, 25).map((a) => `| ${new Date(a.created_at).toLocaleString()} | ${a.severity} | ${a.title} | ${a.source} | ${a.status} |`).join("\n")}

## Correlations

${correlations.length > 0 ? correlations.slice(0, 15).map((c) => {
  let events: Array<{ source?: string; type?: string }> = [];
  try { events = JSON.parse(c.source_events); } catch { /* ignore */ }
  return `### ${c.correlation_rule} (${c.severity})
- **Status:** ${c.status}
- **Events:** ${events.length} correlated events
- **Detected:** ${new Date(c.created_at).toLocaleString()}
`;
}).join("\n") : "No correlations detected in this period."}

## Recommendations

${criticalAlerts.length > 0 ? "- Investigate all CRITICAL alerts immediately\n- Review correlation chains for coordinated attacks\n- Verify shield blocks are operating correctly" : "- Continue monitoring\n- No critical incidents requiring immediate action"}
`;
}

function generateShieldAnalysis(since: string): string {
  const scans = queryAll<ShieldScanRow>(
    `SELECT * FROM shield_scans WHERE scanned_at >= ? ORDER BY scanned_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );
  const blocked = scans.filter((s) => s.threat_level === "BLOCK");
  const reviewed = scans.filter((s) => s.threat_level === "REVIEW");
  const allowed = scans.filter((s) => s.threat_level === "ALLOW");

  const categoryMap: Record<string, number> = {};
  for (const scan of scans) {
    if (scan.layers_triggered) {
      const layers = scan.layers_triggered.split(",").map((l) => l.trim());
      for (const layer of layers) {
        if (layer) categoryMap[layer] = (categoryMap[layer] || 0) + 1;
      }
    }
  }
  const sortedCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);

  return `# Prompt Shield Analysis

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Scan Statistics

| Verdict | Count | Percentage |
|---------|-------|------------|
| BLOCK | ${blocked.length} | ${scans.length > 0 ? ((blocked.length / scans.length) * 100).toFixed(1) : 0}% |
| REVIEW | ${reviewed.length} | ${scans.length > 0 ? ((reviewed.length / scans.length) * 100).toFixed(1) : 0}% |
| ALLOW | ${allowed.length} | ${scans.length > 0 ? ((allowed.length / scans.length) * 100).toFixed(1) : 0}% |
| **Total** | **${scans.length}** | **100%** |

## Top Threat Categories

| Category | Detections |
|----------|------------|
${sortedCategories.slice(0, 10).map(([cat, count]) => `| ${cat} | ${count} |`).join("\n") || "| (none) | 0 |"}

## Recent Notable Detections

${blocked.slice(0, 10).map((s) => `- **[BLOCK]** ${s.layers_triggered || "unknown"} — ${s.detail || "No detail"} (${new Date(s.scanned_at).toLocaleString()})`).join("\n") || "No blocked scans in this period."}

## Reviewed Scans

${reviewed.slice(0, 10).map((s) => `- **[REVIEW]** ${s.layers_triggered || "unknown"} — ${s.detail || "No detail"} (${new Date(s.scanned_at).toLocaleString()})`).join("\n") || "No scans under review in this period."}
`;
}

function generateSLACompliance(since: string): string {
  const alerts = queryAll<AlertRow>(
    `SELECT * FROM alerts WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  const resolved = alerts.filter((a) => a.resolved_at);
  const avgResponseMs = resolved.length > 0
    ? resolved.reduce((sum, a) => {
        const created = new Date(a.created_at).getTime();
        const resolvedAt = new Date(a.resolved_at!).getTime();
        return sum + (resolvedAt - created);
      }, 0) / resolved.length
    : 0;
  const avgResponseMin = Math.round(avgResponseMs / 60000);

  const slaTargets: Record<string, number> = {
    CRITICAL: 15,
    HIGH: 60,
    MEDIUM: 240,
    LOW: 1440,
  };

  let breaches = 0;
  for (const a of resolved) {
    const responseMin = (new Date(a.resolved_at!).getTime() - new Date(a.created_at).getTime()) / 60000;
    const target = slaTargets[a.severity] || 1440;
    if (responseMin > target) breaches++;
  }

  const acknowledged = alerts.filter((a) => a.acknowledged_by);

  return `# SLA Compliance Report

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Summary

| Metric | Value |
|--------|-------|
| Total Alerts | ${alerts.length} |
| Resolved | ${resolved.length} |
| Acknowledged | ${acknowledged.length} |
| Avg Response Time | ${avgResponseMin} min |
| SLA Breaches | ${breaches} |
| Compliance Rate | ${alerts.length > 0 ? (((alerts.length - breaches) / alerts.length) * 100).toFixed(1) : 100}% |

## SLA Targets

| Severity | Target (min) | Alerts | Breaches |
|----------|-------------|--------|----------|
| CRITICAL | ${slaTargets.CRITICAL} | ${alerts.filter((a) => a.severity === "CRITICAL").length} | ${resolved.filter((a) => a.severity === "CRITICAL" && (new Date(a.resolved_at!).getTime() - new Date(a.created_at).getTime()) / 60000 > slaTargets.CRITICAL).length} |
| HIGH | ${slaTargets.HIGH} | ${alerts.filter((a) => a.severity === "HIGH").length} | ${resolved.filter((a) => a.severity === "HIGH" && (new Date(a.resolved_at!).getTime() - new Date(a.created_at).getTime()) / 60000 > slaTargets.HIGH).length} |
| MEDIUM | ${slaTargets.MEDIUM} | ${alerts.filter((a) => a.severity === "MEDIUM").length} | ${resolved.filter((a) => a.severity === "MEDIUM" && (new Date(a.resolved_at!).getTime() - new Date(a.created_at).getTime()) / 60000 > slaTargets.MEDIUM).length} |
| LOW | ${slaTargets.LOW} | ${alerts.filter((a) => a.severity === "LOW").length} | ${resolved.filter((a) => a.severity === "LOW" && (new Date(a.resolved_at!).getTime() - new Date(a.created_at).getTime()) / 60000 > slaTargets.LOW).length} |

## Resolution Status

| Status | Count |
|--------|-------|
| Open | ${alerts.filter((a) => a.status === "open").length} |
| Acknowledged | ${alerts.filter((a) => a.status === "acknowledged").length} |
| Resolved | ${alerts.filter((a) => a.status === "resolved").length} |
`;
}

function generateCostAnalysis(since: string): string {
  const metrics = queryAll<MetricRow>(
    `SELECT * FROM metric_snapshots WHERE recorded_at >= ? ORDER BY recorded_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  const tokenMetrics = metrics.filter((m) => m.metric_name.includes("token") || m.metric_name.includes("cost"));
  const bySource: Record<string, { total: number; count: number }> = {};
  for (const m of metrics) {
    if (!bySource[m.source]) bySource[m.source] = { total: 0, count: 0 };
    bySource[m.source].total += m.metric_value;
    bySource[m.source].count++;
  }

  const byMetric: Record<string, { total: number; count: number }> = {};
  for (const m of metrics) {
    if (!byMetric[m.metric_name]) byMetric[m.metric_name] = { total: 0, count: 0 };
    byMetric[m.metric_name].total += m.metric_value;
    byMetric[m.metric_name].count++;
  }

  return `# Cost Analysis Report

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Summary

- **Total Metric Snapshots:** ${metrics.length}
- **Token/Cost Metrics:** ${tokenMetrics.length}

## Usage by Source

| Source | Samples | Total Value | Avg Value |
|--------|---------|-------------|-----------|
${Object.entries(bySource).map(([src, data]) => `| ${src} | ${data.count} | ${data.total.toFixed(2)} | ${(data.total / data.count).toFixed(2)} |`).join("\n") || "| (none) | 0 | 0 | 0 |"}

## Metrics Breakdown

| Metric | Samples | Total | Average |
|--------|---------|-------|---------|
${Object.entries(byMetric).slice(0, 15).map(([name, data]) => `| ${name} | ${data.count} | ${data.total.toFixed(2)} | ${(data.total / data.count).toFixed(2)} |`).join("\n") || "| (none) | 0 | 0 | 0 |"}

## Notes

- Cost projections are based on observed token consumption rates
- Actual billing may vary based on provider pricing tiers
`;
}

function generateTrafficSummary(since: string): string {
  interface TrafficRow { model: string | null; provider: string | null; shield_verdict: string | null; shield_score: number | null; total_tokens: number | null; latency_ms: number | null; source: string | null; blocked: number; timestamp: string; }
  const traffic = queryAll<TrafficRow>(
    `SELECT model, provider, shield_verdict, shield_score, total_tokens, latency_ms, source, blocked, timestamp FROM proxy_traffic WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  const byModel: Record<string, { count: number; tokens: number; blocked: number }> = {};
  const byVerdict: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let totalTokens = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const t of traffic) {
    const model = t.model || "unknown";
    if (!byModel[model]) byModel[model] = { count: 0, tokens: 0, blocked: 0 };
    byModel[model].count++;
    byModel[model].tokens += t.total_tokens || 0;
    if (t.blocked) byModel[model].blocked++;

    const verdict = t.shield_verdict || "UNKNOWN";
    byVerdict[verdict] = (byVerdict[verdict] || 0) + 1;

    const source = t.source || "unknown";
    bySource[source] = (bySource[source] || 0) + 1;

    totalTokens += t.total_tokens || 0;
    if (t.latency_ms && t.latency_ms > 0) { totalLatency += t.latency_ms; latencyCount++; }
  }

  const sortedModels = Object.entries(byModel).sort((a, b) => b[1].count - a[1].count);
  const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
  const blockedCount = traffic.filter(t => t.blocked).length;
  const highScoreCount = traffic.filter(t => (t.shield_score || 0) >= 25).length;

  return `# Traffic & Threat Summary

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Overview

| Metric | Value |
|--------|-------|
| Total Requests | ${traffic.length} |
| Total Tokens | ${totalTokens.toLocaleString()} |
| Average Latency | ${avgLatency}ms |
| Blocked Requests | ${blockedCount} |
| Flagged (score >= 25) | ${highScoreCount} |

## Verdict Distribution

| Verdict | Count | Percentage |
|---------|-------|------------|
${Object.entries(byVerdict).sort((a, b) => b[1] - a[1]).map(([v, c]) => `| ${v} | ${c} | ${traffic.length > 0 ? ((c / traffic.length) * 100).toFixed(1) : 0}% |`).join("\n") || "| (none) | 0 | 0% |"}

## Traffic by Model

| Model | Requests | Tokens | Blocked |
|-------|----------|--------|---------|
${sortedModels.slice(0, 10).map(([m, d]) => `| ${m} | ${d.count} | ${d.tokens.toLocaleString()} | ${d.blocked} |`).join("\n") || "| (none) | 0 | 0 | 0 |"}

## Traffic by Source

| Source | Count |
|--------|-------|
${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([s, c]) => `| ${s} | ${c} |`).join("\n") || "| (none) | 0 |"}

## High-Score Requests (Score >= 50)

${traffic.filter(t => (t.shield_score || 0) >= 50).slice(0, 15).map(t => `- **[${t.shield_verdict}] Score ${t.shield_score}** — ${t.model || "unknown"} via ${t.provider || "unknown"} (${new Date(t.timestamp).toLocaleString()})`).join("\n") || "No high-score requests in this period."}
`;
}

function generateBreakGlassAudit(since: string): string {
  const bgAudits = queryAll<AuditRow>(
    `SELECT * FROM audit_log WHERE action LIKE 'break_glass%' AND created_at >= ? ORDER BY created_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  const bgAlerts = queryAll<AlertRow>(
    `SELECT * FROM alerts WHERE source = 'break-glass' AND created_at >= ? ORDER BY created_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  interface BGTrafficRow { timestamp: string; model: string | null; shield_verdict: string | null; }
  const bgTraffic = queryAll<BGTrafficRow>(
    `SELECT timestamp, model, shield_verdict FROM proxy_traffic WHERE source = 'break-glass' AND timestamp >= ? ORDER BY timestamp DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  // Parse activation details from audit entries
  const activations = bgAudits.filter(a => a.action === "break_glass_activated");
  const deactivations = bgAudits.filter(a => a.action === "break_glass_deactivated" || a.action === "break_glass_expired");

  return `# Break-Glass Audit Trail

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Summary

| Metric | Value |
|--------|-------|
| Total Activations | ${activations.length} |
| Total Deactivations/Expiries | ${deactivations.length} |
| Related Alerts | ${bgAlerts.length} |
| Unscanned Traffic (during bypass) | ${bgTraffic.length} requests |

## Activation History

${activations.length > 0 ? `| Time | Actor | Detail |
|------|-------|--------|
${activations.map(a => `| ${new Date(a.created_at).toLocaleString()} | ${a.actor || "operator"} | ${a.detail || "--"} |`).join("\n")}` : "No break-glass activations in this period."}

## Deactivation / Expiry History

${deactivations.length > 0 ? `| Time | Type | Detail |
|------|------|--------|
${deactivations.map(a => `| ${new Date(a.created_at).toLocaleString()} | ${a.action === "break_glass_expired" ? "Auto-Expired" : "Manual Deactivation"} | ${a.detail || "--"} |`).join("\n")}` : "No deactivations in this period."}

## Break-Glass Alerts

${bgAlerts.length > 0 ? `| Time | Severity | Title |
|------|----------|-------|
${bgAlerts.map(a => `| ${new Date(a.created_at).toLocaleString()} | ${a.severity} | ${a.title} |`).join("\n")}` : "No break-glass alerts in this period."}

## Bypassed Traffic

- **Total bypassed requests:** ${bgTraffic.length}
${bgTraffic.length > 0 ? `- **Models used during bypass:** ${Array.from(new Set(bgTraffic.map(t => t.model || "unknown"))).join(", ")}

| Time | Model | Verdict |
|------|-------|---------|
${bgTraffic.slice(0, 20).map(t => `| ${new Date(t.timestamp).toLocaleString()} | ${t.model || "unknown"} | ${t.shield_verdict || "BYPASSED"} |`).join("\n")}` : "No traffic during break-glass windows."}

## Compliance Notes

- All break-glass activations require a stated reason and explicit "CONFIRM" input
- Maximum duration: 4 hours with automatic expiry
- 15-minute cool-down between activations
- All events are immutably logged in the audit trail
`;
}

function generateRetentionCompliance(since: string): string {
  interface CountRow { cnt: number; }
  const retentionSettings: Record<string, string> = {};
  try {
    const rows = queryAll<{ key: string; value: string }>(
      `SELECT key, value FROM config_defaults WHERE key LIKE 'retention_%'`
    );
    for (const r of rows) retentionSettings[r.key] = r.value;
  } catch { /* ignore */ }

  const defaults: Record<string, { label: string; defaultDays: number }> = {
    retention_traffic_days: { label: "Traffic Logs", defaultDays: 3 },
    retention_metrics_days: { label: "System Metrics", defaultDays: 3 },
    retention_correlations_days: { label: "Correlations", defaultDays: 3 },
    retention_alerts_days: { label: "Alerts & Incidents", defaultDays: 90 },
    retention_audit_days: { label: "Audit Trail", defaultDays: 365 },
  };

  const tableCounts: Record<string, number> = {};
  const tables = ["proxy_traffic", "shield_scans", "metric_snapshots", "correlation_events", "alerts", "incidents", "audit_log"];
  for (const table of tables) {
    try {
      const row = queryOne<CountRow>(`SELECT COUNT(*) as cnt FROM ${table}`);
      tableCounts[table] = row?.cnt || 0;
    } catch { tableCounts[table] = 0; }
  }

  const auditRetentionDays = parseInt(retentionSettings["retention_audit_days"] || "365", 10);
  const isUnlimited = auditRetentionDays === 0;

  return `# Data Retention Compliance Report

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Retention Policy Configuration

| Category | Configured | Default | Status |
|----------|-----------|---------|--------|
${Object.entries(defaults).map(([key, def]) => {
    const val = retentionSettings[key] ? parseInt(retentionSettings[key], 10) : def.defaultDays;
    const display = val === 0 ? "Unlimited" : `${val} days`;
    return `| ${def.label} | ${display} | ${def.defaultDays} days | ${retentionSettings[key] ? "Custom" : "Default"} |`;
  }).join("\n")}

## Database Table Sizes

| Table | Records | Retention Category |
|-------|---------|-------------------|
| proxy_traffic | ${tableCounts["proxy_traffic"]?.toLocaleString()} | Traffic Logs |
| shield_scans | ${tableCounts["shield_scans"]?.toLocaleString()} | Traffic Logs |
| metric_snapshots | ${tableCounts["metric_snapshots"]?.toLocaleString()} | System Metrics |
| correlation_events | ${tableCounts["correlation_events"]?.toLocaleString()} | Correlations |
| alerts | ${tableCounts["alerts"]?.toLocaleString()} | Alerts & Incidents |
| incidents | ${tableCounts["incidents"]?.toLocaleString()} | Alerts & Incidents |
| audit_log | ${tableCounts["audit_log"]?.toLocaleString()} | Audit Trail |

## Compliance Assessment

| Requirement | Status | Notes |
|-------------|--------|-------|
| Audit trail retention >= 1 year | ${auditRetentionDays >= 365 || isUnlimited ? "PASS" : "REVIEW"} | ${isUnlimited ? "Set to unlimited" : `${auditRetentionDays} days configured`} |
| Alert history >= 90 days | ${parseInt(retentionSettings["retention_alerts_days"] || "90", 10) >= 90 ? "PASS" : "REVIEW"} | ${retentionSettings["retention_alerts_days"] || "90"} days |
| Automated enforcement | PASS | Runs on startup + hourly |
| Retention changes audited | PASS | All changes logged to audit trail |
| Configuration accessible | PASS | Dashboard → Configuration → Data Retention |

## SOC 2 Alignment

- **CC7.1 (Detection of Changes):** Audit trail captures all configuration changes including retention settings
- **A1.2 (Recovery):** Retention policy ensures data availability within configured windows
- **CC6.1 (Logical Access):** Retention configuration requires dashboard access (localhost)
`;
}

function generateSkillsInventory(): string {
  // Read skills from filesystem
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const ocHome = path.resolve(os.homedir(), '.openclaw');
  const systemDir = path.join(os.homedir(), '.openclaw', 'skills');
  const workspaceDir = path.join(os.homedir(), '.openclaw', 'workspace', 'skills');

  interface SkillInfo { name: string; description: string; source: string; risk: string; }
  const skills: SkillInfo[] = [];

  function classifyRisk(name: string, desc: string): string {
    const text = (name + ' ' + desc).toLowerCase();
    if (text.includes('browser') || text.includes('bash') || text.includes('deploy') || text.includes('exec')) return 'HIGH';
    if (text.includes('api') || text.includes('email') || text.includes('slack') || text.includes('web')) return 'MEDIUM';
    return 'LOW';
  }

  function readDir(dir: string, source: string) {
    // Trust boundary: ensure the directory stays under ~/.openclaw
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(ocHome)) return;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const skillDir = path.join(dir, entry);
        // Verify resolved path stays under ~/.openclaw (prevent symlink escape)
        if (!path.resolve(skillDir).startsWith(ocHome)) continue;
        try { if (!fs.statSync(skillDir).isDirectory()) continue; } catch { continue; }
        let name = entry;
        let description = '';
        try {
          const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const descMatch = content.match(/^description:\s*"?(.+?)"?\s*$/m);
          if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
          if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '').slice(0, 100);
        } catch { /* no SKILL.md */ }
        skills.push({ name, description, source, risk: classifyRisk(name, description) });
      }
    } catch { /* dir doesn't exist */ }
  }

  readDir(systemDir, 'System');
  readDir(workspaceDir, 'Workspace');

  const highRisk = skills.filter(s => s.risk === 'HIGH');
  const medRisk = skills.filter(s => s.risk === 'MEDIUM');
  const lowRisk = skills.filter(s => s.risk === 'LOW');

  return `# Skills & Plugins Inventory

**Generated:** ${new Date().toISOString()}

---

## Summary

| Metric | Value |
|--------|-------|
| Total Skills | ${skills.length} |
| System Skills | ${skills.filter(s => s.source === 'System').length} |
| Workspace Skills | ${skills.filter(s => s.source === 'Workspace').length} |
| High Risk | ${highRisk.length} |
| Medium Risk | ${medRisk.length} |
| Low Risk | ${lowRisk.length} |

## Risk Assessment

${highRisk.length > 0 ? `### HIGH Risk Skills

| Name | Source | Description |
|------|--------|-------------|
${highRisk.map(s => `| ${s.name} | ${s.source} | ${s.description || "--"} |`).join("\n")}
` : ""}
${medRisk.length > 0 ? `### MEDIUM Risk Skills

| Name | Source | Description |
|------|--------|-------------|
${medRisk.map(s => `| ${s.name} | ${s.source} | ${s.description || "--"} |`).join("\n")}
` : ""}
### LOW Risk Skills

| Name | Source | Description |
|------|--------|-------------|
${lowRisk.map(s => `| ${s.name} | ${s.source} | ${s.description || "--"} |`).join("\n") || "| (none) | -- | -- |"}

## Complete Inventory

| # | Name | Source | Risk | Description |
|---|------|--------|------|-------------|
${skills.map((s, i) => `| ${i + 1} | ${s.name} | ${s.source} | ${s.risk} | ${s.description || "--"} |`).join("\n")}

## Recommendations

${highRisk.length > 0 ? `- Review HIGH risk skills: ${highRisk.map(s => s.name).join(", ")}. These have shell/browser/deploy access.` : "- No high-risk skills detected."}
- Periodically audit workspace skills — they can be added by agents
- System skills are installed by administrators and are generally trusted
`;
}

function generateWhitelistReview(): string {
  let whitelist: string[] = [];
  try {
    const row = queryOne<{ value: string }>(
      "SELECT value FROM config_defaults WHERE key = 'shield_whitelist'"
    );
    if (row?.value) whitelist = JSON.parse(row.value);
  } catch { /* ignore */ }

  // Get scan data to see what's being detected
  const recentDetections = queryAll<{ shield_detections: string }>(
    `SELECT shield_detections FROM proxy_traffic WHERE shield_detections IS NOT NULL AND shield_detections != '[]' AND timestamp >= datetime('now', '-7 days') LIMIT 200`
  );

  const detectionCounts: Record<string, number> = {};
  for (const row of recentDetections) {
    try {
      const dets = JSON.parse(row.shield_detections);
      if (Array.isArray(dets)) {
        for (const d of dets) {
          const id = d.id || "unknown";
          detectionCounts[id] = (detectionCounts[id] || 0) + 1;
        }
      }
    } catch { /* skip */ }
  }

  const whitelistedDetections = Object.entries(detectionCounts)
    .filter(([id]) => whitelist.includes(id))
    .sort((a, b) => b[1] - a[1]);

  const activeDetections = Object.entries(detectionCounts)
    .filter(([id]) => !whitelist.includes(id))
    .sort((a, b) => b[1] - a[1]);

  return `# Shield Whitelist Review

**Generated:** ${new Date().toISOString()}

---

## Current Whitelist

| # | Rule ID | Status |
|---|---------|--------|
${whitelist.length > 0 ? whitelist.map((id, i) => `| ${i + 1} | ${id} | Whitelisted |`).join("\n") : "| -- | (empty whitelist) | -- |"}

**Total whitelisted rules:** ${whitelist.length} of 163

## Whitelist Effectiveness (Last 7 Days)

Rules that WOULD have triggered if not whitelisted:

| Rule ID | Would-be Detections |
|---------|---------------------|
${whitelistedDetections.length > 0 ? whitelistedDetections.map(([id, count]) => `| ${id} | ${count} |`).join("\n") : "| (none) | 0 |"}

${whitelistedDetections.length > 0 ? `**Estimated false positives prevented:** ${whitelistedDetections.reduce((s, [, c]) => s + c, 0)} detections` : "No whitelisted rules triggered in the last 7 days — consider whether they still need to be whitelisted."}

## Active Detections (Non-Whitelisted)

Top rules triggering on live traffic:

| Rule ID | Detections |
|---------|------------|
${activeDetections.slice(0, 15).map(([id, count]) => `| ${id} | ${count} |`).join("\n") || "| (none) | 0 |"}

## Recommendations

${whitelist.length === 0 ? "- No rules whitelisted. If you see false positives on agent system prompts, consider whitelisting cognitive-file rules (COG-SOUL, COG-IDENTITY, etc.)." : ""}
${whitelistedDetections.length === 0 && whitelist.length > 0 ? "- Some whitelisted rules haven't triggered recently. Review whether they still need to be whitelisted." : ""}
- Review whitelist quarterly to ensure it remains appropriate
- Only whitelist rules that consistently false-positive on your legitimate traffic
- Dashboard scans always run all rules regardless of whitelist
`;
}

function generateConsolidatedSummary(since: string): string {
  // Gather key metrics from all areas. `alertCount` is total records (any
  // status) in the window. `openAlerts` is canonical active alerts — open +
  // acknowledged + investigating — matching the dashboard contract.
  const alertCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE created_at >= ?`, [since])?.cnt || 0;
  const openAlerts = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE ${activeAlertSqlClause()} AND created_at >= ?`, [since])?.cnt || 0;
  const critAlerts = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'CRITICAL' AND created_at >= ?`, [since])?.cnt || 0;
  const trafficCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM proxy_traffic WHERE timestamp >= ?`, [since])?.cnt || 0;
  const blockedCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM proxy_traffic WHERE blocked = 1 AND timestamp >= ?`, [since])?.cnt || 0;
  const scanCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ?`, [since])?.cnt || 0;
  const auditCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_log WHERE created_at >= ?`, [since])?.cnt || 0;
  const totalTokens = queryOne<{ total: number }>(`SELECT COALESCE(SUM(total_tokens), 0) as total FROM proxy_traffic WHERE timestamp >= ?`, [since])?.total || 0;
  const bgActivations = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_log WHERE action = 'break_glass_activated' AND created_at >= ?`, [since])?.cnt || 0;

  // Score
  let score = 100;
  if (critAlerts > 0) score -= critAlerts * 15;
  if (openAlerts > 5) score -= 10;
  if (blockedCount > 10) score -= 5;
  if (bgActivations > 0) score -= bgActivations * 10;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return `# ClawNex Consolidated Executive Summary

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}
**Classification:** Confidential

---

## Executive Overview

| Metric | Value | Status |
|--------|-------|--------|
| Security Posture | ${score}/100 (${grade}) | ${score >= 80 ? "HEALTHY" : score >= 60 ? "DEGRADED" : "CRITICAL"} |
| Total LLM Requests | ${trafficCount.toLocaleString()} | -- |
| Total Tokens | ${totalTokens.toLocaleString()} | -- |
| Shield Scans | ${scanCount.toLocaleString()} | -- |
| Blocked Requests | ${blockedCount} | ${blockedCount > 0 ? "ACTIVE THREATS" : "CLEAR"} |
| Total Alerts | ${alertCount} | ${critAlerts > 0 ? "ACTION REQUIRED" : "OK"} |
| Open Alerts | ${openAlerts} | ${openAlerts > 5 ? "REVIEW" : "OK"} |
| Critical Alerts | ${critAlerts} | ${critAlerts > 0 ? "IMMEDIATE" : "CLEAR"} |
| Break-Glass Activations | ${bgActivations} | ${bgActivations > 0 ? "REVIEW" : "NONE"} |
| Audit Events | ${auditCount.toLocaleString()} | -- |

## Key Findings

${critAlerts > 0 ? `- **${critAlerts} CRITICAL alert(s)** require immediate attention` : "- No critical alerts — fleet operating normally"}
${blockedCount > 0 ? `- **${blockedCount} request(s) blocked** by the Prompt Shield` : "- No requests blocked (shield in observe mode or no threats detected)"}
${bgActivations > 0 ? `- **${bgActivations} break-glass activation(s)** — review audit trail for compliance` : "- No break-glass activations — normal operation maintained"}
${openAlerts > 5 ? `- **${openAlerts} open alerts** — consider triaging and resolving stale alerts` : ""}

## Recommendations

1. ${critAlerts > 0 ? "Investigate and resolve all CRITICAL alerts immediately" : "Continue monitoring — no critical issues"}
2. ${score < 80 ? "Security posture is degraded — review Security Posture tab for details" : "Maintain current security posture"}
3. Review shield whitelist quarterly for accuracy
4. Ensure audit trail retention meets compliance requirements
5. ${bgActivations > 0 ? "Review break-glass audit trail for policy compliance" : "Break-glass procedures are available for emergencies"}

---

*Report generated by ClawNex v${CLAWNEX_VERSION}*
`;
}

interface ComplianceSection {
  control: string;
  name: string;
  status: "PASS" | "PARTIAL" | "FAIL";
  evidence_count: number;
  summary: string;
  details: string[];
}

interface ComplianceReport {
  type: string;
  title: string;
  generated: string;
  period: { from: string; to: string };
  sections: ComplianceSection[];
  overall_status: "COMPLIANT" | "PARTIAL" | "NON_COMPLIANT";
  score: number;
}

function generateSOC2Report(since: string): ComplianceReport {
  const now = new Date().toISOString();

  // CC6.1 — Logical Access Controls
  const accessListCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM access_lists`)?.cnt || 0;
  let whitelistRules: string[] = [];
  try {
    const row = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'shield_whitelist'");
    if (row?.value) whitelistRules = JSON.parse(row.value);
  } catch { /* ignore */ }
  let agentIgnorePatterns: string[] = [];
  try {
    const row = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'agent_ignore_patterns'");
    if (row?.value) agentIgnorePatterns = JSON.parse(row.value);
  } catch { /* ignore */ }
  const cc61Evidence = accessListCount + whitelistRules.length + agentIgnorePatterns.length;
  const cc61Status: ComplianceSection["status"] = accessListCount > 0 ? "PASS" : cc61Evidence > 0 ? "PARTIAL" : "FAIL";

  // CC6.6 — System Operations Monitoring
  const shieldScanCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ?`, [since])?.cnt || 0;
  const proxyTrafficCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM proxy_traffic WHERE timestamp >= ?`, [since])?.cnt || 0;
  let sessionWatcherEnabled = false;
  try {
    const row = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'session_watcher_enabled'");
    sessionWatcherEnabled = row?.value === "true" || row?.value === "1";
  } catch { /* ignore */ }
  const cc66Evidence = shieldScanCount + proxyTrafficCount + (sessionWatcherEnabled ? 1 : 0);
  const cc66Status: ComplianceSection["status"] = shieldScanCount > 0 && proxyTrafficCount > 0 ? "PASS" : cc66Evidence > 0 ? "PARTIAL" : "FAIL";

  // CC7.2 — System Monitoring
  const alertsBySeverity = {
    CRITICAL: queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'CRITICAL' AND created_at >= ?`, [since])?.cnt || 0,
    HIGH: queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'HIGH' AND created_at >= ?`, [since])?.cnt || 0,
    MEDIUM: queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'MEDIUM' AND created_at >= ?`, [since])?.cnt || 0,
    LOW: queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE severity = 'LOW' AND created_at >= ?`, [since])?.cnt || 0,
  };
  const totalAlerts = alertsBySeverity.CRITICAL + alertsBySeverity.HIGH + alertsBySeverity.MEDIUM + alertsBySeverity.LOW;
  const correlationCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM correlation_events WHERE created_at >= ?`, [since])?.cnt || 0;
  const cc72Evidence = totalAlerts + correlationCount;
  const cc72Status: ComplianceSection["status"] = totalAlerts > 0 || correlationCount > 0 ? "PASS" : "PARTIAL";

  // CC8.1 — Change Management
  const configChanges = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_log WHERE action = 'config_change' AND created_at >= ?`, [since])?.cnt || 0;
  const allAuditConfigActions = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_log WHERE action LIKE '%config%' AND created_at >= ?`, [since])?.cnt || 0;
  const cc81Evidence = configChanges + allAuditConfigActions;
  const cc81Status: ComplianceSection["status"] = allAuditConfigActions > 0 ? "PASS" : "PARTIAL";

  // CC9.1 — Risk Assessment
  const blockedCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM proxy_traffic WHERE blocked = 1 AND timestamp >= ?`, [since])?.cnt || 0;
  const critAlerts = alertsBySeverity.CRITICAL;
  let threatScore = 100;
  if (critAlerts > 0) threatScore -= critAlerts * 15;
  if (blockedCount > 5) threatScore -= 10;
  threatScore = Math.max(0, Math.min(100, threatScore));
  const cc91Evidence = totalAlerts + blockedCount;
  const cc91Status: ComplianceSection["status"] = threatScore >= 70 ? "PASS" : threatScore >= 50 ? "PARTIAL" : "FAIL";

  const sections: ComplianceSection[] = [
    {
      control: "CC6.1",
      name: "Logical Access Controls",
      status: cc61Status,
      evidence_count: cc61Evidence,
      summary: `${accessListCount} access list entries, ${whitelistRules.length} shield whitelist rules, ${agentIgnorePatterns.length} agent ignore patterns configured.`,
      details: [
        `Access list entries: ${accessListCount}`,
        `Shield whitelist rules: ${whitelistRules.length}`,
        `Agent ignore patterns: ${agentIgnorePatterns.length}`,
      ],
    },
    {
      control: "CC6.6",
      name: "System Operations Monitoring",
      status: cc66Status,
      evidence_count: cc66Evidence,
      summary: `${shieldScanCount} shield scans, ${proxyTrafficCount} proxy requests monitored. Session watcher: ${sessionWatcherEnabled ? "enabled" : "disabled"}.`,
      details: [
        `Shield scans in period: ${shieldScanCount}`,
        `Proxy traffic requests: ${proxyTrafficCount}`,
        `Session watcher: ${sessionWatcherEnabled ? "ENABLED" : "DISABLED"}`,
      ],
    },
    {
      control: "CC7.2",
      name: "System Monitoring",
      status: cc72Status,
      evidence_count: cc72Evidence,
      summary: `${totalAlerts} alerts (${alertsBySeverity.CRITICAL} critical, ${alertsBySeverity.HIGH} high), ${correlationCount} correlation events detected.`,
      details: [
        `CRITICAL alerts: ${alertsBySeverity.CRITICAL}`,
        `HIGH alerts: ${alertsBySeverity.HIGH}`,
        `MEDIUM alerts: ${alertsBySeverity.MEDIUM}`,
        `LOW alerts: ${alertsBySeverity.LOW}`,
        `Correlation events: ${correlationCount}`,
      ],
    },
    {
      control: "CC8.1",
      name: "Change Management",
      status: cc81Status,
      evidence_count: cc81Evidence,
      summary: `${allAuditConfigActions} configuration-related audit entries logged, ${configChanges} explicit config_change actions.`,
      details: [
        `config_change actions: ${configChanges}`,
        `All config-related audit entries: ${allAuditConfigActions}`,
      ],
    },
    {
      control: "CC9.1",
      name: "Risk Assessment",
      status: cc91Status,
      evidence_count: cc91Evidence,
      summary: `Threat score: ${threatScore}/100. ${blockedCount} blocked requests, ${critAlerts} critical alerts in period.`,
      details: [
        `Calculated threat score: ${threatScore}/100`,
        `Blocked requests: ${blockedCount}`,
        `Critical alerts: ${critAlerts}`,
        `Total alerts assessed: ${totalAlerts}`,
      ],
    },
  ];

  const passCount = sections.filter(s => s.status === "PASS").length;
  const failCount = sections.filter(s => s.status === "FAIL").length;
  const overallScore = Math.round((passCount / sections.length) * 100);
  const overallStatus: ComplianceReport["overall_status"] = failCount > 0 ? "NON_COMPLIANT" : passCount === sections.length ? "COMPLIANT" : "PARTIAL";

  return {
    type: "soc2",
    title: "SOC 2 Type II Evidence Report",
    generated: now,
    period: { from: since, to: now },
    sections,
    overall_status: overallStatus,
    score: overallScore,
  };
}

function generateISO27001Report(since: string): ComplianceReport {
  const now = new Date().toISOString();

  // A.5 — Information Security Policies
  const policySettings = queryAll<{ key: string; value: string }>(
    `SELECT key, value FROM config_defaults WHERE key LIKE 'policy_%' OR key LIKE 'shield_%' OR key LIKE 'retention_%'`
  );
  const a5Evidence = policySettings.length;
  const a5Status: ComplianceSection["status"] = a5Evidence >= 3 ? "PASS" : a5Evidence > 0 ? "PARTIAL" : "FAIL";

  // A.8 — Asset Management
  const providerCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM config_providers`)?.cnt || 0;
  const modelCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM config_models`)?.cnt || 0;
  const a8Evidence = providerCount + modelCount;
  const a8Status: ComplianceSection["status"] = providerCount > 0 && modelCount > 0 ? "PASS" : a8Evidence > 0 ? "PARTIAL" : "FAIL";

  // A.9 — Access Control
  const accessListCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM access_lists`)?.cnt || 0;
  let apiKeyCount = 0;
  try { apiKeyCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM api_keys`)?.cnt || 0; } catch { /* table may not exist */ }
  const bgActivations = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_log WHERE action = 'break_glass_activated' AND created_at >= ?`, [since])?.cnt || 0;
  const bgDeactivations = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_log WHERE (action = 'break_glass_deactivated' OR action = 'break_glass_expired') AND created_at >= ?`, [since])?.cnt || 0;
  const a9Evidence = accessListCount + apiKeyCount + bgActivations + bgDeactivations;
  const a9Status: ComplianceSection["status"] = accessListCount > 0 || apiKeyCount > 0 ? "PASS" : "PARTIAL";

  // A.12 — Operations Security
  const shieldScanCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ?`, [since])?.cnt || 0;
  const proxyTrafficCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM proxy_traffic WHERE timestamp >= ?`, [since])?.cnt || 0;
  let sessionWatcherEnabled = false;
  try {
    const row = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'session_watcher_enabled'");
    sessionWatcherEnabled = row?.value === "true" || row?.value === "1";
  } catch { /* ignore */ }
  const a12Evidence = shieldScanCount + proxyTrafficCount + (sessionWatcherEnabled ? 1 : 0);
  const a12Status: ComplianceSection["status"] = shieldScanCount > 0 && proxyTrafficCount > 0 ? "PASS" : a12Evidence > 0 ? "PARTIAL" : "FAIL";

  // A.16 — Incident Management
  const alertCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE created_at >= ?`, [since])?.cnt || 0;
  const incidentCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM incidents WHERE created_at >= ?`, [since])?.cnt || 0;
  const correlationCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM correlation_events WHERE created_at >= ?`, [since])?.cnt || 0;
  const a16Evidence = alertCount + incidentCount + correlationCount;
  const a16Status: ComplianceSection["status"] = alertCount > 0 || incidentCount > 0 ? "PASS" : a16Evidence > 0 ? "PARTIAL" : "FAIL";

  // A.18 — Compliance
  const auditLogCount = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM audit_log WHERE created_at >= ?`, [since])?.cnt || 0;
  const retentionSettings = queryAll<{ key: string; value: string }>(
    `SELECT key, value FROM config_defaults WHERE key LIKE 'retention_%'`
  );
  const a18Evidence = auditLogCount + retentionSettings.length;
  const a18Status: ComplianceSection["status"] = auditLogCount > 0 && retentionSettings.length > 0 ? "PASS" : a18Evidence > 0 ? "PARTIAL" : "FAIL";

  const sections: ComplianceSection[] = [
    {
      control: "A.5",
      name: "Information Security Policies",
      status: a5Status,
      evidence_count: a5Evidence,
      summary: `${a5Evidence} policy-related configuration settings found (shield, retention, policy prefixes).`,
      details: policySettings.slice(0, 20).map(s => `${s.key}: ${s.value.length > 60 ? s.value.slice(0, 60) + "..." : s.value}`),
    },
    {
      control: "A.8",
      name: "Asset Management",
      status: a8Status,
      evidence_count: a8Evidence,
      summary: `${providerCount} LLM providers and ${modelCount} models registered in asset inventory.`,
      details: [
        `Registered providers: ${providerCount}`,
        `Registered models: ${modelCount}`,
      ],
    },
    {
      control: "A.9",
      name: "Access Control",
      status: a9Status,
      evidence_count: a9Evidence,
      summary: `${accessListCount} access list entries, ${apiKeyCount} API keys managed. ${bgActivations} break-glass activations in period.`,
      details: [
        `Access list entries: ${accessListCount}`,
        `API keys: ${apiKeyCount}`,
        `Break-glass activations: ${bgActivations}`,
        `Break-glass deactivations/expiries: ${bgDeactivations}`,
      ],
    },
    {
      control: "A.12",
      name: "Operations Security",
      status: a12Status,
      evidence_count: a12Evidence,
      summary: `${shieldScanCount} shield scans, ${proxyTrafficCount} proxy traffic entries. Session watcher: ${sessionWatcherEnabled ? "enabled" : "disabled"}.`,
      details: [
        `Shield scans in period: ${shieldScanCount}`,
        `Proxy traffic requests: ${proxyTrafficCount}`,
        `Session watcher: ${sessionWatcherEnabled ? "ENABLED" : "DISABLED"}`,
      ],
    },
    {
      control: "A.16",
      name: "Incident Management",
      status: a16Status,
      evidence_count: a16Evidence,
      summary: `${alertCount} alerts, ${incidentCount} incidents, ${correlationCount} correlation events in period.`,
      details: [
        `Alerts: ${alertCount}`,
        `Incidents: ${incidentCount}`,
        `Correlation events: ${correlationCount}`,
      ],
    },
    {
      control: "A.18",
      name: "Compliance",
      status: a18Status,
      evidence_count: a18Evidence,
      summary: `${auditLogCount} audit log entries in period. ${retentionSettings.length} retention policies configured.`,
      details: [
        `Audit log entries: ${auditLogCount}`,
        `Retention policies configured: ${retentionSettings.length}`,
        ...retentionSettings.map(s => `${s.key}: ${s.value} days`),
      ],
    },
  ];

  const passCount = sections.filter(s => s.status === "PASS").length;
  const failCount = sections.filter(s => s.status === "FAIL").length;
  const overallScore = Math.round((passCount / sections.length) * 100);
  const overallStatus: ComplianceReport["overall_status"] = failCount > 0 ? "NON_COMPLIANT" : passCount === sections.length ? "COMPLIANT" : "PARTIAL";

  return {
    type: "iso27001",
    title: "ISO 27001 Compliance Evidence Report",
    generated: now,
    period: { from: since, to: now },
    sections,
    overall_status: overallStatus,
    score: overallScore,
  };
}

function complianceReportToMarkdown(report: ComplianceReport): string {
  const statusIcon = (s: string) => s === "PASS" ? "[PASS]" : s === "PARTIAL" ? "[PARTIAL]" : "[FAIL]";
  return `# ${report.title}

**Generated:** ${report.generated}
**Period:** ${new Date(report.period.from).toLocaleString()} to ${new Date(report.period.to).toLocaleString()}
**Overall Status:** ${report.overall_status}
**Compliance Score:** ${report.score}%

---

## Control Assessment Summary

| Control | Name | Status | Evidence |
|---------|------|--------|----------|
${report.sections.map(s => `| ${s.control} | ${s.name} | ${statusIcon(s.status)} | ${s.evidence_count} items |`).join("\n")}

---

${report.sections.map(s => `## ${s.control} — ${s.name}

**Status:** ${statusIcon(s.status)}
**Evidence Count:** ${s.evidence_count}

${s.summary}

### Evidence Details

${s.details.map(d => `- ${d}`).join("\n")}
`).join("\n---\n\n")}

---

*Report generated by ClawNex Compliance Engine*
`;
}

function generateConsolidatedCSV(since: string): string {
  const traffic = queryAll<{ model: string | null; provider: string | null; shield_verdict: string | null; shield_score: number | null; total_tokens: number | null; latency_ms: number | null; source: string | null; blocked: number; timestamp: string; status_code: number | null }>(
    `SELECT model, provider, shield_verdict, shield_score, total_tokens, latency_ms, source, blocked, timestamp, status_code FROM proxy_traffic WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  const header = "timestamp,model,provider,source,verdict,score,tokens,latency_ms,blocked,status_code";
  const rows = traffic.map(t =>
    `${t.timestamp},${(t.model || "").replace(/,/g, ";")},${t.provider || ""},${t.source || ""},${t.shield_verdict || ""},${t.shield_score || 0},${t.total_tokens || 0},${t.latency_ms || 0},${t.blocked},${t.status_code || ""}`
  );

  return [header, ...rows].join("\n");
}

function generateAgentActivity(since: string): string {
  const auditEvents = queryAll<AuditRow>(
    `SELECT * FROM audit_log WHERE created_at >= ? ORDER BY created_at DESC LIMIT ${REPORT_ROW_CAP}`,
    [since]
  );

  const byActor: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  for (const e of auditEvents) {
    const actor = e.actor || "unknown";
    byActor[actor] = (byActor[actor] || 0) + 1;
    byAction[e.action] = (byAction[e.action] || 0) + 1;
  }
  const sortedActors = Object.entries(byActor).sort((a, b) => b[1] - a[1]);
  const sortedActions = Object.entries(byAction).sort((a, b) => b[1] - a[1]);

  return `# Agent Activity Summary

**Generated:** ${new Date().toISOString()}
**Period:** Since ${new Date(since).toLocaleString()}

---

## Overview

- **Total Events:** ${auditEvents.length}
- **Unique Actors:** ${Object.keys(byActor).length}
- **Unique Actions:** ${Object.keys(byAction).length}

## Activity by Actor

| Actor | Events |
|-------|--------|
${sortedActors.slice(0, 15).map(([actor, count]) => `| ${actor} | ${count} |`).join("\n") || "| (none) | 0 |"}

## Activity by Action

| Action | Count |
|--------|-------|
${sortedActions.slice(0, 15).map(([action, count]) => `| ${action} | ${count} |`).join("\n") || "| (none) | 0 |"}

## Recent Events

| Time | Actor | Action | Target |
|------|-------|--------|--------|
${auditEvents.slice(0, 20).map((e) => `| ${new Date(e.created_at).toLocaleString()} | ${e.actor || "--"} | ${e.action} | ${e.resource_type ? `${e.resource_type}/${e.resource_id || ""}` : e.detail || "--"} |`).join("\n") || "| -- | -- | -- | -- |"}
`;
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'reports:generate');
    if (perm) return perm;
  } else {
    const blocked = requireLocalhost(request);
    if (blocked) return blocked;
  }

  // Per-operator rate limit. Each report fans out to multiple per-table
  // queries plus Markdown/XLSX/PDF serialization — a concurrent flood is
  // a CPU+memory pressure attack even with the row cap.
  const op = getOperatorFromRequest(request);
  const rlKey = `reports:generate:${op?.id || 'anon'}`;
  const rl = checkRateLimit(rlKey, REPORT_RATE_LIMIT_PER_MIN);
  if (!rl.allowed) {
    const retryS = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: `Too many report-generation requests. Limit ${REPORT_RATE_LIMIT_PER_MIN}/min per operator. Try again in ${retryS}s.` },
      { status: 429, headers: { "Retry-After": String(retryS) } },
    );
  }

  try {
    const body = await request.json();
    const { reportType, format, timeRange } = body as {
      reportType: string;
      format: string;
      timeRange: string;
    };

    if (!reportType) {
      return NextResponse.json({ error: "reportType is required" }, { status: 400 });
    }

    const since = getSince(timeRange || "24h");
    let content: string;
    let filename: string;

    switch (reportType) {
      case "fleet_posture":
        content = generateFleetPosture(since);
        filename = `fleet-posture-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "incident_report":
        content = generateIncidentReport(since);
        filename = `incident-report-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "shield_analysis":
        content = generateShieldAnalysis(since);
        filename = `shield-analysis-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "sla_compliance":
        content = generateSLACompliance(since);
        filename = `sla-compliance-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "cost_analysis":
        content = generateCostAnalysis(since);
        filename = `cost-analysis-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "agent_activity":
        content = generateAgentActivity(since);
        filename = `agent-activity-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "traffic_summary":
        content = generateTrafficSummary(since);
        filename = `traffic-summary-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "break_glass_audit":
        content = generateBreakGlassAudit(since);
        filename = `break-glass-audit-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "retention_compliance":
        content = generateRetentionCompliance(since);
        filename = `retention-compliance-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "skills_inventory":
        content = generateSkillsInventory();
        filename = `skills-inventory-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "whitelist_review":
        content = generateWhitelistReview();
        filename = `whitelist-review-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "consolidated_summary":
        content = generateConsolidatedSummary(since);
        filename = `consolidated-summary-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "consolidated_csv":
        content = generateConsolidatedCSV(since);
        filename = `clawnex-traffic-export-${new Date().toISOString().slice(0, 10)}`;
        break;
      case "soc2": {
        const complianceReport = generateSOC2Report(since);
        const generatedAtNow = new Date().toISOString();
        try { setSetting(`report_generated_${reportType}`, generatedAtNow); } catch { /* non-critical */ }
        const actualFmt = format === "md" || format === "pdf" || format === "xlsx" ? format : "md";
        return NextResponse.json({
          ...complianceReport,
          content: complianceReportToMarkdown(complianceReport),
          filename: `soc2-evidence-report-${new Date().toISOString().slice(0, 10)}.md`,
          format: actualFmt,
          generatedAt: generatedAtNow,
          fallback: actualFmt !== "md" ? `${actualFmt.toUpperCase()} export coming soon — delivering as Markdown` : undefined,
        });
      }
      case "iso27001": {
        const complianceReport = generateISO27001Report(since);
        const generatedAtNow = new Date().toISOString();
        try { setSetting(`report_generated_${reportType}`, generatedAtNow); } catch { /* non-critical */ }
        const actualFmt = format === "md" || format === "pdf" || format === "xlsx" ? format : "md";
        return NextResponse.json({
          ...complianceReport,
          content: complianceReportToMarkdown(complianceReport),
          filename: `iso27001-evidence-report-${new Date().toISOString().slice(0, 10)}.md`,
          format: actualFmt,
          generatedAt: generatedAtNow,
          fallback: actualFmt !== "md" ? `${actualFmt.toUpperCase()} export coming soon — delivering as Markdown` : undefined,
        });
      }
      default:
        return NextResponse.json({ error: `Unknown report type: ${reportType}` }, { status: 400 });
    }

    const generatedAt = new Date().toISOString();

    // Store generation timestamp in config_defaults
    try {
      setSetting(`report_generated_${reportType}`, generatedAt);
    } catch {
      // Non-critical — continue even if config write fails
    }

    const actualFormat = format === "md" || format === "pdf" || format === "xlsx" ? format : "md";
    const isCSV = reportType === "consolidated_csv";
    const fileExt = isCSV ? "csv" : "md";

    return NextResponse.json({
      content,
      filename: `${filename}.${fileExt}`,
      format: isCSV ? "csv" : actualFormat,
      generatedAt,
      fallback: !isCSV && actualFormat !== "md" ? `${actualFormat.toUpperCase()} export coming soon — delivering as Markdown` : undefined,
    });
  } catch (error) {
    console.error("[Reports/Generate API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate report" },
      { status: 500 }
    );
  }
}
