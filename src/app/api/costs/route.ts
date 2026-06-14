/**
 * ClawNex CostOps API
 * GET /api/costs
 *
 * Returns cost data based on token metrics and model pricing.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryAll, queryOne } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Model pricing per million tokens (input)
const MODEL_PRICING: Record<string, { input: number; output: number; routing: string }> = {
  "claude-opus-4": { input: 15, output: 75, routing: "Cloud" },
  "claude-sonnet-4": { input: 3, output: 15, routing: "Cloud" },
  "claude-haiku-3.5": { input: 0.8, output: 4, routing: "Cloud" },
  "gpt-4o": { input: 2.5, output: 10, routing: "Cloud" },
  "gpt-4o-mini": { input: 0.15, output: 0.6, routing: "Cloud" },
  local: { input: 0, output: 0, routing: "Local" },
};

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
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Aggregate token metrics from metric_snapshots
    const dailyMetrics = queryAll<{ metric_name: string; total: number; samples: number }>(
      `SELECT metric_name, SUM(metric_value) as total, COUNT(*) as samples
       FROM metric_snapshots
       WHERE recorded_at >= ? AND (metric_name LIKE '%token%' OR metric_name LIKE '%session%' OR metric_name LIKE '%agent%')
       GROUP BY metric_name`,
      [yesterday],
    );

    const weeklyMetrics = queryAll<{ metric_name: string; total: number; samples: number }>(
      `SELECT metric_name, SUM(metric_value) as total, COUNT(*) as samples
       FROM metric_snapshots
       WHERE recorded_at >= ? AND (metric_name LIKE '%token%' OR metric_name LIKE '%session%' OR metric_name LIKE '%agent%')
       GROUP BY metric_name`,
      [weekAgo],
    );

    // Shield scan counts (as proxy for activity/cost)
    const dailyScans = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ?`,
      [yesterday],
    );

    const weeklyScans = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= ?`,
      [weekAgo],
    );

    // Build cost breakdown by model tier
    const costBreakdown = Object.entries(MODEL_PRICING).map(([model, pricing]) => ({
      model,
      inputPricePerMTok: pricing.input,
      outputPricePerMTok: pricing.output,
      routing: pricing.routing,
    }));

    // Estimate daily cost based on activity (rough estimate)
    const dailyScanCount = dailyScans?.cnt ?? 0;
    const weeklyScanCount = weeklyScans?.cnt ?? 0;

    // Each scan implies some token usage -- rough estimate
    const estimatedDailyTokens = dailyScanCount * 500; // ~500 tokens per scan average
    const estimatedWeeklyTokens = weeklyScanCount * 500;

    // Assume mixed model usage: 60% Haiku, 30% Sonnet, 10% Opus
    const dailyCostEstimate =
      (estimatedDailyTokens * 0.6 * 0.8 +
        estimatedDailyTokens * 0.3 * 3 +
        estimatedDailyTokens * 0.1 * 15) /
      1_000_000;

    const weeklyCostEstimate =
      (estimatedWeeklyTokens * 0.6 * 0.8 +
        estimatedWeeklyTokens * 0.3 * 3 +
        estimatedWeeklyTokens * 0.1 * 15) /
      1_000_000;

    // Cost alert thresholds
    const thresholds = {
      dailyWarning: 5.0,
      dailyCritical: 20.0,
      weeklyWarning: 25.0,
      weeklyCritical: 100.0,
    };

    const dailyStatus =
      dailyCostEstimate >= thresholds.dailyCritical
        ? "CRITICAL"
        : dailyCostEstimate >= thresholds.dailyWarning
          ? "WARNING"
          : "OK";

    return NextResponse.json({
      pricing: costBreakdown,
      usage: {
        daily: {
          scans: dailyScanCount,
          estimatedTokens: estimatedDailyTokens,
          estimatedCostUSD: Math.round(dailyCostEstimate * 100) / 100,
          status: dailyStatus,
          metrics: dailyMetrics,
        },
        weekly: {
          scans: weeklyScanCount,
          estimatedTokens: estimatedWeeklyTokens,
          estimatedCostUSD: Math.round(weeklyCostEstimate * 100) / 100,
          metrics: weeklyMetrics,
        },
        projections: {
          monthlyEstimateUSD: Math.round(dailyCostEstimate * 30 * 100) / 100,
        },
      },
      thresholds,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Costs API] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve cost data" },
      { status: 500 },
    );
  }
}
