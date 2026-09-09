/**
 * Secret-free configuration drift and routing reconciliation history.
 *
 * This module deliberately stores normalized state only. Provider credentials,
 * bearer tokens, URL query strings, and model traffic never enter snapshots or
 * drift events.
 */

import { createHash, randomUUID } from "node:crypto";
import { queryAll, queryOne, run } from "@/lib/db";
import type { ConnectorId, ConnectorRoutingItem, ConnectorRoutingSummary } from "@/lib/services/connector-routing-inventory";

export type RoutingChangeType =
  | "provider-added"
  | "provider-removed"
  | "model-added"
  | "model-removed"
  | "model-provider-changed"
  | "endpoint-changed"
  | "authentication-changed"
  | "default-model-changed"
  | "route-changed"
  | "capability-changed";

export type ProtectionState =
  | "synchronized"
  | "selection-required"
  | "wiring-in-progress"
  | "restart-required"
  | "verification-pending"
  | "protected-and-verified"
  | "intentionally-direct"
  | "direct"
  | "new-and-unprotected"
  | "changed-and-needs-review"
  | "unknown"
  | "unavailable"
  | "unsupported"
  | "failed";

export interface NormalizedRouteState {
  key: string;
  connector: ConnectorId;
  sourceId: string;
  profileName: string | null;
  itemType: ConnectorRoutingItem["itemType"];
  providerId: string;
  modelId: string;
  proxyModelAlias: string | null;
  endpoint: string | null;
  credentialReferenceType: string;
  identityFingerprint: string | null;
  defaultModel: string | null;
  configuredRoute: ConnectorRoutingItem["desiredRoute"];
  effectiveRoute: ConnectorRoutingItem["currentRoute"];
  capability: ConnectorRoutingItem["capability"];
  present: boolean;
}

export interface RoutingDriftEvent {
  id: string;
  connector: ConnectorId;
  sourceId: string;
  itemKey: string;
  changeType: RoutingChangeType;
  protectionState: ProtectionState;
  actionRequired: boolean;
  writable: boolean;
  consequence: string;
  previous: NormalizedRouteState | null;
  current: NormalizedRouteState | null;
  detectedAt: string;
}

export interface RoutingVerification {
  connector: ConnectorId;
  configured: number;
  routed: number;
  direct: number;
  observedThroughClawNex: number;
  observedTokens: number;
  observedCostUsd: number | null;
  costStatus: "reported" | "reported-zero" | "unavailable";
  verificationSince: string | null;
  lastObservedAt: string | null;
  checkedAt: string;
  routingState: "synchronized" | "selection-required" | "verification-pending" | "protected-and-verified" | "intentionally-direct" | "unavailable" | "failed";
  status: "verified" | "partial-traffic" | "pending-traffic" | "not-routed" | "no-inventory";
  detail: string;
}

interface SnapshotRow {
  id: string;
  connector: ConnectorId;
  source_id: string;
  fingerprint: string;
  state_json: string;
  trigger: string;
  created_at: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function safeEndpoint(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "invalid-endpoint";
  }
}

export function stableRoutingFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function normalizeRoutingItem(item: ConnectorRoutingItem): NormalizedRouteState {
  const metadata = item.metadata || {};
  const profileName = typeof metadata.profileName === "string" && metadata.profileName.trim()
    ? metadata.profileName.trim()
    : null;
  const credentialReferenceType = metadata.keyEnvConfigured
    ? "environment-reference"
    : metadata.source === "watcher"
      ? "observed-only"
      : "not-disclosed";
  return {
    key: `${item.connector}\u0000${item.sourceId}\u0000${item.itemType}\u0000${item.providerId}\u0000${item.modelId}`,
    connector: item.connector,
    sourceId: item.sourceId,
    profileName,
    itemType: item.itemType,
    providerId: item.providerId,
    modelId: item.modelId,
    proxyModelAlias: typeof metadata.proxyModelAlias === 'string' ? metadata.proxyModelAlias : null,
    endpoint: safeEndpoint(item.baseUrl),
    credentialReferenceType,
    identityFingerprint: typeof metadata.identityFingerprint === 'string' ? metadata.identityFingerprint : null,
    defaultModel: typeof metadata.sourceLabel === "string" && metadata.sourceLabel === "model" ? item.modelId : null,
    configuredRoute: item.desiredRoute,
    effectiveRoute: item.currentRoute,
    capability: item.capability,
    present: item.present,
  };
}

