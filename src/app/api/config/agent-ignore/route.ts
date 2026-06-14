/**
 * Agent Ignore List API
 * GET  /api/config/agent-ignore — returns current ignore patterns
 * PUT  /api/config/agent-ignore — update ignore patterns (expects { patterns: string[] })
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { setSetting } from "@/lib/services/config-service";
import { getAgentIgnorePatterns } from "@/lib/services/agent-ignore";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTING_KEY = "agent_ignore_patterns";

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const patterns = getAgentIgnorePatterns();
    return NextResponse.json({ patterns });
  } catch (err) {
    console.error("[Agent Ignore] GET error:", err);
    return NextResponse.json({ error: "Failed to get ignore patterns" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { patterns } = body as { patterns?: string[] };

    if (!Array.isArray(patterns)) {
      return NextResponse.json({ error: "Expected { patterns: string[] }" }, { status: 400 });
    }

    const cleaned = patterns.map((p) => p.trim()).filter((p) => p.length > 0);

    setSetting(SETTING_KEY, JSON.stringify(cleaned));

    logEvent(
      "operator",
      "agent_ignore_updated",
      "config",
      SETTING_KEY,
      `${cleaned.length} patterns: ${cleaned.join(", ")}`,
      "dashboard"
    );

    return NextResponse.json({ ok: true, patterns: cleaned });
  } catch (err) {
    console.error("[Agent Ignore] PUT error:", err);
    return NextResponse.json({ error: "Failed to update ignore patterns" }, { status: 500 });
  }
}
