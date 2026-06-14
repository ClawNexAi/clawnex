/**
 * GET /api/break-glass/status — Current break-glass state.
 * Auto-deactivates if expired.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { getSetting, setSetting } from "@/lib/services/config-service";
import { logEvent } from "@/lib/services/audit-logger";
import { createAlert } from "@/lib/services/alert-manager";
import { queryOne } from "@/lib/db/index";
import { broadcast } from "@/lib/events";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BreakGlassState {
  active: boolean;
  activated_at: string;
  expires_at: string;
  duration_minutes: number;
  reason: string;
  activated_by: string;
  deactivated_at?: string;
}

function getBreakGlassState(): BreakGlassState | null {
  const raw = getSetting("break_glass");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.active) return parsed as BreakGlassState;
    return parsed as BreakGlassState;
  } catch {
    return null;
  }
}

function autoDeactivate(state: BreakGlassState): void {
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

  // Clear state
  setSetting("break_glass", JSON.stringify({
    active: false,
    deactivated_at: new Date().toISOString(),
    last_reason: state.reason,
    last_duration_minutes: actualMinutes,
    last_unscanned_count: unscannedCount,
  }));

  // Audit
  logEvent(
    "system",
    "break_glass_expired",
    "break-glass",
    "break_glass",
    `Expired after ${actualMinutes}m. Unscanned traffic: ${unscannedCount} requests.`,
    "clawnex"
  );

  // Alert
  createAlert(
    `Break-Glass Expired — ${actualMinutes}m active, ${unscannedCount} unscanned`,
    `Break-glass mode auto-expired after ${state.duration_minutes}m. ${unscannedCount} requests bypassed the shield. Reason: ${state.reason}`,
    "HIGH",
    "break-glass"
  );

  // Broadcast
  try {
    broadcast("break_glass_deactivated", { expired: true, duration: actualMinutes, unscanned: unscannedCount });
  } catch { /* ignore */ }
}

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
    const state = getBreakGlassState();

    if (!state || !state.active) {
      // Check for cool-down info
      let coolDownRemaining = 0;
      if (state && state.deactivated_at) {
        const deactivatedAt = new Date(state.deactivated_at).getTime();
        const coolDownEnd = deactivatedAt + 15 * 60 * 1000; // 15 minutes
        coolDownRemaining = Math.max(0, Math.round((coolDownEnd - Date.now()) / 1000));
      }

      return NextResponse.json({
        active: false,
        activated_at: null,
        expires_at: null,
        remaining_seconds: null,
        reason: null,
        duration_minutes: null,
        cool_down_remaining_seconds: coolDownRemaining,
      });
    }

    // Check if expired
    const expiresAt = new Date(state.expires_at).getTime();
    if (Date.now() >= expiresAt) {
      autoDeactivate(state);
      return NextResponse.json({
        active: false,
        activated_at: null,
        expires_at: null,
        remaining_seconds: null,
        reason: null,
        duration_minutes: null,
        cool_down_remaining_seconds: 15 * 60, // Just expired, full cool-down
      });
    }

    const remainingSeconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));

    return NextResponse.json({
      active: true,
      activated_at: state.activated_at,
      expires_at: state.expires_at,
      remaining_seconds: remainingSeconds,
      reason: state.reason,
      duration_minutes: state.duration_minutes,
      cool_down_remaining_seconds: 0,
    });
  } catch (err) {
    console.error("[Break-Glass Status] Error:", err);
    return NextResponse.json({ error: "Failed to get break-glass status" }, { status: 500 });
  }
}