function protectionState(state: NormalizedRouteState | null, changed: boolean): ProtectionState {
  if (!state) return "unknown";
  if (state.capability === "unsupported" || state.capability === "read-only") return "unsupported";
  // A routed URL only proves that the file contains the proxy endpoint. It
  // does not prove the gateway reloaded it or that traffic reached LiteLLM.
  // Verification is the only path that may later promote this to protected.
  if (state.effectiveRoute === "routed") return "changed-and-needs-review";
  if (state.effectiveRoute === "direct") return changed ? "new-and-unprotected" : "direct";
  return "unknown";
}

function consequence(state: NormalizedRouteState | null, changed: boolean): string {
  if (!state) return "The previously observed route is no longer present. Review the integration before relying on its traffic metrics.";
  if (state.capability === "read-only" || state.capability === "unsupported") {
    return "ClawNex can observe this configuration but cannot safely change it through the current integration contract.";
  }
  if (state.effectiveRoute === "direct") {
    return changed
      ? "Traffic may bypass ClawNex, so requests, tokens, and cost cannot be attributed through the protected path until the route is reviewed."
      : "Traffic bypasses ClawNex; requests, tokens, and cost are not guaranteed to be visible through the protected path.";
  }
  return "The route is configured for ClawNex, but a successful configuration write alone is not proof of protected traffic. Verify the active runtime and correlated traffic.";
}

function changeType(previous: NormalizedRouteState | null, current: NormalizedRouteState | null): RoutingChangeType {
  if (!previous && current) return current.itemType === "model" ? "model-added" : "provider-added";
  if (previous && !current) return previous.itemType === "model" ? "model-removed" : "provider-removed";
  if (!previous || !current) return "capability-changed";
  if (previous.providerId !== current.providerId) return "model-provider-changed";
  if (previous.endpoint !== current.endpoint) return "endpoint-changed";
  if (previous.credentialReferenceType !== current.credentialReferenceType || previous.identityFingerprint !== current.identityFingerprint) return "authentication-changed";
  if (previous.defaultModel !== current.defaultModel) return "default-model-changed";
  if (previous.effectiveRoute !== current.effectiveRoute || previous.configuredRoute !== current.configuredRoute) return "route-changed";
  if (previous.capability !== current.capability) return "capability-changed";
  return current.itemType === "model" ? "model-provider-changed" : "capability-changed";
}

function parseState(json: string | null | undefined): NormalizedRouteState[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as NormalizedRouteState[]
      : parsed && typeof parsed === 'object' && typeof parsed.key === 'string' ? [parsed as NormalizedRouteState] : [];
  } catch {
    return [];
  }
}

