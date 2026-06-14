/**
 * POST /api/break-glass/deactivate — Manually deactivate break-glass mode.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { getSetting, setSetting } from "@/lib/services/config-service";
import { logEvent } from "@/lib/services/audit-logger";
import { createAlert } from "@/lib/services/alert-manager";
import { queryOne } from "@/lib/db/index";
import { broadcast } from "@/lib/events";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'break_glass:activate');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const raw = getSetting("break_glass");
    if (!raw) {
      return NextResponse.json({ error: "Break-glass is not active" }, { status: 400 });
    }

    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid break-glass state" }, { status: 500 });
    }

    if (!state.active) {
      return NextResponse.json({ error: "Break-glass is not active" }, { status: 400 });
    }

    // Count unscanned traffic during the window
    let unscannedCount = 0;
    try {
      const row = queryOne<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM proxy_traffic WHERE source = 'break-glass' AND timestamp >= ?",
        [state.activated_at]
      );
      unscannedCount = row?.cnt || 0;
    } catch { /* ignore */ }

    const actualMinutes = Math.round((Date.now() - new Date(state.activated_at).getTime()) / 60000);

    // Deactivate
    const currentOp = getOperatorFromRequest(request);
    const actor = currentOp?.username || 'operator';

    setSetting("break_glass", JSON.stringify({
      active: false,
      deactivated_at: new Date().toISOString(),
      deactivated_by: actor,
      last_reason: state.reason,
      last_duration_minutes: actualMinutes,
      last_unscanned_count: unscannedCount,
    }));

    // Audit log
    logEvent(
      actor,
      "break_glass_deactivated",
      "break-glass",
      "break_glass",
      `Active for: ${actualMinutes}m. Unscanned traffic: ${unscannedCount} requests.`,
      "dashboard"
    );

    // INFO alert
    createAlert(
      `Break-Glass Deactivated — ${actualMinutes}m active, ${unscannedCount} unscanned`,
      `${actor} manually deactivated break-glass mode after ${actualMinutes} minutes. ${unscannedCount} requests bypassed the shield. Reason was: ${state.reason}`,
      "INFO",
      "break-glass"
    );

    // Broadcast
    try {
      broadcast("break_glass_deactivated", { expired: false, duration: actualMinutes, unscanned: unscannedCount });
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      was_active: true,
      duration_actual_minutes: actualMinutes,
      unscanned_traffic: unscannedCount,
    });
  } catch (err) {
    console.error("[Break-Glass Deactivate] Error:", err);
    return NextResponse.json({ error: "Failed to deactivate break-glass" }, { status: 500 });
  }
}
