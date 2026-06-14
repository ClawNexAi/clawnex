/**
 * GET /api/proxy/block-mode — Get current block mode status.
 * POST /api/proxy/block-mode — Toggle block mode on/off.
 *   Body: { "mode": "on" | "off" }  OR  {} to toggle
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting, setSetting } from "@/lib/services/config-service";
import { run } from "@/lib/db/index";
import { v4 as uuid } from "uuid";
import { broadcast } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  // Safe-default 'on' matches the seeded value on fresh installs (CRIT #11).
  const mode = getSetting("proxy_block_mode") || "on";
  return NextResponse.json({ blockMode: mode });
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:config');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const current = getSetting("proxy_block_mode") || "off";

    let newMode: string;
    if (body.mode === "on" || body.mode === "off") {
      newMode = body.mode;
    } else {
      // Toggle
      newMode = current === "on" ? "off" : "on";
    }

    setSetting("proxy_block_mode", newMode);

    // Audit log
    try {
      const operator = getOperatorFromRequest(request);
      const actor = operator?.username || 'operator';
      run(
        `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at)
         VALUES (?, ?, ?, 'proxy', 'block_mode', ?, 'clawnex', datetime('now'))`,
        [uuid(), actor, "proxy_block_mode_changed", `Block mode changed from ${current} to ${newMode}`]
      );
    } catch { /* ignore */ }

    // Broadcast change via SSE
    try {
      broadcast("proxy_block_mode", { blockMode: newMode });
    } catch { /* ignore */ }

    return NextResponse.json({ blockMode: newMode, previous: current });
  } catch (err) {
    console.error("[Proxy Block Mode API] Error:", err);
    return NextResponse.json({ error: "Failed to update block mode" }, { status: 500 });
  }
}