function latestSnapshot(connector: ConnectorId, sourceId: string): SnapshotRow | undefined {
  return queryOne<SnapshotRow>(
    `SELECT * FROM connector_routing_snapshots
     WHERE connector = ? AND source_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [connector, sourceId],
  );
}

function unresolvedExists(connector: ConnectorId, sourceId: string, itemKey: string, fingerprint: string): boolean {
  return Boolean(queryOne<{ id: string }>(
    `SELECT id FROM connector_routing_events
     WHERE connector = ? AND source_id = ? AND item_key = ? AND fingerprint = ? AND resolved_at IS NULL
     LIMIT 1`,
    [connector, sourceId, itemKey, fingerprint],
  ));
}

export function recordRoutingSnapshot(
  connector: ConnectorId,
  summary: ConnectorRoutingSummary,
  trigger: string,
): { snapshotId: string; fingerprint: string; events: RoutingDriftEvent[] } {
  const states = summary.items
    .map(normalizeRoutingItem)
    .sort((a, b) => a.key.localeCompare(b.key));
  const snapshotFingerprint = stableRoutingFingerprint(states);
  const previous = latestSnapshot(connector, summary.sourceId);
  if (previous?.fingerprint === snapshotFingerprint) {
    return { snapshotId: previous.id, fingerprint: snapshotFingerprint, events: [] };
  }
  const previousStates = parseState(previous?.state_json);
  const previousByKey = new Map(previousStates.map((state) => [state.key, state]));
  const currentByKey = new Map(states.map((state) => [state.key, state]));
  const keys = new Set([...previousByKey.keys(), ...currentByKey.keys()]);
  const events: RoutingDriftEvent[] = [];
  const detectedAt = new Date().toISOString();

  if (previous) {
    for (const key of [...keys].sort()) {
      const before = previousByKey.get(key) || null;
      const after = currentByKey.get(key) || null;
      if (before && after && stableRoutingFingerprint(before) === stableRoutingFingerprint(after)) continue;
      const current = after || before;
      const changed = Boolean(before && after);
      const fingerprint = stableRoutingFingerprint({ before, after });
      if (unresolvedExists(connector, summary.sourceId, key, fingerprint)) continue;
      const event: RoutingDriftEvent = {
        id: randomUUID(),
        connector,
        sourceId: summary.sourceId,
        itemKey: key,
        changeType: changeType(before, after),
        protectionState: protectionState(current, changed),
        // Any external change needs review, including a change that leaves a
        // provider routed. The operator must know the active model/endpoint
        // changed before ClawNex can call it protected again.
        actionRequired: Boolean(!after || changed || (after && after.effectiveRoute !== "routed")),
        writable: Boolean(after && after.capability !== "read-only" && after.capability !== "unsupported"),
        consequence: consequence(current, changed),
        previous: before,
        current: after,
        detectedAt,
      };
      run(
        `INSERT OR IGNORE INTO connector_routing_events
         (id, connector, source_id, item_key, change_type, previous_state_json,
          current_state_json, protection_state, action_required, writable,
          consequence, fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.id, connector, summary.sourceId, key, event.changeType,
          before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
          event.protectionState, event.actionRequired ? 1 : 0, event.writable ? 1 : 0,
          event.consequence, fingerprint, detectedAt],
      );
      events.push(event);
    }
  }

  const snapshotId = randomUUID();
  run(
    `INSERT INTO connector_routing_snapshots
     (id, connector, source_id, fingerprint, state_json, trigger, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [snapshotId, connector, summary.sourceId, snapshotFingerprint, JSON.stringify(states), trigger, detectedAt],
  );
  return { snapshotId, fingerprint: snapshotFingerprint, events };
}

/**
 * Verification is deliberately split into configuration and observation.
 * A rewritten endpoint is not enough to claim protection: the gateway must
 * be reloaded and at least one matching event must reach ClawNex when traffic
 * is available. This prevents the UI from reporting a false success.
 */
export function verifyRouting(summary: ConnectorRoutingSummary, options: { since?: string | null } = {}): RoutingVerification {
  const checkedAt = new Date().toISOString();
  const verificationSince = options.since || latestVerificationBaseline(summary.connector, summary.sourceId);
  const eligible = summary.items.filter((item) => item.sourceId === summary.sourceId && item.present && item.capability !== "unsupported" && item.capability !== "read-only");
  // Provider inventory rows are not extra models in the coverage denominator.
  const present = eligible.filter(item => item.itemType === 'model' || !eligible.some(model => model.itemType === 'model' && model.providerId === item.providerId));
  const routed = present.filter((item) => item.currentRoute === "routed");
  const routes = [...Map.groupBy(eligible, item => item.providerId).values()];
  const configuredRouteCount = routes.length;
  const routedRouteCount = routes.filter(rows => rows.some(item => item.currentRoute === 'routed')).length;
  const directRouteCount = routes.filter(rows => rows.every(item => item.currentRoute === 'direct')).length;
  const routedModels = routed.filter(item => item.itemType === 'model' && Boolean(item.modelId));
  const evidenceModel = (item: ConnectorRoutingItem): string =>
    typeof item.metadata.proxyModelAlias === 'string' ? item.metadata.proxyModelAlias : item.modelId;
  const modelIds = [...new Set(routed.filter(item => item.metadata.identityIntact !== false).map(evidenceModel).filter(Boolean))];
  const hashes = [...new Set(routed.map(item => item.metadata.identityHash).filter((hash): hash is string => typeof hash === 'string'))];
  const identityClause = hashes.length ? `AND routing_identity_hash IN (${hashes.map(() => '?').join(',')})` : '';
  let observedThroughClawNex = 0;
  let observedTokens = 0;
  let observedCostUsd: number | null = null;
  let costStatus: RoutingVerification["costStatus"] = "unavailable";
  let lastObservedAt: string | null = null;
  const observedModels = new Set<string>();
  if (modelIds.length > 0 && verificationSince) {
    const placeholders = modelIds.map(() => "?").join(",");
    const sinceClause = verificationSince ? "AND julianday(timestamp) >= julianday(?)" : "";
    const sinceParams = verificationSince ? [verificationSince] : [];
    const observedRows = queryAll<{ model: string | null }>(
      `SELECT DISTINCT model FROM proxy_traffic
       WHERE routing_connector = ? AND routing_source_id = ? AND routing_identity_verified = 1
         AND proxy_request_id IS NOT NULL AND direction = 'outbound'
         AND status_code BETWEEN 200 AND 299 AND blocked = 0 AND (error IS NULL OR error = '')
         AND shield_verdict != 'BYPASSED' AND model IN (${placeholders})
         ${sinceClause} ${identityClause}`,
      [summary.connector, summary.sourceId, ...modelIds, ...sinceParams, ...hashes],
    );
    observedRows.forEach((row) => { if (row.model) observedModels.add(row.model); });
    const row = queryOne<{ count: number; tokens: number | null; cost: number | null; priced: number; last_observed_at: string | null }>(
      `SELECT COUNT(*) AS count,
         COALESCE(SUM(total_tokens), 0) AS tokens,
         SUM(cost_usd) AS cost,
         SUM(CASE WHEN cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS priced,
         MAX(timestamp) AS last_observed_at
       FROM proxy_traffic
       WHERE routing_connector = ? AND routing_source_id = ? AND routing_identity_verified = 1
         AND proxy_request_id IS NOT NULL AND direction = 'outbound'
         AND status_code BETWEEN 200 AND 299 AND blocked = 0 AND (error IS NULL OR error = '')
         AND shield_verdict != 'BYPASSED' AND model IN (${placeholders})
         ${sinceClause} ${identityClause}`,
      [summary.connector, summary.sourceId, ...modelIds, ...sinceParams, ...hashes],
    );
    observedThroughClawNex = Number(row?.count || 0);
    observedTokens = Number(row?.tokens || 0);
    observedCostUsd = row?.cost === null || row?.cost === undefined ? null : Number(row.cost);
    lastObservedAt = row?.last_observed_at || null;
    if (Number(row?.priced || 0) > 0) costStatus = observedCostUsd === 0 ? "reported-zero" : "reported";
  }
  if (configuredRouteCount === 0) {
    return { connector: summary.connector, configured: 0, routed: 0, direct: 0, observedThroughClawNex: 0, observedTokens: 0, observedCostUsd: null, costStatus, verificationSince, lastObservedAt, checkedAt, routingState: "unavailable", status: "no-inventory", detail: "No writable connector routes are available to verify." };
  }
  if (routedRouteCount === 0) {
    return { connector: summary.connector, configured: configuredRouteCount, routed: 0, direct: directRouteCount, observedThroughClawNex: 0, observedTokens, observedCostUsd, costStatus, verificationSince, lastObservedAt, checkedAt, routingState: directRouteCount > 0 ? "intentionally-direct" : "selection-required", status: "not-routed", detail: "No writable routes currently point at ClawNex. Traffic may bypass real-time scanning." };
  }
  if (observedThroughClawNex === 0) {
  return { connector: summary.connector, configured: configuredRouteCount, routed: routedRouteCount, direct: directRouteCount, observedThroughClawNex: 0, observedTokens, observedCostUsd, costStatus, verificationSince, lastObservedAt, checkedAt, routingState: "verification-pending", status: "pending-traffic", detail: `Configuration points ${routedRouteCount} route(s) at ClawNex, but no matching traffic was observed after the latest routing operation. Restart the connector if required, send a new test request, then verify again. Historical traffic is not counted as proof.` };
  }
  // Promote only the routes for which matching traffic was actually observed.
  // Other routed rows remain pending and continue to require review. A single
  // observed model must never make a multi-model route look fully protected.
  const unobservedRouted = routedModels.filter((item) => !observedModels.has(evidenceModel(item)));
  for (const event of listUnresolvedRoutingEvents(200)) {
    if (event.connector !== summary.connector || event.sourceId !== summary.sourceId || event.current?.effectiveRoute !== "routed") continue;
    const eventModel = event.current.proxyModelAlias || event.current.modelId;
    if (!eventModel || !observedModels.has(eventModel)) continue;
    run(
      `UPDATE connector_routing_events
      SET protection_state = 'protected-and-verified', action_required = 0, resolved_at = ?
       WHERE id = ? AND resolved_at IS NULL`,
      [new Date().toISOString(), event.id],
    );
  }
  if (unobservedRouted.length > 0) {
    return {
      connector: summary.connector,
      configured: configuredRouteCount,
      routed: routedRouteCount,
      direct: directRouteCount,
      observedThroughClawNex,
      observedTokens,
      observedCostUsd,
      costStatus,
      verificationSince,
      lastObservedAt,
      checkedAt,
      routingState: "verification-pending",
      status: "partial-traffic",
      detail: `Observed ${observedModels.size} of ${routedModels.length} routed model(s) through ClawNex. ${unobservedRouted.length} routed model(s) still have no correlated traffic, so full protection is not verified. Send traffic for the remaining model(s) and verify again.`,
    };
  }
  return { connector: summary.connector, configured: configuredRouteCount, routed: routedRouteCount, direct: directRouteCount, observedThroughClawNex, observedTokens, observedCostUsd, costStatus, verificationSince, lastObservedAt, checkedAt, routingState: "protected-and-verified", status: "verified", detail: `Verified all ${routedModels.length} routed model(s) across ${routedRouteCount} provider route(s) with ${observedThroughClawNex} matching ClawNex traffic event(s) after the latest routing operation (${observedTokens.toLocaleString()} tokens; cost ${observedCostUsd === null ? "unavailable" : `$${observedCostUsd.toFixed(4)}`}).` };
}

function latestVerificationBaseline(connector: ConnectorId, sourceId: string): string | null {
  const operation = queryOne<{ created_at: string }>(
    `SELECT created_at FROM connector_routing_operations
     WHERE connector = ? AND source_id = ? AND operation IN ('apply', 'revert', 'restart')
     ORDER BY created_at DESC LIMIT 1`,
    [connector, sourceId],
  );
  const snapshot = queryOne<{ created_at: string }>(
    `SELECT created_at FROM connector_routing_snapshots
     WHERE connector = ? AND source_id = ? ORDER BY created_at DESC LIMIT 1`,
    [connector, sourceId],
  );
  const event = queryOne<{ created_at: string }>(
    `SELECT created_at FROM connector_routing_events
     WHERE connector = ? AND source_id = ? AND resolved_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [connector, sourceId],
  );
  const candidates = [operation?.created_at, snapshot?.created_at, event?.created_at]
    .filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null;
}

