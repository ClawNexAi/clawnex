/**
 * Prompt Shield Scan API
 * POST /api/shield/scan
 *
 * Accepts: { text: string, source?: string, direction?: "inbound" | "outbound" }
 * Returns: ShieldScanResult
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { shieldScan, outboundScan, getPersistedWhitelist } from "@/lib/shield/scanner";
import { run } from "@/lib/db/index";
import { createAlert } from "@/lib/services/alert-manager";
import { logEvent } from "@/lib/services/audit-logger";
import { ingestEvent } from "@/lib/services/correlation-engine";
import { sanitizeLogField } from "@/lib/security/log-sanitize";
import { createHash } from "node:crypto";
import {
  type Origin,
  ORIGIN_MANUAL,
  ORIGIN_SHIELD_TEST,
  ORIGIN_DEMO,
  ORIGIN_QA,
} from "@/lib/dashboard/metric-semantics";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:scan');
    if (perm) return perm;
  } else {
    const blocked = requireLocalhost(request);
    if (blocked) return blocked;
  }

  try {
    const body = await request.json();
    const { text, source, direction } = body as {
      text?: string;
      source?: string;
      direction?: "inbound" | "outbound";
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'text' field" },
        { status: 400 }
      );
    }

    if (text.length > 500_000) {
      return NextResponse.json(
        { error: "Text exceeds maximum length of 500,000 characters" },
        { status: 400 }
      );
    }

    const dir = direction || "inbound";

    // Apply whitelist for known internal sources (LiteLLM proxy, OpenClaw agents)
    const isInternalSource = source === "litellm-proxy" || source === "openclaw" || source === "proxy";

    // Determine provenance from the caller's `source` hint. Phase 2a: this
    // is what keeps Shield Tests / demo / QA scans from polluting production
    // counters. The mapping is intentional and named (vs. a magic-string
    // check) so future origins can be added in one place.
    const origin: Origin = (() => {
      if (source === "shield-test") return ORIGIN_SHIELD_TEST;
      if (source === "demo") return ORIGIN_DEMO;
      if (source === "qa") return ORIGIN_QA;
      return ORIGIN_MANUAL; // any other API caller is treated as manual operator action
    })();

    let result;
    if (dir === "outbound") {
      result = outboundScan(text);
    } else {
      result = shieldScan(text, {
        includeRedacted: true,
        whitelistRules: isInternalSource ? getPersistedWhitelist() : undefined,
      });
    }

    const scanId = crypto.randomUUID();
    const contentHash = createHash("sha256").update(text).digest("hex").slice(0, 16);

    // Log to shield_scans table — origin embedded in detail JSON so stats
    // queries can filter test-generated runs out of production counters.
    try {
      run(
        `INSERT INTO shield_scans (id, direction, source_session_id, source_agent_id, content_hash, layers_triggered, threat_level, detail, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scanId,
          dir,
          null,
          null,
          contentHash,
          result.stats.categories.join(",") || "none",
          result.verdict,
          JSON.stringify({ origin, score: result.score, detections: result.detections.length, elapsed: result.elapsed }),
          new Date().toISOString(),
        ],
      );
    } catch (dbErr) {
      console.error("[Shield Scan] DB write error:", dbErr);
    }

    // Generate alert for BLOCK/REVIEW verdicts. Origin propagates so a
    // shield-test BLOCK doesn't surface as a production critical alert.
    if (result.verdict === "BLOCK") {
      createAlert(
        `Shield BLOCK: ${result.detections[0]?.name || "Threat detected"}`,
        `API scan blocked. Score: ${result.score}, Detections: ${result.detections.length}. Source: ${source || "api"}`,
        "CRITICAL",
        "shield",
        undefined,
        origin,
      );
    } else if (result.verdict === "REVIEW") {
      createAlert(
        `Shield REVIEW: ${result.detections[0]?.name || "Suspicious content"}`,
        `API scan flagged for review. Score: ${result.score}, Detections: ${result.detections.length}. Source: ${source || "api"}`,
        "HIGH",
        "shield",
        undefined,
        origin,
      );
    }

    // Feed correlation engine
    if (result.verdict !== "ALLOW") {
      ingestEvent({
        source: "shield",
        eventType: result.verdict.toLowerCase(),
        severity: result.verdict === "BLOCK" ? "CRITICAL" : "HIGH",
        detail: `Score: ${result.score}, Detections: ${result.detections.length}`,
        metadata: { score: result.score, detections: result.detections.length, categories: result.stats.categories, scanId },
      });
    }

    // Audit log — distinguish between actual blocks and observed threats
    let auditVerdict = result.verdict.toLowerCase();
    if (result.verdict === "BLOCK" && isInternalSource) {
      // Check if block mode is on — if not, this was observed, not blocked
      try {
        const { getSetting } = await import("@/lib/services/config-service");
        const blockMode = getSetting("proxy_block_mode");
        if (blockMode !== "on") auditVerdict = "observed";
      } catch { /* default to verdict */ }
    }
    const detectionSummary = result.detections
      .slice(0, 3)
      .map((d: { name: string }) => sanitizeLogField(d.name, 80))
      .join(', ');
    logEvent("api", `shield_scan_${auditVerdict}`, "shield", scanId, `Score: ${result.score}, Detections: ${detectionSummary}`, "api");

    return NextResponse.json({
      ...result,
      scanId,
      source: source || "api",
      direction: dir,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Shield Scan] Error');
    return NextResponse.json(
      { error: "Internal scan error" },
      { status: 500 }
    );
  }
}
