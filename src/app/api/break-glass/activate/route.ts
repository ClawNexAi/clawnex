/**
 * POST /api/break-glass/activate — Activate break-glass mode.
 * Body: { reason: string (min 10 chars), duration_minutes: 15|30|60|120|240 }
 *
 * Requires management authorization. Time-limited. Fully audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { getSetting, setSetting } from "@/lib/services/config-service";
import { logEvent } from "@/lib/services/audit-logger";
import { createAlert } from "@/lib/services/alert-manager";
import { broadcast } from "@/lib/events";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

const VALID_DURATIONS = [15, 30, 60, 120, 240];
const COOL_DOWN_MS = 15 * 60 * 1000; // 15 minutes

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
    const body = await request.json();
    const { reason, duration_minutes } = body as {
      reason?: string;
      duration_minutes?: number;
    };

    // Validate reason
    if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
      return NextResponse.json(
        { error: "Reason is required (minimum 10 characters)" },
        { status: 400 }
      );
    }

    // Validate duration
    if (!duration_minutes || !VALID_DURATIONS.includes(duration_minutes)) {
      return NextResponse.json(
        { error: `Invalid duration. Must be one of: ${VALID_DURATIONS.join(", ")} minutes` },
        { status: 400 }
      );
    }

    // Check if already active
    const current = getSetting("break_glass");
    if (current) {
      try {
        const state = JSON.parse(current);
        if (state.active) {
          const expiresAt = new Date(state.expires_at).getTime();
          if (Date.now() < expiresAt) {
            return NextResponse.json(
              { error: "Break-glass is already active", expires_at: state.expires_at },
              { status: 409 }
            );
          }
        }

        // Check cool-down
        if (state.deactivated_at) {
          const deactivatedAt = new Date(state.deactivated_at).getTime();
          if (Date.now() - deactivatedAt < COOL_DOWN_MS) {
            const remainingSeconds = Math.round((deactivatedAt + COOL_DOWN_MS - Date.now()) / 1000);
            return NextResponse.json(
              { error: `Cool-down active. ${remainingSeconds} seconds remaining before re-activation is allowed.` },
              { status: 429 }
            );
          }
        }
      } catch { /* invalid state, allow activation */ }
    }

    // Activate
    const currentOp = getOperatorFromRequest(request);
    const actor = currentOp?.username || 'operator';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration_minutes * 60 * 1000);

    const state = {
      active: true,
      activated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      duration_minutes,
      reason: reason.trim(),
      activated_by: actor,
    };

    setSetting("break_glass", JSON.stringify(state));

    // Audit log
    logEvent(
      actor,
      "break_glass_activated",
      "break-glass",
      "break_glass",
      `Duration: ${duration_minutes}m. Reason: ${reason.trim()}`,
      "dashboard"
    );

    // CRITICAL alert
    createAlert(
      `Break-Glass Activated — Shield bypass for ${duration_minutes}m`,
      `${actor} activated break-glass mode. All LLM traffic will bypass the Prompt Shield for ${duration_minutes} minutes. Reason: ${reason.trim()}`,
      "CRITICAL",
      "break-glass"
    );

    // Broadcast to all dashboards
    try {
      broadcast("break_glass_activated", {
        activated_at: state.activated_at,
        expires_at: state.expires_at,
        duration_minutes,
        reason: reason.trim(),
      });
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      activated_at: state.activated_at,
      expires_at: state.expires_at,
      duration_minutes,
    });
  } catch (err) {
    console.error("[Break-Glass Activate] Error:", err);
    return NextResponse.json({ error: "Failed to activate break-glass" }, { status: 500 });
  }
}
