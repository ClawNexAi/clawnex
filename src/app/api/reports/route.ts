/**
 * ClawNex Executive Reports API
 * GET /api/reports?timeRange=24h
 *
 * Aggregates data from alerts, shield stats, infrastructure, correlations,
 * and tokens to generate an executive summary. Respects the timeRange filter.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryAll, queryOne } from "@/lib/db/index";
import { getOpenClawConnector } from "@/lib/connectors/openclaw-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIME_RANGE_MS: Record<string, number> = {
  "1h": 3600000,
  "6h": 21600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
};

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'reports:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get("timeRange") || "24h";

    const now = new Date();
    const sinceMs = TIME_RANGE_MS[timeRange] || 86400000;
    const yesterday = new Date(now.getTime() - sinceMs).toISOString();

    // Alert counts by severity
    const alertCounts = queryAll<{ severity: string; status: string; cnt: number }>(
      `SELECT severity, status, COUNT(*) as cnt FROM alerts GROUP BY severity, status`,
    );

    const totalAlerts = alertCounts.reduce((sum, a) => sum + a.cnt, 0);
    const openAlerts = alertCounts.filter((a) => a.status === "open").reduce((sum, a) => sum + a.cnt, 0);
    const criticalAlerts = alertCounts.filter((a) => a.severity === "CRITICAL" && a.status === "open").reduce((sum, a) => sum + a.cnt, 0);
    const highAlerts = alertCounts.filter((a) => a.severity === "HIGH" && a.status === "open").reduce((sum, a) => sum + a.cnt, 0);

    // Shield stats (24h)
    const shieldStats = queryOne<{ total: number; blocked: number; reviewed: number; allowed: number }>(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN threat_level = 'BLOCK' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN threat_level = 'REVIEW' THEN 1 ELSE 0 END) as reviewed,
        SUM(CASE WHEN threat_level = 'ALLOW' THEN 1 ELSE 0 END) as allowed
       FROM shield_scans WHERE scanned_at >= ?`,
      [yesterday],
    );

    // Correlation counts
    const correlationCount = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM correlation_events WHERE created_at >= ?`,
      [yesterday],
    );

    // Recent audit events count
    const auditCount = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM audit_log WHERE created_at >= ?`,
      [yesterday],
    );

    // OpenClaw status
    const ocConnector = getOpenClawConnector();
    const ocStatus = ocConnector.getConnectionStatus();

    // Metric snapshots
    const metricCount = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM metric_snapshots WHERE recorded_at >= ?`,
      [yesterday],
    );

    // Calculate security posture score
    let postureScore = 100;
    if (criticalAlerts > 0) postureScore -= criticalAlerts * 15;
    if (highAlerts > 0) postureScore -= highAlerts * 8;
    if ((shieldStats?.blocked ?? 0) > 5) postureScore -= 10;
    if (!ocStatus.connected) postureScore -= 10;
    postureScore = Math.max(0, Math.min(100, postureScore));

    const postureGrade =
      postureScore >= 90 ? "A" :
      postureScore >= 80 ? "B" :
      postureScore >= 70 ? "C" :
      postureScore >= 60 ? "D" : "F";

    return NextResponse.json({
      generatedAt: now.toISOString(),
      period: timeRange,
      securityPosture: {
        score: postureScore,
        grade: postureGrade,
        status: postureScore >= 80 ? "HEALTHY" : postureScore >= 60 ? "DEGRADED" : "CRITICAL",
      },
      threatSummary: {
        totalAlerts,
        openAlerts,
        criticalAlerts,
        highAlerts,
        shieldScans: shieldStats?.total ?? 0,
        shieldBlocked: shieldStats?.blocked ?? 0,
        shieldReviewed: shieldStats?.reviewed ?? 0,
        correlationsDetected: correlationCount?.cnt ?? 0,
      },
      infrastructureHealth: {
        openclawConnected: ocStatus.connected,
        openclawSessions: ocStatus.sessions,
        openclawAgents: ocStatus.agents,
        lastEvent: ocStatus.lastEvent,
      },
      costOverview: {
        note: "Cost data aggregated from token metrics when available",
        metricSnapshots24h: metricCount?.cnt ?? 0,
      },
      auditEvents24h: auditCount?.cnt ?? 0,
    });
  } catch (error) {
    console.error("[Reports API] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 },
    );
  }
}
