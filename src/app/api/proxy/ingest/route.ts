/**
 * Proxy Traffic Ingest API
 * POST /api/proxy/ingest
 *
 * Accepts traffic records from LiteLLM callback and writes to proxy_traffic table.
 * This is how the Python LiteLLM callback logs traffic to ClawNex's SQLite DB.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { isRbacEnabled } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { run } from "@/lib/db/index";
import { broadcast } from "@/lib/events";
import { v4 as uuid } from "uuid";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

const IngestSchema = z.object({
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  model: z.string().max(200).nullable().optional(),
  provider: z.string().max(100).nullable().optional(),
  upstream_url: z.string().max(500).optional().default("litellm-proxy"),
  prompt_hash: z.string().max(64).nullable().optional(),
  messages_count: z.number().int().min(0).max(100000).nullable().optional(),
  input_tokens: z.number().int().min(0).nullable().optional(),
  output_tokens: z.number().int().min(0).nullable().optional(),
  total_tokens: z.number().int().min(0).nullable().optional(),
  cost_usd: z.number().min(-1000).max(10000).nullable().optional(),
  latency_ms: z.number().int().min(0).max(600000).nullable().optional(),
  shield_verdict: z.enum(["ALLOW", "REVIEW", "BLOCK", "BYPASSED"]).default("ALLOW"),
  shield_score: z.number().int().min(0).max(100).default(0),
  shield_detections: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  blocked: z.boolean().or(z.number()).default(false),
  block_reason: z.string().max(500).nullable().optional(),
  session_id: z.string().max(100).nullable().optional(),
  status_code: z.number().int().min(0).max(999).default(200),
  error: z.string().max(1000).nullable().optional(),
  source: z.string().max(50).default("litellm"),
}).passthrough(); // Allow extra fields from LiteLLM callback without failing

export async function POST(request: NextRequest) {
  try {
    // Check ingest secret if configured (regardless of RBAC state)
    const ingestSecret = process.env.CLAWNEX_INGEST_SECRET;
    if (ingestSecret) {
      const provided = request.headers.get('x-clawnex-ingest-secret') ||
        request.headers.get('authorization')?.replace('Bearer ', '');
      if (!provided || !ingestSecret || provided.length !== ingestSecret.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(ingestSecret))) {
        return NextResponse.json({ error: 'Invalid ingest secret' }, { status: 401 });
      }
    }
    // When RBAC is enabled and no secret is configured, fail closed
    if (isRbacEnabled() && !ingestSecret) {
      return NextResponse.json({ error: 'CLAWNEX_INGEST_SECRET not configured' }, { status: 503 });
    }
    // When RBAC is disabled and no ingest secret, require localhost
    if (!isRbacEnabled() && !ingestSecret) {
      const guard = requireLocalhost(request);
      if (guard) return guard;
    }

    const raw = await request.json();

    // Size limit on shield_detections to prevent abuse
    const detectionsStr = typeof raw.shield_detections === 'string'
      ? raw.shield_detections
      : JSON.stringify(raw.shield_detections || []);
    if (detectionsStr.length > 50000) {
      return NextResponse.json({ error: 'shield_detections too large' }, { status: 413 });
    }

    const parsed = IngestSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues.slice(0, 5) }, { status: 400 });
    }

    const body = parsed.data;
    const id = uuid();

    run(
      `INSERT INTO proxy_traffic (id, timestamp, direction, model, provider, upstream_url, prompt_hash, messages_count, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, shield_verdict, shield_score, shield_detections, blocked, block_reason, session_id, status_code, error, source)
       VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.direction,
        body.model || null,
        body.provider || null,
        body.upstream_url,
        body.prompt_hash || null,
        body.messages_count ?? null,
        body.input_tokens ?? null,
        body.output_tokens ?? null,
        body.total_tokens ?? null,
        body.cost_usd ?? null,
        body.latency_ms ?? null,
        body.shield_verdict,
        body.shield_score,
        body.shield_detections ? JSON.stringify(body.shield_detections) : null,
        body.blocked ? 1 : 0,
        body.block_reason || null,
        body.session_id || null,
        body.status_code,
        body.error || null,
        body.source,
      ]
    );

    // Broadcast via SSE
    broadcast("proxy_traffic", {
      id,
      model: body.model,
      provider: body.provider,
      shield_verdict: body.shield_verdict,
      shield_score: body.shield_score,
      source: body.source,
      direction: body.direction,
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[Proxy Ingest] Error:", err);
    return NextResponse.json({ error: "Failed to ingest" }, { status: 500 });
  }
}
