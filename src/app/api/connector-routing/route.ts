/**
 * Connector Routing API
 *
 * GET  /api/connector-routing
 *   Discover OpenClaw/Hermes routing inventory, persist drift state, and
 *   return operator-selectable rows.
 *
 * POST /api/connector-routing
 *   Body:
 *     { action: "select", connector, itemIds, desiredRoute }
 *     { action: "select-all", connector, desiredRoute }
 *     { action: "apply-openclaw" }
 *     { action: "apply-hermes" }
 *     { action: "revert-hermes" }
 *     { action: "sync" }
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requirePermission, requireSession } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { logEvent } from "@/lib/services/audit-logger";
import {
  applyHermesDesiredRouting,
  applyOpenClawDesiredRouting,
  revertHermesRouting,
  setAllConnectorRoutingSelections,
  setConnectorRoutingSelections,
  syncConnectorRoutingInventory,
  type ConnectorId,
  type DesiredRoutingState,
} from "@/lib/services/connector-routing-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readGuard(request: NextRequest): NextResponse | null {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "config:read");
    return perm || null;
  }
  return requireLocalhost(request);
}

function writeGuard(request: NextRequest): NextResponse | null {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "config:write");
    return perm || null;
  }
  return requireLocalhost(request);
}

function parseConnector(value: unknown): ConnectorId {
  if (value === "openclaw" || value === "hermes") return value;
  throw new Error("connector must be openclaw or hermes");
}

function parseDesiredRoute(value: unknown): DesiredRoutingState {
  if (value === "routed" || value === "direct") return value;
  throw new Error("desiredRoute must be routed or direct");
}

export async function GET(request: NextRequest) {
  const guard = readGuard(request);
  if (guard) return guard;

  try {
    return NextResponse.json(syncConnectorRoutingInventory());
  } catch (err) {
    console.error("[Connector Routing] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to sync connector routing inventory" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const guard = writeGuard(request);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  try {
    const action = body.action;
    if (action === "sync") {
      const data = syncConnectorRoutingInventory();
      logEvent("config", "connector_routing_sync", "connector_routing", "all", `sync: drift=${data.driftTotal}`, "api");
      return NextResponse.json({ ok: true, action, ...data });
    }

    if (action === "select") {
      const connector = parseConnector(body.connector);
      const desiredRoute = parseDesiredRoute(body.desiredRoute);
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String) : [];
      const summary = setConnectorRoutingSelections(connector, itemIds, desiredRoute);
      logEvent("config", "connector_routing_select", "connector_routing", connector, `select ${itemIds.length} item(s) -> ${desiredRoute}`, "api");
      return NextResponse.json({ ok: true, action, connector, summary });
    }

    if (action === "select-all") {
      const connector = parseConnector(body.connector);
      const desiredRoute = parseDesiredRoute(body.desiredRoute);
      const summary = setAllConnectorRoutingSelections(connector, desiredRoute);
      logEvent("config", "connector_routing_select_all", "connector_routing", connector, `select-all -> ${desiredRoute}`, "api");
      return NextResponse.json({ ok: true, action, connector, summary });
    }

    if (action === "apply-openclaw") {
      const result = applyOpenClawDesiredRouting();
      logEvent(
        "config",
        "connector_routing_apply_openclaw",
        "connector_routing",
        "openclaw",
        `${result.status}: routed=${result.routedProviders.length} restored=${result.restoredProviders.length}`,
        "api",
      );
      return NextResponse.json({ ok: result.ok, action, result }, { status: result.ok ? 200 : 500 });
    }

    if (action === "apply-hermes") {
      const result = applyHermesDesiredRouting();
      logEvent(
        "config",
        "connector_routing_apply_hermes",
        "connector_routing",
        "hermes",
        `${result.status}: routed=${result.routedProviders.length} restored=${result.restoredProviders.length}`,
        "api",
      );
      return NextResponse.json({ ok: result.ok, action, result }, { status: result.ok ? 200 : 500 });
    }

    if (action === "revert-hermes") {
      const result = revertHermesRouting();
      logEvent(
        "config",
        "connector_routing_revert_hermes",
        "connector_routing",
        "hermes",
        `${result.status}: restored=${result.restoredProviders.length} skipped=${result.skippedProviders.length}`,
        "api",
      );
      return NextResponse.json({ ok: result.ok, action, result }, { status: result.ok ? 200 : 500 });
    }

    return NextResponse.json(
      { ok: false, error: "Invalid action. Must be one of: sync, select, select-all, apply-openclaw, apply-hermes, revert-hermes." },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
