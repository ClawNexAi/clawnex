/**
 * Connector Routing API
 *
 * GET  /api/connector-routing
 *   Discover OpenClaw, Hermes, and OpenCode routing inventory, persist drift state, and
 *   return operator-selectable rows.
 *
 * POST /api/connector-routing
 *   Body:
 *     { action: "select", connector, itemIds, desiredRoute }
 *     { action: "select-all", connector, desiredRoute }
 *     { action: "prepare", connector, sourceId, operation }
 *     { action: "execute-plan", planId, approved }
 *     { action: "wire-hermes-model", itemId }
 *     { action: "revert-hermes" }
 *     { action: "sync" }
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requirePermission, requireSession, getOperatorFromRequest } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { logEvent } from "@/lib/services/audit-logger";
import {
  setAllConnectorRoutingSelections,
  setConnectorRoutingSelections,
  syncConnectorRoutingInventory,
  wireHermesModel,
  type ConnectorId,
  type DesiredRoutingState,
} from "@/lib/services/connector-routing-inventory";
import { recordRoutingOperation, resolveRoutingEvents, verifyRouting } from "@/lib/services/routing-reconciliation";
import { prepareRoutingPlan, executeRoutingPlan } from '@/lib/services/routing-workflow';
import { getRoutingModule } from '@/lib/services/routing-modules';

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
  if (value === "openclaw" || value === "hermes" || value === 'opencode' || value === 'pi') return value;
  throw new Error("Unsupported routing connector");
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
    if (action === 'prepare') {
      const connector = parseConnector(body.connector);
      if (typeof body.sourceId !== 'string' || !body.sourceId) throw new Error('Select one instance to review.');
      if (body.operation !== 'apply' && body.operation !== 'restore') throw new Error('Choose apply or restore.');
      const plan = prepareRoutingPlan(connector, body.sourceId, body.operation);
      return NextResponse.json({ ok: true, plan });
    }
    if (action === 'execute-plan') {
      if (typeof body.planId !== 'string') throw new Error('Review a routing plan first.');
      const result = await executeRoutingPlan(body.planId, body.approved === true, getOperatorFromRequest(request)?.username || 'localhost');
      return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : 409 });
    }
    if (['apply-openclaw', 'apply-hermes', 'revert-hermes'].includes(String(action))) {
      return NextResponse.json({ ok: false, error: 'Use Review connection changes or Restore direct connection to approve an instance-specific plan.' }, { status: 409 });
    }
    if (action === "sync") {
      const data = syncConnectorRoutingInventory("manual-sync");
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


    if (action === "wire-hermes-model") {
      const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
      if (!itemId) return NextResponse.json({ ok: false, error: "itemId is required" }, { status: 400 });
      const result = await wireHermesModel(itemId);
      if (result.ok) {
        logEvent("config", "connector_routing_wire_hermes_model", "connector_routing", itemId, `${result.status}: ${result.modelId || "model"}`, "api");
      }
      return NextResponse.json({ ok: result.ok, action, result }, { status: result.ok ? 200 : 409 });
    }


    if (action === "verify") {
      const connector = parseConnector(body.connector);
      if (typeof body.sourceId !== 'string' || !body.sourceId) throw new Error('Select one instance to verify.');
      const inventory = syncConnectorRoutingInventory("verify");
      const summary = getRoutingModule(connector).inspect(body.sourceId);
      const verification = verifyRouting(summary);
      recordRoutingOperation({ connector, sourceId: body.sourceId, actor: getOperatorFromRequest(request)?.username || 'localhost', operation: "verify", outcome: verification.status, detail: verification.detail, afterSnapshotId: inventory.reconciliation.lastSnapshotIds[connector], verificationOutcome: verification.status });
      logEvent("config", "connector_routing_verify", "connector_routing", connector, verification.detail, "api");
      return NextResponse.json({ ok: true, action, connector, verification, reconciliation: inventory.reconciliation });
    }

    if (action === "mark-intentionally-direct") {
      const connector = parseConnector(body.connector);
      const eventIds = Array.isArray(body.eventIds) ? body.eventIds.map(String).filter(Boolean) : [];
      const reason = typeof body.reason === "string" && body.reason.trim().length >= 3 ? body.reason.trim().slice(0, 500) : "Operator confirmed this route should remain direct.";
      if (eventIds.length === 0) return NextResponse.json({ ok: false, error: "eventIds is required" }, { status: 400 });
      const resolved = resolveRoutingEvents(eventIds, reason, connector);
      recordRoutingOperation({ connector, operation: "mark-intentionally-direct", outcome: "acknowledged", detail: `${reason} (${resolved} event(s) acknowledged)` });
      logEvent("config", "connector_routing_intentionally_direct", "connector_routing", connector, reason, "api");
      const inventory = syncConnectorRoutingInventory("intentional-direct");
      return NextResponse.json({ ok: true, action, connector, reconciliation: inventory.reconciliation });
    }

    if (action === "dismiss") {
      const connector = parseConnector(body.connector);
      const eventIds = Array.isArray(body.eventIds) ? body.eventIds.map(String).filter(Boolean) : [];
      const reason = typeof body.reason === "string" && body.reason.trim().length >= 3 ? body.reason.trim().slice(0, 500) : "Operator dismissed this routing notice for later review.";
      if (eventIds.length === 0) return NextResponse.json({ ok: false, error: "eventIds is required" }, { status: 400 });
      const resolved = resolveRoutingEvents(eventIds, reason, connector);
      recordRoutingOperation({ connector, operation: "dismiss", outcome: "acknowledged", detail: `${reason} (${resolved} event(s) dismissed)` });
      logEvent("config", "connector_routing_dismiss", "connector_routing", connector, reason, "api");
      const inventory = syncConnectorRoutingInventory("dismiss");
      return NextResponse.json({ ok: true, action, connector, resolved, reconciliation: inventory.reconciliation });
    }

    return NextResponse.json(
      { ok: false, error: "Invalid action. Must be one of: prepare, execute-plan, sync, select, select-all, wire-hermes-model, verify, mark-intentionally-direct, dismiss." },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
