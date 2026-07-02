/**
 * Connector routing inventory
 *
 * Tracks what OpenClaw and Hermes model/provider routes exist, what the
 * operator wants routed, and what changed since the previous scan.
 *
 * OpenClaw is enforceable at provider level by changing the provider base URL
 * to the local LiteLLM proxy. Hermes is enforceable only for config-backed
 * custom_providers with HTTP-compatible base_url values; OAuth/session-bound
 * or watcher-only Hermes rows remain read-only.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { config } from "@/lib/config";
import { queryAll, queryOne, run, transaction } from "@/lib/db/index";
import { readOpenClawConfig, resolveOpenClawPaths } from "@/lib/openclaw-paths";
import { CLAWNEX_VERSION } from "@/lib/version";

export type ConnectorId = "openclaw" | "hermes";
export type RoutingItemType = "provider" | "model";
export type RoutingCapability = "provider-routing" | "model-inventory" | "read-only" | "unsupported";
export type RoutingState = "routed" | "direct" | "unknown" | "unsupported";
export type DesiredRoutingState = "routed" | "direct";

export interface ConnectorRoutingItem {
  id: string;
  connector: ConnectorId;
  sourceId: string;
  itemType: RoutingItemType;
  providerId: string;
  modelId: string;
  displayName: string;
  baseUrl: string | null;
  capability: RoutingCapability;
  currentRoute: RoutingState;
  desiredRoute: DesiredRoutingState;
  present: boolean;
  fingerprint: string;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  lastChangedAt: string | null;
  updatedAt: string;
  isNew?: boolean;
  isRemoved?: boolean;
  isChanged?: boolean;
}

export interface ConnectorRoutingSummary {
  connector: ConnectorId;
  sourceId: string;
  status: "ok" | "missing" | "read-only" | "error";
  detail: string;
  items: ConnectorRoutingItem[];
  drift: {
    new: number;
    removed: number;
    changed: number;
    total: number;
  };
  selected: number;
  scannedAt: string;
}

export interface ConnectorRoutingResponse {
  litellmTarget: string;
  openclaw: ConnectorRoutingSummary;
  hermes: ConnectorRoutingSummary;
  driftTotal: number;
  scannedAt: string;
}

interface DbRoutingRow {
  id: string;
  connector: ConnectorId;
  source_id: string;
  item_type: RoutingItemType;
  provider_id: string;
  model_id: string;
  display_name: string;
  base_url: string | null;
  capability: RoutingCapability;
  current_route: RoutingState;
  desired_route: DesiredRoutingState;
  present: number;
  fingerprint: string;
  metadata: string;
  first_seen_at: string;
  last_seen_at: string;
  last_changed_at: string | null;
  updated_at: string;
}

interface DiscoveredRoutingItem {
  connector: ConnectorId;
  sourceId: string;
  itemType: RoutingItemType;
  providerId: string;
  modelId: string;
  displayName: string;
  baseUrl: string | null;
  capability: RoutingCapability;
  currentRoute: RoutingState;
  defaultDesiredRoute: DesiredRoutingState;
  metadata: Record<string, unknown>;
}

interface OpenClawProviderRef {
  id: string;
  value: Record<string, unknown>;
  baseUrlKey: "baseUrl" | "base_url" | null;
  baseUrl: string;
}

const SELECTIVE_SIDECAR_PATH = process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR
  || path.join(os.homedir(), ".clawnex-selective-routing-managed.json");
const SELECTIVE_SIDECAR_VERSION = 1;
const HERMES_SIDECAR_PATH = process.env.CLAWNEX_HERMES_ROUTING_SIDECAR
  || path.join(os.homedir(), ".clawnex-hermes-routing-managed.json");
const HERMES_SIDECAR_VERSION = 1;
const HERMES_LITELLM_PROVIDER_NAME = "clawnex-litellm";
const HERMES_LITELLM_KEY_ENV = "LITELLM_MASTER_KEY";

interface SelectiveProviderRecord {
  providerId: string;
  baseUrlKey: "baseUrl" | "base_url";
  originalBaseUrl: string;
  routedBaseUrl: string;
  valueSha256: string;
  routedAt: string;
}

interface SelectiveRoutingSidecar {
  version: 1;
  managedAt: string;
  clawnexVersion: string;
  openclawVersion: string | null;
  providers: SelectiveProviderRecord[];
}

interface HermesProviderRecord {
  homePath: string;
  configPath: string;
  providerId: string;
  originalBaseUrl: string | null;
  hadBaseUrl: boolean;
  baseUrlKey: "base_url" | "baseUrl";
  originalKeyEnv: string | null;
  hadKeyEnv: boolean;
  originalApiMode: string | null;
  hadApiMode: boolean;
  routedBaseUrl: string;
  routedAt: string;
}

interface HermesRoutingSidecar {
  version: 1;
  managedAt: string;
  clawnexVersion: string;
  providers: HermesProviderRecord[];
}

interface HermesProviderConfigRef {
  name: string;
  baseUrl: string | null;
  baseUrlKey: "base_url" | "baseUrl";
  keyEnv: string | null;
  apiMode: string | null;
  raw: Record<string, unknown>;
}

interface HermesHomeRef {
  sourceId: string;
  homePath: string;
  configPath: string;
  name: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function itemId(connector: ConnectorId, sourceId: string, itemType: RoutingItemType, providerId: string, modelId: string): string {
  return `cri_${stableHash([connector, sourceId, itemType, providerId, modelId]).slice(0, 24)}`;
}

function uniqueKey(row: Pick<ConnectorRoutingItem | DiscoveredRoutingItem, "connector" | "sourceId" | "itemType" | "providerId" | "modelId">): string {
  return [row.connector, row.sourceId, row.itemType, row.providerId, row.modelId].join("\u0000");
}

function litellmTarget(): string {
  const port = process.env.LITELLM_PORT || "4001";
  return `http://127.0.0.1:${port}/v1`;
}

export function classifyConnectorRoute(baseUrl: string | null | undefined): RoutingState {
  if (!baseUrl) return "direct";
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : "");
    const litellmPort = process.env.LITELLM_PORT || "4001";
    if ((host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") && (port === litellmPort || parsed.href.includes(`:${litellmPort}`))) {
      return "routed";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "unsupported";
    return "direct";
  } catch {
    return "unknown";
  }
}

function providerCapability(baseUrl: string | null): RoutingCapability {
  if (!baseUrl) return "unsupported";
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return "provider-routing";
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

function isProxyBridgeProvider(connector: ConnectorId, providerId: string): boolean {
  return (connector === "openclaw" && providerId === "litellm")
    || (connector === "hermes" && providerId === HERMES_LITELLM_PROVIDER_NAME);
}

function expandHomePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

function normalizePathKey(input: string): string {
  return path.resolve(expandHomePath(input));
}

function hermesSourceId(homePath: string): string {
  const resolved = normalizePathKey(homePath);
  const base = path.basename(resolved) || "hermes";
  return `${base}-${stableHash(resolved).slice(0, 8)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inferProviderFromModel(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[0] : "unknown";
}

function knownHermesHomes(): HermesHomeRef[] {
  const byPath = new Map<string, HermesHomeRef>();
  const addHome = (homePath: string, name: string) => {
    const resolved = normalizePathKey(homePath);
    if (byPath.has(resolved)) return;
    byPath.set(resolved, {
      sourceId: hermesSourceId(resolved),
      homePath: resolved,
      configPath: path.join(resolved, "config.yaml"),
      name,
    });
  };

  addHome(config.hermes.home, "Hermes default");
  const rows = queryAll<{ name: string; home_path: string; is_active: number }>(
    "SELECT name, home_path, is_active FROM hermes_instances WHERE is_active = 1 ORDER BY created_at ASC",
  );
  for (const row of rows) {
    if (row.home_path) addHome(row.home_path, row.name || "Hermes instance");
  }
  return [...byPath.values()];
}

function parseHermesConfig(configPath: string): { ok: true; raw: string; doc: YAML.Document.Parsed; data: Record<string, unknown> } | { ok: false; error: string } {
  try {
    if (!fs.existsSync(configPath)) return { ok: false, error: "config.yaml not found" };
    const raw = fs.readFileSync(configPath, "utf8");
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length > 0) {
      return { ok: false, error: doc.errors.map((err) => err.message).join("; ") };
    }
    const data = asRecord(doc.toJS()) || {};
    return { ok: true, raw, doc, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function hermesProviderConfigs(data: Record<string, unknown>): HermesProviderConfigRef[] {
  const customProviders = Array.isArray(data.custom_providers) ? data.custom_providers : [];
  return customProviders
    .map((entry) => {
      const obj = asRecord(entry);
      if (!obj) return null;
      const name = stringValue(obj.name);
      if (!name) return null;
      const baseUrlKey: "base_url" | "baseUrl" = typeof obj.base_url === "string" ? "base_url" : "baseUrl";
      const baseUrl = stringValue(obj[baseUrlKey]);
      return {
        name,
        baseUrl,
        baseUrlKey,
        keyEnv: stringValue(obj.key_env) || stringValue(obj.keyEnv),
        apiMode: stringValue(obj.api_mode) || stringValue(obj.apiMode),
        raw: obj,
      };
    })
    .filter((entry): entry is HermesProviderConfigRef => Boolean(entry));
}

function addHermesModelItem(
  items: DiscoveredRoutingItem[],
  home: HermesHomeRef,
  providerMap: Map<string, HermesProviderConfigRef>,
  sourceLabel: string,
  modelObj: Record<string, unknown>,
): void {
  const modelId = stringValue(modelObj.default)
    || stringValue(modelObj.model)
    || stringValue(modelObj.id)
    || stringValue(modelObj.name);
  if (!modelId) return;
  const providerId = stringValue(modelObj.provider) || inferProviderFromModel(modelId);
  const customProvider = providerMap.get(providerId);
  const inlineBaseUrl = stringValue(modelObj.base_url) || stringValue(modelObj.baseUrl);
  const baseUrl = customProvider?.baseUrl || inlineBaseUrl;
  const currentRoute = classifyConnectorRoute(baseUrl);
  const providerRouteCap = customProvider ? providerCapability(customProvider.baseUrl) : "read-only";
  const capability: RoutingCapability = customProvider && customProvider.name !== HERMES_LITELLM_PROVIDER_NAME
    ? providerRouteCap === "provider-routing" ? "model-inventory" : providerRouteCap
    : "read-only";
  const defaultDesiredRoute: DesiredRoutingState = currentRoute === "routed" ? "routed" : "direct";

  items.push({
    connector: "hermes",
    sourceId: home.sourceId,
    itemType: "model",
    providerId,
    modelId,
    displayName: modelId,
    baseUrl: baseUrl || null,
    capability,
    currentRoute,
    defaultDesiredRoute,
    metadata: {
      source: "config",
      sourceLabel,
      homePath: home.homePath,
      configPath: home.configPath,
      routeMode: customProvider ? "custom_provider" : "observed_or_builtin",
      enforcedAt: customProvider ? "provider" : "read-only",
      keyEnvConfigured: Boolean(customProvider?.keyEnv),
      note: customProvider
        ? "Hermes routes this model through its custom provider endpoint; selecting it routes that provider."
        : "Hermes model is not backed by a writable custom provider in config.yaml.",
    },
  });
}

function discoverHermesConfigItems(): {
  status: ConnectorRoutingSummary["status"];
  detail: string;
  items: DiscoveredRoutingItem[];
  errors: string[];
} {
  const homes = knownHermesHomes();
  const items: DiscoveredRoutingItem[] = [];
  const errors: string[] = [];

  for (const home of homes) {
    const parsed = parseHermesConfig(home.configPath);
    if (!parsed.ok) {
      if (fs.existsSync(home.configPath)) errors.push(`${home.configPath}: ${parsed.error}`);
      continue;
    }

    const providers = hermesProviderConfigs(parsed.data);
    const providerMap = new Map(providers.map((provider) => [provider.name, provider]));
    for (const provider of providers) {
      const currentRoute = classifyConnectorRoute(provider.baseUrl);
      const capability = provider.name === HERMES_LITELLM_PROVIDER_NAME ? "unsupported" : providerCapability(provider.baseUrl);
      items.push({
        connector: "hermes",
        sourceId: home.sourceId,
        itemType: "provider",
        providerId: provider.name,
        modelId: "",
        displayName: provider.name,
        baseUrl: provider.baseUrl,
        capability,
        currentRoute,
        defaultDesiredRoute: currentRoute === "routed" ? "routed" : "direct",
        metadata: {
          source: "config",
          homeName: home.name,
          homePath: home.homePath,
          configPath: home.configPath,
          baseUrlKey: provider.baseUrlKey,
          apiMode: provider.apiMode,
          keyEnvConfigured: Boolean(provider.keyEnv),
          routeMode: "custom_provider",
        },
      });
    }

    const primaryModel = asRecord(parsed.data.model);
    if (primaryModel) addHermesModelItem(items, home, providerMap, "model", primaryModel);

    const auxiliary = asRecord(parsed.data.auxiliary);
    if (auxiliary) {
      for (const [label, value] of Object.entries(auxiliary)) {
        const obj = typeof value === "string" ? { default: value } : asRecord(value);
        if (obj) addHermesModelItem(items, home, providerMap, `auxiliary.${label}`, obj);
      }
    }
  }

  const status: ConnectorRoutingSummary["status"] = items.length > 0 ? "ok" : "read-only";
  const detail = items.length > 0
    ? `Discovered ${items.length} Hermes config-backed routing item(s). Custom providers can be routed through LiteLLM; OAuth/session-bound rows remain read-only.`
    : "No Hermes config-backed custom providers found. Hermes inventory is populated from read-only watcher events.";
  return { status, detail, items, errors };
}

function toItem(row: DbRoutingRow): ConnectorRoutingItem {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata || "{}");
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    connector: row.connector,
    sourceId: row.source_id,
    itemType: row.item_type,
    providerId: row.provider_id,
    modelId: row.model_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    capability: row.capability,
    currentRoute: row.current_route,
    desiredRoute: row.desired_route,
    present: row.present === 1,
    fingerprint: row.fingerprint,
    metadata,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastChangedAt: row.last_changed_at,
    updatedAt: row.updated_at,
  };
}

function providerEntries(rawProviders: unknown): OpenClawProviderRef[] {
  if (!rawProviders) return [];
  if (Array.isArray(rawProviders)) {
    return rawProviders
      .map((value) => {
        if (!value || typeof value !== "object") return null;
        const obj = value as Record<string, unknown>;
        const id = String(obj.id || obj.name || "").trim();
        if (!id) return null;
        const baseUrlKey = typeof obj.baseUrl === "string" ? "baseUrl" : typeof obj.base_url === "string" ? "base_url" : null;
        const baseUrl = baseUrlKey ? String(obj[baseUrlKey] || "") : "";
        return { id, value: obj, baseUrlKey, baseUrl };
      })
      .filter((entry): entry is OpenClawProviderRef => Boolean(entry));
  }
  if (typeof rawProviders === "object") {
    return Object.entries(rawProviders as Record<string, unknown>)
      .map(([id, value]) => {
        if (!value || typeof value !== "object") return null;
        const obj = value as Record<string, unknown>;
        const baseUrlKey = typeof obj.baseUrl === "string" ? "baseUrl" : typeof obj.base_url === "string" ? "base_url" : null;
        const baseUrl = baseUrlKey ? String(obj[baseUrlKey] || "") : "";
        return { id, value: obj, baseUrlKey, baseUrl };
      })
      .filter((entry): entry is OpenClawProviderRef => Boolean(entry));
  }
  return [];
}

function modelEntries(provider: OpenClawProviderRef): Array<{ id: string; name: string; metadata: Record<string, unknown> }> {
  const raw = provider.value.models;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return { id: entry, name: entry, metadata: {} };
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id : typeof obj.model === "string" ? obj.model : "";
      if (!id) return null;
      const name = typeof obj.name === "string" && obj.name.trim() ? obj.name : id;
      return {
        id,
        name,
        metadata: {
          api: typeof obj.api === "string" ? obj.api : undefined,
          reasoning: typeof obj.reasoning === "boolean" ? obj.reasoning : undefined,
          contextWindow: typeof obj.contextWindow === "number" ? obj.contextWindow : undefined,
          input: Array.isArray(obj.input) ? obj.input : undefined,
        },
      };
    })
    .filter((entry): entry is { id: string; name: string; metadata: Record<string, unknown> } => Boolean(entry));
}

function discoverOpenClawItems(): { status: ConnectorRoutingSummary["status"]; detail: string; sourceId: string; items: DiscoveredRoutingItem[] } {
  const { configPath } = resolveOpenClawPaths();
  const cfg = readOpenClawConfig();
  if (!cfg || !configPath) {
    return { status: "missing", detail: "openclaw.json not found or unreadable", sourceId: "", items: [] };
  }
  const providers = providerEntries((cfg.models as { providers?: unknown } | undefined)?.providers);
  const items: DiscoveredRoutingItem[] = [];
  for (const provider of providers) {
    const currentRoute = classifyConnectorRoute(provider.baseUrl);
    const capability = providerCapability(provider.baseUrl);
    const defaultDesiredRoute: DesiredRoutingState = currentRoute === "routed" ? "routed" : "direct";
    const models = modelEntries(provider);
    items.push({
      connector: "openclaw",
      sourceId: "default",
      itemType: "provider",
      providerId: provider.id,
      modelId: "",
      displayName: provider.id,
      baseUrl: provider.baseUrl || null,
      capability,
      currentRoute,
      defaultDesiredRoute,
      metadata: {
        configPath,
        modelCount: models.length,
        baseUrlKey: provider.baseUrlKey,
        api: typeof provider.value.api === "string" ? provider.value.api : undefined,
      },
    });
    for (const model of models) {
      items.push({
        connector: "openclaw",
        sourceId: "default",
        itemType: "model",
        providerId: provider.id,
        modelId: model.id,
        displayName: model.name,
        baseUrl: provider.baseUrl || null,
        capability: capability === "provider-routing" ? "model-inventory" : capability,
        currentRoute,
        defaultDesiredRoute,
        metadata: {
          ...model.metadata,
          configPath,
          enforcedAt: "provider",
          note: "OpenClaw routes by provider endpoint; selecting a model routes its provider.",
        },
      });
    }
  }
  return { status: "ok", detail: `Discovered ${items.length} OpenClaw routing item(s)`, sourceId: "default", items };
}

function discoverHermesItems(): { status: ConnectorRoutingSummary["status"]; detail: string; sourceId: string; items: DiscoveredRoutingItem[] } {
  const configDiscovery = discoverHermesConfigItems();
  const rows = queryAll<{ source_id: string; model: string; count: number; last_seen: string | null }>(
    `SELECT source_id, model, COUNT(*) AS count, MAX(observed_at) AS last_seen
     FROM hermes_events
     WHERE model IS NOT NULL AND TRIM(model) != ''
     GROUP BY source_id, model
     ORDER BY last_seen DESC, model ASC`,
  );
  const items: DiscoveredRoutingItem[] = [...configDiscovery.items];
  const existing = new Set(items.map(uniqueKey));
  const providerSeen = new Map<string, { count: number; lastSeen: string | null }>();
  for (const row of rows) {
    const model = row.model.trim();
    const providerId = model.includes("/") ? model.split("/")[0] : "unknown";
    const sourceId = row.source_id || "default";
    const providerKey = `${sourceId}\u0000${providerId}`;
    const currentProvider = providerSeen.get(providerKey) || { count: 0, lastSeen: null };
    currentProvider.count += row.count || 0;
    currentProvider.lastSeen = row.last_seen || currentProvider.lastSeen;
    providerSeen.set(providerKey, currentProvider);

    const observedModel: DiscoveredRoutingItem = {
      connector: "hermes",
      sourceId,
      itemType: "model",
      providerId,
      modelId: model,
      displayName: model,
      baseUrl: null,
      capability: "read-only",
      currentRoute: "unknown",
      defaultDesiredRoute: "direct",
      metadata: {
        source: "watcher",
        observedMessages: row.count || 0,
        lastSeen: row.last_seen,
        enforcement: "retrospective",
        note: "Hermes watcher event is retrospective evidence. Route the matching config-backed custom provider if real-time scanning is needed.",
      },
    };
    if (!existing.has(uniqueKey(observedModel))) {
      items.push(observedModel);
      existing.add(uniqueKey(observedModel));
    }
  }
  for (const [key, value] of providerSeen.entries()) {
    const [sourceId, providerId] = key.split("\u0000");
    const observedProvider: DiscoveredRoutingItem = {
      connector: "hermes",
      sourceId,
      itemType: "provider",
      providerId,
      modelId: "",
      displayName: providerId,
      baseUrl: null,
      capability: "read-only",
      currentRoute: "unknown",
      defaultDesiredRoute: "direct",
      metadata: {
        source: "watcher",
        observedMessages: value.count,
        lastSeen: value.lastSeen,
        enforcement: "retrospective",
      },
    };
    if (!existing.has(uniqueKey(observedProvider))) {
      items.push(observedProvider);
      existing.add(uniqueKey(observedProvider));
    }
  }
  if (items.length === 0) {
    return {
      status: "read-only",
      detail: "No Hermes model traffic observed yet. Hermes inventory is populated from read-only watcher events.",
      sourceId: "default",
      items,
    };
  }
  const observedCount = items.length - configDiscovery.items.length;
  const errorSuffix = configDiscovery.errors.length > 0 ? ` Config warning: ${configDiscovery.errors.join("; ")}` : "";
  return {
    status: configDiscovery.status,
    detail: `${configDiscovery.detail}${observedCount > 0 ? ` Also discovered ${observedCount} read-only watcher item(s).` : ""}${errorSuffix}`,
    sourceId: "default",
    items,
  };
}

function existingRows(connector: ConnectorId): ConnectorRoutingItem[] {
  return queryAll<DbRoutingRow>(
    "SELECT * FROM connector_routing_items WHERE connector = ? ORDER BY item_type ASC, provider_id ASC, model_id ASC",
    [connector],
  ).map(toItem);
}

function persistDiscovery(
  connector: ConnectorId,
  discovery: { status: ConnectorRoutingSummary["status"]; detail: string; sourceId: string; items: DiscoveredRoutingItem[] },
): ConnectorRoutingSummary {
  const now = nowIso();
  const before = existingRows(connector);
  const beforeByKey = new Map(before.map((item) => [uniqueKey(item), item]));
  const discoveredKeys = new Set(discovery.items.map(uniqueKey));
  const hadPreviousInventory = before.length > 0;
  let newCount = 0;
  let changedCount = 0;
  let removedCount = 0;

  transaction(() => {
    for (const item of discovery.items) {
      const key = uniqueKey(item);
      const previous = beforeByKey.get(key);
      const fingerprint = stableHash({
        displayName: item.displayName,
        baseUrl: item.baseUrl,
        capability: item.capability,
        currentRoute: item.currentRoute,
        metadata: item.metadata,
      });
      const id = previous?.id || itemId(item.connector, item.sourceId, item.itemType, item.providerId, item.modelId);
      const desired = previous?.desiredRoute || item.defaultDesiredRoute;
      const isNew = !previous;
      const isChanged = Boolean(previous && previous.fingerprint !== fingerprint);
      if (hadPreviousInventory && isNew) newCount += 1;
      if (isChanged) changedCount += 1;
      run(
        `INSERT INTO connector_routing_items (
          id, connector, source_id, item_type, provider_id, model_id,
          display_name, base_url, capability, current_route, desired_route,
          present, fingerprint, metadata, first_seen_at, last_seen_at,
          last_changed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connector, source_id, item_type, provider_id, model_id) DO UPDATE SET
          display_name = excluded.display_name,
          base_url = excluded.base_url,
          capability = excluded.capability,
          current_route = excluded.current_route,
          present = 1,
          fingerprint = excluded.fingerprint,
          metadata = excluded.metadata,
          last_seen_at = excluded.last_seen_at,
          last_changed_at = CASE
            WHEN connector_routing_items.fingerprint != excluded.fingerprint THEN excluded.last_changed_at
            ELSE connector_routing_items.last_changed_at
          END,
          updated_at = excluded.updated_at`,
        [
          id,
          item.connector,
          item.sourceId,
          item.itemType,
          item.providerId,
          item.modelId,
          item.displayName,
          item.baseUrl,
          item.capability,
          item.currentRoute,
          desired,
          fingerprint,
          JSON.stringify(item.metadata),
          previous?.firstSeenAt || now,
          now,
          isNew || isChanged ? now : previous?.lastChangedAt || null,
          now,
        ],
      );
    }

    for (const previous of before) {
      if (!previous.present) continue;
      if (discoveredKeys.has(uniqueKey(previous))) continue;
      removedCount += 1;
      run(
        `UPDATE connector_routing_items
         SET present = 0, last_changed_at = ?, updated_at = ?
         WHERE id = ?`,
        [now, now, previous.id],
      );
    }
  });

  const after = existingRows(connector);
  const changedAt = new Set<string>();
  for (const item of after) {
    const prev = beforeByKey.get(uniqueKey(item));
    if (!prev && hadPreviousInventory) changedAt.add(item.id);
    else if (prev && prev.fingerprint !== item.fingerprint) changedAt.add(item.id);
    if (!item.present && prev?.present) changedAt.add(item.id);
  }
  const selected = after.filter((item) =>
    item.present &&
    item.desiredRoute === "routed" &&
    item.capability !== "read-only" &&
    item.capability !== "unsupported" &&
    !isProxyBridgeProvider(item.connector, item.providerId)
  ).length;
  return {
    connector,
    sourceId: discovery.sourceId || "default",
    status: discovery.status,
    detail: discovery.detail,
    items: after.map((item) => ({
      ...item,
      isNew: Boolean(!beforeByKey.get(uniqueKey(item)) && hadPreviousInventory),
      isChanged: changedAt.has(item.id) && item.present,
      isRemoved: !item.present,
    })),
    drift: {
      new: newCount,
      removed: removedCount,
      changed: changedCount,
      total: newCount + removedCount + changedCount,
    },
    selected,
    scannedAt: now,
  };
}

export function syncConnectorRoutingInventory(): ConnectorRoutingResponse {
  const openclaw = persistDiscovery("openclaw", discoverOpenClawItems());
  const hermes = persistDiscovery("hermes", discoverHermesItems());
  const scannedAt = nowIso();
  return {
    litellmTarget: litellmTarget(),
    openclaw,
    hermes,
    driftTotal: openclaw.drift.total + hermes.drift.total,
    scannedAt,
  };
}

export function setConnectorRoutingSelections(connector: ConnectorId, itemIds: string[], desiredRoute: DesiredRoutingState): ConnectorRoutingSummary {
  const now = nowIso();
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) {
    return persistDiscovery(connector, connector === "openclaw" ? discoverOpenClawItems() : discoverHermesItems());
  }
  const placeholders = ids.map(() => "?").join(",");
  const rows = queryAll<{ id: string; provider_id: string; capability: RoutingCapability }>(
    `SELECT id, provider_id, capability FROM connector_routing_items
     WHERE connector = ? AND present = 1 AND id IN (${placeholders})`,
    [connector, ...ids],
  );
  if (rows.length !== ids.length) {
    throw new Error("One or more routing items were not found in the current inventory");
  }
  const unsupported = rows.find((row) => row.capability === "unsupported" || row.capability === "read-only");
  if (desiredRoute === "routed" && unsupported) {
    throw new Error("One or more selected items cannot be routed by ClawNex");
  }
  const proxyBridge = rows.find((row) => isProxyBridgeProvider(connector, row.provider_id));
  if (proxyBridge) {
    throw new Error("The local ClawNex LiteLLM proxy bridge is not a selectable upstream provider");
  }
  run(
    `UPDATE connector_routing_items
     SET desired_route = ?, updated_at = ?
     WHERE connector = ? AND id IN (${placeholders})`,
    [desiredRoute, now, connector, ...ids],
  );
  return persistDiscovery(connector, connector === "openclaw" ? discoverOpenClawItems() : discoverHermesItems());
}

export function setAllConnectorRoutingSelections(connector: ConnectorId, desiredRoute: DesiredRoutingState): ConnectorRoutingSummary {
  const now = nowIso();
  const excludedProvider = connector === "openclaw" ? "litellm" : HERMES_LITELLM_PROVIDER_NAME;
  run(
    `UPDATE connector_routing_items
     SET desired_route = ?, updated_at = ?
     WHERE connector = ? AND present = 1
       AND capability IN ('provider-routing','model-inventory')
       AND provider_id != ?`,
    [desiredRoute, now, connector, excludedProvider],
  );
  return persistDiscovery(connector, connector === "openclaw" ? discoverOpenClawItems() : discoverHermesItems());
}

function readSelectiveSidecar(): SelectiveRoutingSidecar | null {
  try {
    if (!fs.existsSync(SELECTIVE_SIDECAR_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(SELECTIVE_SIDECAR_PATH, "utf8"));
    if (raw?.version === SELECTIVE_SIDECAR_VERSION && Array.isArray(raw.providers)) return raw as SelectiveRoutingSidecar;
  } catch {}
  return null;
}

function writeSelectiveSidecar(sidecar: SelectiveRoutingSidecar | null): void {
  if (!sidecar || sidecar.providers.length === 0) {
    try { fs.unlinkSync(SELECTIVE_SIDECAR_PATH); } catch {}
    return;
  }
  const tmp = `${SELECTIVE_SIDECAR_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(sidecar, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, SELECTIVE_SIDECAR_PATH);
}

function readHermesSidecar(): HermesRoutingSidecar | null {
  try {
    if (!fs.existsSync(HERMES_SIDECAR_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(HERMES_SIDECAR_PATH, "utf8"));
    if (raw?.version === HERMES_SIDECAR_VERSION && Array.isArray(raw.providers)) return raw as HermesRoutingSidecar;
  } catch {}
  return null;
}

function writeHermesSidecar(sidecar: HermesRoutingSidecar | null): void {
  if (!sidecar || sidecar.providers.length === 0) {
    try { fs.unlinkSync(HERMES_SIDECAR_PATH); } catch {}
    return;
  }
  const tmp = `${HERMES_SIDECAR_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(sidecar, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, HERMES_SIDECAR_PATH);
}

function atomicWriteOpenClawConfig(configPath: string, data: unknown): void {
  const tmp = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

function atomicWriteHermesConfig(configPath: string, doc: YAML.Document.Parsed): void {
  const tmp = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, doc.toString(), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

function sidecarKey(configPath: string, providerId: string): string {
  return `${normalizePathKey(configPath)}\u0000${providerId}`;
}

function getYamlString(map: unknown, key: string): string | null {
  if (!YAML.isMap(map)) return null;
  const value = map.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function setYamlString(map: unknown, key: string, value: string): void {
  if (YAML.isMap(map)) map.set(key, value);
}

function deleteYamlKey(map: unknown, key: string): void {
  if (YAML.isMap(map)) map.delete(key);
}

function hermesProviderMaps(doc: YAML.Document.Parsed): Array<{ providerId: string; map: unknown; baseUrlKey: "base_url" | "baseUrl" }> {
  const seq = doc.get("custom_providers", true);
  if (!YAML.isSeq(seq)) return [];
  const providers: Array<{ providerId: string; map: unknown; baseUrlKey: "base_url" | "baseUrl" }> = [];
  for (const item of seq.items) {
    if (!YAML.isMap(item)) continue;
    const providerId = getYamlString(item, "name");
    if (!providerId) continue;
    const baseUrlKey: "base_url" | "baseUrl" = getYamlString(item, "base_url") !== null ? "base_url" : "baseUrl";
    providers.push({ providerId, map: item, baseUrlKey });
  }
  return providers;
}

export interface ApplyOpenClawRoutingResult {
  ok: boolean;
  status: "applied" | "noop" | "missing" | "error";
  detail: string;
  restartRequired: boolean;
  routedProviders: string[];
  restoredProviders: string[];
  skippedProviders: Array<{ providerId: string; reason: string }>;
  sidecarPath: string;
}

export function applyOpenClawDesiredRouting(): ApplyOpenClawRoutingResult {
  const { configPath } = resolveOpenClawPaths();
  const cfg = readOpenClawConfig();
  if (!cfg || !configPath) {
    return {
      ok: false,
      status: "missing",
      detail: "openclaw.json not found or unreadable",
      restartRequired: false,
      routedProviders: [],
      restoredProviders: [],
      skippedProviders: [],
      sidecarPath: SELECTIVE_SIDECAR_PATH,
    };
  }

  const selectedRows = queryAll<{ provider_id: string }>(
    `SELECT DISTINCT provider_id
     FROM connector_routing_items
     WHERE connector = 'openclaw'
       AND present = 1
       AND desired_route = 'routed'
       AND provider_id != ''
       AND capability IN ('provider-routing','model-inventory')`,
  );
  const selectedProviders = new Set(selectedRows.map((row) => row.provider_id).filter(Boolean));
  selectedProviders.delete("litellm");

  const providersContainer = (cfg.models as { providers?: unknown } | undefined)?.providers;
  const providers = providerEntries(providersContainer);
  const target = litellmTarget();
  const sidecar = readSelectiveSidecar() || {
    version: 1 as const,
    managedAt: nowIso(),
    clawnexVersion: CLAWNEX_VERSION,
    openclawVersion: (cfg.meta as { lastTouchedVersion?: string } | undefined)?.lastTouchedVersion ?? null,
    providers: [],
  };
  const records = new Map(sidecar.providers.map((record) => [record.providerId, record]));

  const routedProviders: string[] = [];
  const restoredProviders: string[] = [];
  const skippedProviders: Array<{ providerId: string; reason: string }> = [];
  let changed = false;

  for (const provider of providers) {
    if (provider.id === "litellm") continue;
    if (!provider.baseUrlKey) {
      if (selectedProviders.has(provider.id)) skippedProviders.push({ providerId: provider.id, reason: "provider has no baseUrl/base_url" });
      continue;
    }
    const route = classifyConnectorRoute(provider.baseUrl);
    const capability = providerCapability(provider.baseUrl);
    const wantsRouted = selectedProviders.has(provider.id);

    if (wantsRouted) {
      if (capability !== "provider-routing" && route !== "routed") {
        skippedProviders.push({ providerId: provider.id, reason: "provider endpoint is not HTTP-compatible" });
        continue;
      }
      if (provider.baseUrl !== target) {
        if (!records.has(provider.id)) {
          records.set(provider.id, {
            providerId: provider.id,
            baseUrlKey: provider.baseUrlKey,
            originalBaseUrl: provider.baseUrl,
            routedBaseUrl: target,
            valueSha256: stableHash({ [provider.baseUrlKey]: target }),
            routedAt: nowIso(),
          });
        }
        provider.value[provider.baseUrlKey] = target;
        changed = true;
        routedProviders.push(provider.id);
      }
      continue;
    }

    const record = records.get(provider.id);
    if (record && provider.baseUrlKey && provider.baseUrl === record.routedBaseUrl) {
      provider.value[provider.baseUrlKey] = record.originalBaseUrl;
      records.delete(provider.id);
      changed = true;
      restoredProviders.push(provider.id);
    }
  }

  if (!changed) {
    return {
      ok: true,
      status: "noop",
      detail: "OpenClaw routing already matches the selected provider set.",
      restartRequired: false,
      routedProviders,
      restoredProviders,
      skippedProviders,
      sidecarPath: SELECTIVE_SIDECAR_PATH,
    };
  }

  if (cfg.meta && typeof cfg.meta === "object") {
    (cfg.meta as Record<string, unknown>).lastTouchedAt = nowIso();
  }
  atomicWriteOpenClawConfig(configPath, cfg);
  writeSelectiveSidecar({
    ...sidecar,
    managedAt: nowIso(),
    clawnexVersion: CLAWNEX_VERSION,
    openclawVersion: (cfg.meta as { lastTouchedVersion?: string } | undefined)?.lastTouchedVersion ?? sidecar.openclawVersion,
    providers: [...records.values()],
  });

  syncConnectorRoutingInventory();

  return {
    ok: true,
    status: "applied",
    detail: `Applied selected OpenClaw routing. Routed ${routedProviders.length}; restored ${restoredProviders.length}.`,
    restartRequired: true,
    routedProviders,
    restoredProviders,
    skippedProviders,
    sidecarPath: SELECTIVE_SIDECAR_PATH,
  };
}

export interface ApplyHermesRoutingResult {
  ok: boolean;
  status: "applied" | "noop" | "missing" | "error";
  detail: string;
  restartRequired: boolean;
  routedProviders: string[];
  restoredProviders: string[];
  skippedProviders: Array<{ providerId: string; reason: string }>;
  sidecarPath: string;
}

export interface RevertHermesRoutingResult {
  ok: boolean;
  status: "reverted" | "noop" | "error";
  detail: string;
  restartRequired: boolean;
  restoredProviders: string[];
  skippedProviders: Array<{ providerId: string; reason: string }>;
  sidecarPath: string;
}

export function applyHermesDesiredRouting(): ApplyHermesRoutingResult {
  const selectedRows = queryAll<{ provider_id: string; metadata: string }>(
    `SELECT DISTINCT provider_id, metadata
     FROM connector_routing_items
     WHERE connector = 'hermes'
       AND present = 1
       AND desired_route = 'routed'
       AND provider_id != ''
       AND capability IN ('provider-routing','model-inventory')`,
  );

  const selectedByConfig = new Map<string, Set<string>>();
  for (const row of selectedRows) {
    if (row.provider_id === HERMES_LITELLM_PROVIDER_NAME) continue;
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata || "{}");
    } catch {
      metadata = {};
    }
    const configPath = stringValue(metadata.configPath);
    if (!configPath) continue;
    const resolvedConfig = normalizePathKey(configPath);
    const providers = selectedByConfig.get(resolvedConfig) || new Set<string>();
    providers.add(row.provider_id);
    selectedByConfig.set(resolvedConfig, providers);
  }

  const homes = knownHermesHomes().filter((home) => fs.existsSync(home.configPath));
  if (homes.length === 0) {
    return {
      ok: false,
      status: "missing",
      detail: "No Hermes config.yaml found for the default or saved Hermes homes.",
      restartRequired: false,
      routedProviders: [],
      restoredProviders: [],
      skippedProviders: [],
      sidecarPath: HERMES_SIDECAR_PATH,
    };
  }

  const target = litellmTarget();
  const sidecar = readHermesSidecar() || {
    version: 1 as const,
    managedAt: nowIso(),
    clawnexVersion: CLAWNEX_VERSION,
    providers: [],
  };
  const records = new Map(sidecar.providers.map((record) => [sidecarKey(record.configPath, record.providerId), record]));
  const routedProviders: string[] = [];
  const restoredProviders: string[] = [];
  const skippedProviders: Array<{ providerId: string; reason: string }> = [];
  let changed = false;

  for (const home of homes) {
    const parsed = parseHermesConfig(home.configPath);
    if (!parsed.ok) {
      skippedProviders.push({ providerId: home.name, reason: `cannot read ${home.configPath}: ${parsed.error}` });
      continue;
    }

    const selectedProviders = selectedByConfig.get(normalizePathKey(home.configPath)) || new Set<string>();
    const providerMaps = hermesProviderMaps(parsed.doc);
    let homeChanged = false;

    for (const provider of providerMaps) {
      if (provider.providerId === HERMES_LITELLM_PROVIDER_NAME) continue;
      const key = sidecarKey(home.configPath, provider.providerId);
      const record = records.get(key);
      const currentBaseUrl = getYamlString(provider.map, provider.baseUrlKey);
      const currentKeyEnv = getYamlString(provider.map, "key_env") || getYamlString(provider.map, "keyEnv");
      const currentApiMode = getYamlString(provider.map, "api_mode") || getYamlString(provider.map, "apiMode");
      const wantsRouted = selectedProviders.has(provider.providerId);

      if (wantsRouted) {
        const currentCapability = providerCapability(currentBaseUrl);
        const currentRoute = classifyConnectorRoute(currentBaseUrl);
        if (currentCapability !== "provider-routing" && currentRoute !== "routed") {
          skippedProviders.push({ providerId: provider.providerId, reason: "Hermes custom provider endpoint is not HTTP-compatible" });
          continue;
        }
        if (!records.has(key) && (currentBaseUrl !== target || currentKeyEnv !== HERMES_LITELLM_KEY_ENV || !currentApiMode)) {
          records.set(key, {
            homePath: home.homePath,
            configPath: home.configPath,
            providerId: provider.providerId,
            originalBaseUrl: currentBaseUrl,
            hadBaseUrl: currentBaseUrl !== null,
            baseUrlKey: provider.baseUrlKey,
            originalKeyEnv: currentKeyEnv,
            hadKeyEnv: currentKeyEnv !== null,
            originalApiMode: currentApiMode,
            hadApiMode: currentApiMode !== null,
            routedBaseUrl: target,
            routedAt: nowIso(),
          });
        }
        if (currentBaseUrl !== target) {
          setYamlString(provider.map, provider.baseUrlKey, target);
          homeChanged = true;
          changed = true;
        }
        if (currentKeyEnv !== HERMES_LITELLM_KEY_ENV) {
          setYamlString(provider.map, "key_env", HERMES_LITELLM_KEY_ENV);
          deleteYamlKey(provider.map, "keyEnv");
          homeChanged = true;
          changed = true;
        }
        if (!currentApiMode) {
          setYamlString(provider.map, "api_mode", "chat_completions");
          homeChanged = true;
          changed = true;
        }
        if (!routedProviders.includes(provider.providerId)) routedProviders.push(provider.providerId);
        continue;
      }

      if (record) {
        if (currentBaseUrl !== record.routedBaseUrl) {
          skippedProviders.push({ providerId: provider.providerId, reason: "provider changed after ClawNex routed it; preserving operator edit" });
          continue;
        }
        if (record.hadBaseUrl && record.originalBaseUrl !== null) setYamlString(provider.map, record.baseUrlKey, record.originalBaseUrl);
        else deleteYamlKey(provider.map, record.baseUrlKey);

        if (record.hadKeyEnv && record.originalKeyEnv !== null) setYamlString(provider.map, "key_env", record.originalKeyEnv);
        else deleteYamlKey(provider.map, "key_env");
        deleteYamlKey(provider.map, "keyEnv");

        if (record.hadApiMode && record.originalApiMode !== null) setYamlString(provider.map, "api_mode", record.originalApiMode);
        else deleteYamlKey(provider.map, "api_mode");
        deleteYamlKey(provider.map, "apiMode");

        records.delete(key);
        homeChanged = true;
        changed = true;
        restoredProviders.push(provider.providerId);
      }
    }

    if (homeChanged) atomicWriteHermesConfig(home.configPath, parsed.doc);
  }

  if (!changed) {
    return {
      ok: true,
      status: "noop",
      detail: "Hermes routing already matches the selected custom-provider set.",
      restartRequired: false,
      routedProviders,
      restoredProviders,
      skippedProviders,
      sidecarPath: HERMES_SIDECAR_PATH,
    };
  }

  writeHermesSidecar({
    ...sidecar,
    managedAt: nowIso(),
    clawnexVersion: CLAWNEX_VERSION,
    providers: [...records.values()],
  });

  syncConnectorRoutingInventory();

  return {
    ok: true,
    status: "applied",
    detail: `Applied selected Hermes routing. Routed ${routedProviders.length}; restored ${restoredProviders.length}.`,
    restartRequired: true,
    routedProviders,
    restoredProviders,
    skippedProviders,
    sidecarPath: HERMES_SIDECAR_PATH,
  };
}

export function revertHermesRouting(): RevertHermesRoutingResult {
  const sidecar = readHermesSidecar();
  if (!sidecar || sidecar.providers.length === 0) {
    run(
      `UPDATE connector_routing_items
       SET desired_route = 'direct', updated_at = ?
       WHERE connector = 'hermes'`,
      [nowIso()],
    );
    syncConnectorRoutingInventory();
    return {
      ok: true,
      status: "noop",
      detail: "No ClawNex-managed Hermes wire sidecar exists.",
      restartRequired: false,
      restoredProviders: [],
      skippedProviders: [],
      sidecarPath: HERMES_SIDECAR_PATH,
    };
  }

  const restoredProviders: string[] = [];
  const skippedProviders: Array<{ providerId: string; reason: string }> = [];
  const remainingRecords: HermesProviderRecord[] = [];
  const recordsByConfig = new Map<string, HermesProviderRecord[]>();
  for (const record of sidecar.providers) {
    const configPath = normalizePathKey(record.configPath);
    const records = recordsByConfig.get(configPath) || [];
    records.push(record);
    recordsByConfig.set(configPath, records);
  }

  let changed = false;
  for (const [configPath, records] of recordsByConfig.entries()) {
    const parsed = parseHermesConfig(configPath);
    if (!parsed.ok) {
      for (const record of records) {
        remainingRecords.push(record);
        skippedProviders.push({ providerId: record.providerId, reason: `cannot read ${configPath}: ${parsed.error}` });
      }
      continue;
    }

    const providerMaps = new Map(hermesProviderMaps(parsed.doc).map((provider) => [provider.providerId, provider]));
    let homeChanged = false;

    for (const record of records) {
      const provider = providerMaps.get(record.providerId);
      if (!provider) {
        skippedProviders.push({ providerId: record.providerId, reason: "provider no longer exists; removed ClawNex tracking" });
        changed = true;
        continue;
      }

      const currentBaseUrl = getYamlString(provider.map, provider.baseUrlKey);
      if (currentBaseUrl !== record.routedBaseUrl) {
        remainingRecords.push(record);
        skippedProviders.push({ providerId: record.providerId, reason: "provider changed after ClawNex routed it; preserving operator edit" });
        continue;
      }

      if (record.hadBaseUrl && record.originalBaseUrl !== null) setYamlString(provider.map, record.baseUrlKey, record.originalBaseUrl);
      else deleteYamlKey(provider.map, record.baseUrlKey);

      if (record.hadKeyEnv && record.originalKeyEnv !== null) setYamlString(provider.map, "key_env", record.originalKeyEnv);
      else deleteYamlKey(provider.map, "key_env");
      deleteYamlKey(provider.map, "keyEnv");

      if (record.hadApiMode && record.originalApiMode !== null) setYamlString(provider.map, "api_mode", record.originalApiMode);
      else deleteYamlKey(provider.map, "api_mode");
      deleteYamlKey(provider.map, "apiMode");

      homeChanged = true;
      changed = true;
      restoredProviders.push(record.providerId);
    }

    if (homeChanged) atomicWriteHermesConfig(configPath, parsed.doc);
  }

  writeHermesSidecar({
    ...sidecar,
    managedAt: nowIso(),
    clawnexVersion: CLAWNEX_VERSION,
    providers: remainingRecords,
  });
  run(
    `UPDATE connector_routing_items
     SET desired_route = 'direct', updated_at = ?
     WHERE connector = 'hermes'`,
    [nowIso()],
  );
  syncConnectorRoutingInventory();

  if (!changed && remainingRecords.length > 0) {
    return {
      ok: true,
      status: "noop",
      detail: `No Hermes providers were reverted. ${skippedProviders.length} provider(s) were preserved because ClawNex could not safely restore them.`,
      restartRequired: false,
      restoredProviders,
      skippedProviders,
      sidecarPath: HERMES_SIDECAR_PATH,
    };
  }

  return {
    ok: true,
    status: "reverted",
    detail: `Reverted ClawNex-managed Hermes wire for ${restoredProviders.length} provider(s).`,
    restartRequired: restoredProviders.length > 0,
    restoredProviders,
    skippedProviders,
    sidecarPath: HERMES_SIDECAR_PATH,
  };
}

export function getConnectorRoutingDriftSnapshot(): { total: number; openclaw: number; hermes: number; lastChecked: string | null } {
  const rows = queryAll<{ connector: ConnectorId; count: number }>(
    `SELECT connector, COUNT(*) AS count
     FROM connector_routing_items
     WHERE last_changed_at IS NOT NULL
       AND updated_at >= datetime('now','-24 hours')
     GROUP BY connector`,
  );
  const openclaw = rows.find((row) => row.connector === "openclaw")?.count || 0;
  const hermes = rows.find((row) => row.connector === "hermes")?.count || 0;
  const last = queryOne<{ ts: string }>("SELECT MAX(updated_at) AS ts FROM connector_routing_items");
  return { total: openclaw + hermes, openclaw, hermes, lastChecked: last?.ts || null };
}
