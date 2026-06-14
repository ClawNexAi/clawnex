/**
 * GET /api/proxy/stats — Aggregated proxy traffic statistics.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryAll, queryOne } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CountRow {
  cnt: number;
}

interface AvgRow {
  avg_val: number;
}

interface ModelCountRow {
  model: string;
  cnt: number;
}

interface VerdictCountRow {
  shield_verdict: string;
  cnt: number;
}

interface DetectionRow {
  shield_detections: string;
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'tokens:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const instance = searchParams.get('instance') || null;

    // Build instance-aware WHERE clause fragment for proxy_traffic source filtering
    let instanceWhere = "";
    const instanceParams: unknown[] = [];
    if (instance === 'hermes-local') {
      instanceWhere = " AND source = ?";
      instanceParams.push('hermes-watcher');
    } else if (instance && instance !== 'all') {
      instanceWhere = " AND (source IS NULL OR source != 'hermes-watcher')";
    }

    // Total requests today
    const todayTotal = queryOne<CountRow>(
      `SELECT COUNT(*) as cnt FROM proxy_traffic WHERE timestamp >= date('now')${instanceWhere}`,
      [...instanceParams]
    );

    // Blocked today
    const todayBlocked = queryOne<CountRow>(
      `SELECT COUNT(*) as cnt FROM proxy_traffic WHERE blocked = 1 AND timestamp >= date('now')${instanceWhere}`,
      [...instanceParams]
    );

    // Average latency today
    const avgLatency = queryOne<AvgRow>(
      `SELECT COALESCE(AVG(latency_ms), 0) as avg_val FROM proxy_traffic WHERE timestamp >= date('now')${instanceWhere}`,
      [...instanceParams]
    );

    // Total tokens today
    const totalTokens = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(total_tokens), 0) as total FROM proxy_traffic WHERE timestamp >= date('now')${instanceWhere}`,
      [...instanceParams]
    );

    // Top models (last 24h)
    const topModels = queryAll<ModelCountRow>(
      `SELECT model, COUNT(*) as cnt FROM proxy_traffic WHERE model IS NOT NULL AND timestamp >= date('now')${instanceWhere} GROUP BY model ORDER BY cnt DESC LIMIT 10`,
      [...instanceParams]
    );

    // Verdict distribution today
    const verdicts = queryAll<VerdictCountRow>(
      `SELECT shield_verdict, COUNT(*) as cnt FROM proxy_traffic WHERE shield_verdict IS NOT NULL AND timestamp >= date('now')${instanceWhere} GROUP BY shield_verdict ORDER BY cnt DESC`,
      [...instanceParams]
    );

    // Top threats (from shield_detections) — enriched with actors and last seen
    const threatData: Record<string, { count: number; actors: Record<string, number>; lastSeen: string; severity: string; sample: string }> = {};
    try {
      const detRows = queryAll<DetectionRow & { source: string; timestamp: string; model: string }>(
        `SELECT shield_detections, source, timestamp, model FROM proxy_traffic WHERE shield_detections IS NOT NULL AND shield_detections != '[]' AND timestamp >= date('now')${instanceWhere} ORDER BY timestamp DESC LIMIT 500`,
        [...instanceParams]
      );
      for (const row of detRows) {
        try {
          const dets = JSON.parse(row.shield_detections);
          if (Array.isArray(dets)) {
            for (const d of dets) {
              const name = d.name || d.id || "unknown";
              if (!threatData[name]) {
                threatData[name] = { count: 0, actors: {}, lastSeen: row.timestamp, severity: d.severity || "MEDIUM", sample: "" };
              }
              threatData[name].count++;
              const actor = row.source || row.model || "unknown";
              threatData[name].actors[actor] = (threatData[name].actors[actor] || 0) + 1;
              if (!threatData[name].sample && d.samples?.[0]) {
                threatData[name].sample = String(d.samples[0]).slice(0, 100);
              }
            }
          }
        } catch { /* skip bad JSON */ }
      }
    } catch { /* ignore */ }

    const topThreats = Object.entries(threatData)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => ({
        name,
        count: data.count,
        severity: data.severity,
        lastSeen: data.lastSeen,
        sample: data.sample,
        actors: Object.entries(data.actors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([actor, cnt]) => ({ actor, count: cnt })),
      }));

    // Requests per hour (last 24h)
    const hourlyRequests = queryAll<{ hour: string; cnt: number }>(
      `SELECT strftime('%Y-%m-%dT%H:00', timestamp) as hour, COUNT(*) as cnt
       FROM proxy_traffic
       WHERE timestamp >= datetime('now', '-24 hours')${instanceWhere}
       GROUP BY hour
       ORDER BY hour ASC`,
      [...instanceParams]
    );

    // Total all-time
    const allTimeTotal = queryOne<CountRow>(
      instanceWhere
        ? `SELECT COUNT(*) as cnt FROM proxy_traffic WHERE 1=1${instanceWhere}`
        : "SELECT COUNT(*) as cnt FROM proxy_traffic",
      [...instanceParams]
    );

    return NextResponse.json({
      today: {
        requests: todayTotal?.cnt || 0,
        blocked: todayBlocked?.cnt || 0,
        avgLatency: Math.round(avgLatency?.avg_val || 0),
        totalTokens: totalTokens?.total || 0,
      },
      allTime: {
        requests: allTimeTotal?.cnt || 0,
      },
      topModels,
      verdicts,
      topThreats,
      hourlyRequests,
    });
  } catch (err) {
    console.error("[Proxy Stats API] Error:", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
