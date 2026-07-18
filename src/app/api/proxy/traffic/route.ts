/**
 * GET /api/proxy/traffic — Returns recent proxy traffic from proxy_traffic table.
 * Supports ?limit=N (default 100), ?offset=N, and exact ?id=<traffic-id>
 * for investigation deep links.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { queryAll } from "@/lib/db/index";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TrafficRow {
  id: string;
  timestamp: string;
  direction: string;
  model: string | null;
  provider: string | null;
  upstream_url: string | null;
  prompt_hash: string | null;
  messages_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  shield_verdict: string | null;
  shield_score: number | null;
  shield_detections: string | null;
  blocked: number;
  block_reason: string | null;
  session_id: string | null;
  status_code: number | null;
  error: string | null;
  source: string | null;
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

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const verdict = searchParams.get("verdict");
  const model = searchParams.get("model");
  const source = searchParams.get("source");
  const instance = searchParams.get("instance");
  const id = searchParams.get("id");

  // Map instance to effective source filter for proxy_traffic rows
  const effectiveSource = source
    ? source
    : instance === 'hermes-local'
      ? 'hermes-watcher'
      : null;
  const excludeHermes = !source && instance && instance !== 'all' && instance !== 'hermes-local';

  try {
    // When no source filter, use UNION to get a balanced mix from each source
    // This ensures litellm/proxy entries aren't buried by session-watcher volume
    if (!id && !effectiveSource && !verdict && !model && !excludeHermes) {
      const balancedSql = `
        SELECT * FROM (SELECT * FROM proxy_traffic WHERE source = 'litellm' ORDER BY timestamp DESC LIMIT ?)
        UNION ALL
        SELECT * FROM (SELECT * FROM proxy_traffic WHERE source = 'session-watcher' ORDER BY timestamp DESC LIMIT ?)
        UNION ALL
        SELECT * FROM (SELECT * FROM proxy_traffic WHERE source = 'break-glass' ORDER BY timestamp DESC LIMIT ?)
        ORDER BY timestamp DESC
        LIMIT ?
      `;
      const perSource = Math.max(10, Math.floor(limit / 3));
      const traffic = queryAll<TrafficRow>(balancedSql, [perSource, perSource, perSource, limit]);

      const parsed = traffic.map((row) => ({
        ...row,
        shield_detections: row.shield_detections ? (() => { try { return JSON.parse(row.shield_detections); } catch { return []; } })() : [],
      }));

      return NextResponse.json({ traffic: parsed, total: parsed.length, balanced: true });
    }

    // Filtered query — standard approach
    let sql = "SELECT * FROM proxy_traffic";
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (id) {
      conditions.push("id = ?");
      params.push(id);
    }

    if (verdict) {
      conditions.push("shield_verdict = ?");
      params.push(verdict);
    }
    if (model) {
      conditions.push("model LIKE ?");
      params.push(`%${model}%`);
    }
    if (effectiveSource) {
      conditions.push("source = ?");
      params.push(effectiveSource);
    }
    if (excludeHermes) {
      conditions.push("(source IS NULL OR source != 'hermes-watcher')");
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const traffic = queryAll<TrafficRow>(sql, params);

    // Parse shield_detections JSON for each row
    const parsed = traffic.map((row) => ({
      ...row,
      shield_detections: row.shield_detections ? JSON.parse(row.shield_detections) : [],
    }));

    return NextResponse.json({ traffic: parsed, limit, offset });
  } catch (err) {
    console.error("[Proxy Traffic API] Error:", err);
    return NextResponse.json({ error: "Failed to fetch traffic" }, { status: 500 });
  }
}
