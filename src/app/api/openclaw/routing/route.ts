/**
 * OpenClaw Routing API
 * GET  /api/openclaw/routing       — reads openclaw.json and reports
 *                                    provider routing status + ClawNex
 *                                    wire-management state (sidecar).
 * POST /api/openclaw/routing       — wire / revert / inspect actions.
 *                                    Body: { action: 'wire' | 'revert' | 'inspect',
 *                                            force?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { resolveOpenClawPaths, readOpenClawConfig } from "@/lib/openclaw-paths";
import {
  wireLitellmRouting,
  revertLitellmRouting,
  inspectLitellmRouting,
} from "@/lib/services/openclaw-routing-wire";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const { configPath } = resolveOpenClawPaths();
    if (!configPath) {
      return NextResponse.json({ found: false, error: "openclaw.json not found" });
    }

    const data = readOpenClawConfig();
    if (!data) {
      return NextResponse.json({ found: false, error: "Failed to parse openclaw.json" });
    }

    const litellmPort = process.env.LITELLM_PORT || "4001";

    // Extract providers with routing status
    const providersRaw = (data?.models as { providers?: Record<string, unknown> })?.providers || {};
    const providers = Object.entries(providersRaw).map(([id, p]) => {
      const prov = p as { baseUrl?: string; name?: string };
      const baseUrl = prov.baseUrl || "";
      const routed = baseUrl.includes(`127.0.0.1:${litellmPort}`) || baseUrl.includes(`localhost:${litellmPort}`);
      return { id, name: id, baseUrl, routed };
    });

    // Gateway token
    const gatewayToken = (data?.gateway as { auth?: { token?: string } })?.auth?.token || "";

    // ClawNex-managed wire state (internal reviewer M-01 follow-up 2026-04-29). The
    // sidecar at ~/.clawnex-routing-managed.json records exactly which
    // openclaw.json paths ClawNex wrote, plus SHA256 of each value at
    // write time so revert can detect operator edits and preserve them.
    // GET surfaces this so the dashboard / wizard can show "managed"
    // vs "operator-owned" wire status without trying any mutation.
    const managed = inspectLitellmRouting();
    const openclawVersion = (data?.meta as { lastTouchedVersion?: string } | undefined)?.lastTouchedVersion ?? null;

    return NextResponse.json({
      found: true,
      path: configPath,
      providers,
      gatewayToken: gatewayToken ? `${gatewayToken.slice(0, 8)}...${gatewayToken.slice(-4)}` : "",
      hasToken: !!gatewayToken,
      litellmTarget: `http://127.0.0.1:${litellmPort}/v1`,
      openclawVersion,
      managed: {
        sidecar: managed.sidecar,
        pathStatus: managed.status,
      },
    });
  } catch (err) {
    console.error('[OpenClaw Routing] Error:', err);
    return NextResponse.json({ found: false, error: "Failed to read routing configuration" });
  }
}

export async function POST(request: NextRequest) {
  // Mutations require the same guard as other config-write surfaces:
  // RBAC session + config:write permission when RBAC is on, localhost
  // fallback otherwise. Same dual-flag pattern as the rest of the
  // dashboard (see RBAC-Off Defense Pattern memory).
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  let body: { action?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'wire' && action !== 'revert' && action !== 'inspect') {
    return NextResponse.json(
      { ok: false, error: `Invalid action. Must be one of: wire, revert, inspect.` },
      { status: 400 },
    );
  }

  try {
    if (action === 'inspect') {
      const result = inspectLitellmRouting();
      return NextResponse.json({ ok: true, action, ...result });
    }

    if (action === 'wire') {
      const result = wireLitellmRouting({ force: Boolean(body.force) });
      logEvent('config', 'openclaw_routing_wire', 'openclaw', 'litellm', `wire: ${result.status} (${result.detail})`, 'api');
      const httpStatus = result.ok ? 200 : (result.status === 'conflict' ? 409 : 500);
      return NextResponse.json({ action, ...result }, { status: httpStatus });
    }

    // action === 'revert'
    const result = revertLitellmRouting();
    logEvent('config', 'openclaw_routing_revert', 'openclaw', 'litellm', `revert: ${result.status} (${result.detail})`, 'api');
    const httpStatus = result.ok ? 200 : 500;
    return NextResponse.json({ action, ...result }, { status: httpStatus });
  } catch (err) {
    console.error('[OpenClaw Routing] POST Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
