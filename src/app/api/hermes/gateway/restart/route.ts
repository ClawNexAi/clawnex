/**
 * Hermes Gateway Restart API
 *
 * GET  /api/hermes/gateway/restart  -- supervisor detection only
 * POST /api/hermes/gateway/restart  -- restart known Hermes gateway supervisors
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requirePermission, requireSession } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { detectHermesSupervisor, restartHermesGateway } from "@/lib/services/hermes-gateway-control";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readGuard(request: NextRequest): NextResponse | null {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    return requirePermission(auth.operator, "config:read") || null;
  }
  return requireLocalhost(request);
}

function writeGuard(request: NextRequest): NextResponse | null {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    return requirePermission(auth.operator, "config:write") || null;
  }
  return requireLocalhost(request);
}

export async function GET(request: NextRequest) {
  const guard = readGuard(request);
  if (guard) return guard;

  try {
    const supervisor = await detectHermesSupervisor();
    return NextResponse.json({ ok: true, supervisor });
  } catch (err) {
    console.error("[Hermes Gateway Restart] Detection error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const guard = writeGuard(request);
  if (guard) return guard;

  try {
    const result = await restartHermesGateway();
    logEvent(
      "config",
      "hermes_gateway_restart",
      "hermes",
      "gateway",
      `restart: ${result.status} via ${result.supervisor} (${result.detail})`,
      "api",
    );
    const httpStatus = result.ok ? 200 : result.status === "unsupported" ? 501 : 500;
    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    console.error("[Hermes Gateway Restart] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