export function listUnresolvedRoutingEvents(limit = 50): RoutingDriftEvent[] {
  const rows = queryAll<{
    id: string; connector: ConnectorId; source_id: string; item_key: string;
    change_type: RoutingChangeType; previous_state_json: string | null;
    current_state_json: string | null; protection_state: ProtectionState;
    action_required: number; writable: number; consequence: string; created_at: string;
  }>(
    `SELECT id, connector, source_id, item_key, change_type,
      previous_state_json, current_state_json, protection_state,
      action_required, writable, consequence, created_at
     FROM connector_routing_events WHERE resolved_at IS NULL
     ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    connector: row.connector,
    sourceId: row.source_id,
    itemKey: row.item_key,
    changeType: row.change_type,
    protectionState: row.protection_state,
    actionRequired: row.action_required === 1,
    writable: row.writable === 1,
    consequence: row.consequence,
    previous: parseState(row.previous_state_json)[0] || null,
    current: parseState(row.current_state_json)[0] || null,
    detectedAt: row.created_at,
  }));
}

export function resolveRoutingEvents(ids: string[], reason: string, connector?: ConnectorId): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const connectorClause = connector ? " AND connector = ?" : "";
  const result = run(
    `UPDATE connector_routing_events SET resolved_at = ?
     WHERE id IN (${placeholders}) AND resolved_at IS NULL${connectorClause}`,
    [new Date().toISOString(), ...ids, ...(connector ? [connector] : [])],
  );
  void reason;
  return result.changes;
}

export function recordRoutingOperation(input: {
  connector: ConnectorId;
  sourceId?: string;
  operation: string;
  outcome: string;
  detail: string;
  beforeSnapshotId?: string | null;
  afterSnapshotId?: string | null;
  restartOutcome?: string | null;
  verificationOutcome?: string | null;
  actor?: string | null;
}): string {
  const id = randomUUID();
  run(
    `INSERT INTO connector_routing_operations
     (id, connector, operation, before_snapshot_id, after_snapshot_id,
      outcome, restart_outcome, verification_outcome, detail, actor, created_at, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.connector, input.operation, input.beforeSnapshotId || null,
      input.afterSnapshotId || null, input.outcome, input.restartOutcome || null,
      input.verificationOutcome || null, input.detail, input.actor || null,
      new Date().toISOString(), input.sourceId || null],
  );
  return id;
}

export function routingOperationCreatedAt(id: string): string | null {
  return queryOne<{ created_at: string }>(
    "SELECT created_at FROM connector_routing_operations WHERE id = ?",
    [id],
  )?.created_at || null;
}
