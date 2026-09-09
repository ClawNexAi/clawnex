/**
 * Connector routing inventory
 *
 * Tracks what OpenClaw and Hermes model/provider routes exist, what the
 * operator wants routed, and what changed since the previous scan.
 *
 * OpenClaw is enforceable at provider level by changing the provider base URL
 * to the local LiteLLM proxy. Hermes is enforceable for HTTP-compatible
 * custom_providers and the top-level primary model; OAuth/session-bound or
 * watcher-only Hermes rows remain read-only.
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
import { recordRoutingSnapshot, listUnresolvedRoutingEvents, recordRoutingOperation } from "@/lib/services/routing-reconciliation";
import { findHermesModelCredential, type HermesCredentialPreview } from "@/lib/services/hermes-routing-credentials";
import { addModel, addProvider, getProvider, listModels, updateProvider } from "@/lib/services/config-service";
import { syncProvidersToYaml } from "@/lib/litellm/sync";
import { resolveLiteLLMConfigPath } from '@/lib/litellm/paths';
import { getDb } from "@/lib/db/index";
import { commitRoutingFile, publishRoutingFile, removeRoutingJournal, withRoutingOperationLock } from './routing-file-transaction';
import { ROUTING_IDENTITY_HEADER, prepareIdentityHeader, identityHeaderMatches, routingIdentityHash, type RoutingIdentityOwnership } from './routing-identity';
import { sealRoutingCredential, openRoutingCredential, type EncryptedRoutingCredential } from './routing-credential-recovery';
import { discoverOpenCodeItems, openCodeRoutingOwnershipFingerprint, OPENCODE_SIDECAR_PATH } from './opencode-routing';
import { resolveConfiguredProxyModel } from './configured-proxy-model';

export { resolveConfiguredProxyModel } from './configured-proxy-model';

export type ConnectorId = "openclaw" | "hermes" | "opencode";
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
  /** Number of writable rows whose desired route differs from the live route. */
  pendingChanges: number;
  scannedAt: string;
}

export interface ConnectorRoutingResponse {
  litellmTarget: string;
  openclaw: ConnectorRoutingSummary;
  hermes: ConnectorRoutingSummary;
  opencode: ConnectorRoutingSummary;
  driftTotal: number;
  scannedAt: string;
  reconciliation: {
    events: ReturnType<typeof listUnresolvedRoutingEvents>;
    lastSnapshotIds: Partial<Record<ConnectorId, string>>;
  };
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

export interface DiscoveredRoutingItem {
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
const SELECTIVE_SIDECAR_VERSION = 3;
const HERMES_SIDECAR_PATH = process.env.CLAWNEX_HERMES_ROUTING_SIDECAR
  || path.join(os.homedir(), ".clawnex-hermes-routing-managed.json");
const HERMES_SIDECAR_VERSION = 1;
const HERMES_LITELLM_PROVIDER_NAME = "clawnex-litellm";
const HERMES_LITELLM_KEY_ENV = "LITELLM_MASTER_KEY";

interface SelectiveProviderRecord extends RoutingIdentityOwnership {
  providerId: string;
  baseUrlKey: "baseUrl" | "base_url";
  originalBaseUrl: string;
  routedBaseUrl: string;
  valueSha256: string;
  routedAt: string;
  apiKeyKey?: 'apiKey' | 'api_key';
  hadApiKey?: boolean;
  originalApiKey?: unknown;
  encryptedOriginalApiKey?: EncryptedRoutingCredential;
  routedApiKeySha256?: string;
}

interface SelectiveRoutingSidecar {
  version: 1 | 2 | 3;
  managedAt: string;
  clawnexVersion: string;
  openclawVersion: string | null;
  providers: SelectiveProviderRecord[];
}

interface HermesProviderRecord extends RoutingIdentityOwnership {
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
  scope?: "custom-provider" | "primary-model";
  originalProvider?: string | null;
  createdProxyProvider?: boolean;
  keyEnvKey?: 'key_env' | 'keyEnv';
  apiModeKey?: 'api_mode' | 'apiMode';
  primaryModelId?: string;
  primaryModelKey?: 'default' | 'model';
  routedModelId?: string;
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
  profileName: string;
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
    if (parsed.protocol === 'http:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
      (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") && port === litellmPort && parsed.pathname.replace(/\/$/, '') === '/v1') {
      return "routed";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "unsupported";
    return "direct";
  } catch {
    return "unknown";
  }
}

function providerCapability(baseUrl: string | null, protocol?: unknown): RoutingCapability {
  if (!baseUrl) return "unsupported";
  if (protocol != null && protocol !== '' && !['openai-completions', 'chat_completions'].includes(String(protocol))) return 'unsupported';
  try {
    const parsed = new URL(baseUrl);
    // Secret-bearing endpoints cannot be safely stored in a recovery journal.
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return 'unsupported';
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

function discoverConnectorItems(connector: ConnectorId): {
  status: ConnectorRoutingSummary['status']; detail: string; sourceId: string; items: DiscoveredRoutingItem[];
} {
  if (connector === 'openclaw') return discoverOpenClawItems();
  if (connector === 'hermes') return discoverHermesItems();
  return discoverOpenCodeItems();
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
  return `hermes:home:${stableHash(resolved).slice(0, 12)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function identityMetadata(headers: unknown, ownership?: RoutingIdentityOwnership): Record<string, unknown> {
  const values = asRecord(headers) || {};
  const key = Object.keys(values).find(name => name.toLowerCase() === ROUTING_IDENTITY_HEADER);
  const value = key ? values[key] : null;
  return { identityHash: ownership?.identityHash || null,
    identityFingerprint: typeof value === 'string' ? routingIdentityHash(value) : null,
    identityIntact: ownership?.identityHash ? identityHeaderMatches(values, ownership) : null };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inferProviderFromModel(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[0] : "unknown";
}

/**
 * Hermes watcher rows may contain either provider/model or a provider prefix
 * followed by a provider-qualified model id. Keep only the first segment as
 * the provider so `openrouter/deepseek/deepseek-v4-flash-0731` becomes the
 * same provider/model pair as the active Hermes config.
 */
export function splitObservedHermesModel(value: string): { providerId: string; modelId: string } {
  const model = value.trim();
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    return { providerId: "unknown", modelId: model };
  }
  return { providerId: model.slice(0, separator), modelId: model.slice(separator + 1) };
}

function knownHermesHomes(): HermesHomeRef[] {
  const byPath = new Map<string, HermesHomeRef>();
  const addHome = (homePath: string, name: string, profileName = "default") => {
    const resolved = normalizePathKey(homePath);
    if (byPath.has(resolved)) return;
    byPath.set(resolved, {
      sourceId: hermesSourceId(resolved),
      homePath: resolved,
      configPath: path.join(resolved, "config.yaml"),
      name,
      profileName,
    });
  };

  const defaultHome = normalizePathKey(config.hermes.home);
  addHome(defaultHome, "Hermes default", "default");

  // Hermes profiles are independent config.yaml files. Treat them as
  // independent routing sources so a profile change cannot disappear behind
  // the default agent's inventory.
  const profilesDir = path.join(defaultHome, "profiles");
  try {
    for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const profileHome = path.join(profilesDir, entry.name);
      if (fs.existsSync(path.join(profileHome, "config.yaml"))) {
        addHome(profileHome, `Hermes profile: ${entry.name}`, entry.name);
      }
    }
  } catch {
    // A missing or unreadable profiles directory is not an inventory failure;
    // the default Hermes config may still be fully usable.
  }

  const rows = queryAll<{ name: string; home_path: string; is_active: number }>(
    "SELECT name, home_path, is_active FROM hermes_instances WHERE is_active = 1 ORDER BY created_at ASC",
  );
  for (const row of rows) {
    if (row.home_path) addHome(row.home_path, row.name || "Hermes instance", row.name || "instance");
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
  primaryModel = false,
): void {
  const configuredModelId = stringValue(modelObj.default)
    || stringValue(modelObj.model)
    || stringValue(modelObj.id)
    || stringValue(modelObj.name);
  if (!configuredModelId) return;
  const configuredProviderId = stringValue(modelObj.provider) || inferProviderFromModel(configuredModelId);
  // Routing a primary model changes its active Hermes provider to the local
  // proxy. Keep the original upstream provider in the inventory identity so
  // the model does not appear to vanish or become a mysterious proxy model.
  const managedPrimary = primaryModel && configuredProviderId === HERMES_LITELLM_PROVIDER_NAME
    ? readHermesSidecar()?.providers.find((record) => normalizePathKey(record.configPath) === normalizePathKey(home.configPath) && record.scope === "primary-model")
    : undefined;
  const modelId = managedPrimary?.primaryModelId || configuredModelId;
  const providerId = managedPrimary?.originalProvider || configuredProviderId;
  const customProvider = providerMap.get(providerId);
  const identityOwner = managedPrimary || readHermesSidecar()?.providers.find(record => normalizePathKey(record.configPath) === normalizePathKey(home.configPath) && record.providerId === providerId);
  const identityProvider = managedPrimary ? providerMap.get(HERMES_LITELLM_PROVIDER_NAME) : customProvider;
  const inlineBaseUrl = stringValue(modelObj.base_url) || stringValue(modelObj.baseUrl);
  // Once ClawNex wires a primary model, Hermes stores the effective proxy
  // endpoint on the model block while the named provider retains its upstream
  // definition. Prefer that model-level endpoint for the model's live status.
  const baseUrl = primaryModel && inlineBaseUrl ? inlineBaseUrl : customProvider?.baseUrl || inlineBaseUrl;
  const currentRoute = classifyConnectorRoute(baseUrl);
  const providerRouteCap = customProvider ? providerCapability(customProvider.baseUrl, customProvider.apiMode) : providerCapability(baseUrl, modelObj.api_mode || modelObj.apiMode);
  const capability: RoutingCapability = primaryModel && providerRouteCap === "provider-routing"
    ? "model-inventory"
    : customProvider && customProvider.name !== HERMES_LITELLM_PROVIDER_NAME
      ? providerRouteCap === "provider-routing" ? "model-inventory" : providerRouteCap
      : "read-only";
  const defaultDesiredRoute: DesiredRoutingState = currentRoute === "routed" ? "routed" : "direct";
  let credential: HermesCredentialPreview = {
    source: "missing", available: false, envName: null, masked: null, last4: null,
    detail: "No readable API key or environment reference was found for this Hermes model.",
  };
  try {
    credential = findHermesModelCredential({
      configPath: home.configPath,
      providerId,
      primaryModel,
    }).preview;
  } catch {
    credential = { ...credential, detail: "ClawNex could not inspect the Hermes credential source." };
  }

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
        profileName: home.profileName,
        homePath: home.homePath,
        configPath: home.configPath,
        ...identityMetadata(identityProvider?.raw.extra_headers, identityOwner),
      routeMode: customProvider ? "custom_provider" : "observed_or_builtin",
      enforcedAt: primaryModel ? "primary-model" : customProvider ? "provider" : "read-only",
      primaryModel,
      proxyModelAlias: managedPrimary?.routedModelId || null,
      keyEnvConfigured: Boolean(customProvider?.keyEnv),
      credentialSource: credential.source,
      credentialAvailable: credential.available,
      credentialEnvName: credential.envName,
      credentialMasked: credential.masked,
      credentialLast4: credential.last4,
      credentialDetail: credential.detail,
      note: primaryModel && providerRouteCap === "provider-routing"
        ? "Hermes uses this top-level primary model. Selecting it adds a local ClawNex provider and routes the model through LiteLLM."
        : customProvider
          ? "Hermes routes this model through its custom provider endpoint; selecting it routes that provider."
          : "Hermes model is observed from configuration but has no writable HTTP provider endpoint.",
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
      const capability = provider.name === HERMES_LITELLM_PROVIDER_NAME ? "unsupported" : providerCapability(provider.baseUrl, provider.apiMode);
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
          profileName: home.profileName,
          homePath: home.homePath,
          configPath: home.configPath,
          baseUrlKey: provider.baseUrlKey,
          apiMode: provider.apiMode,
          keyEnvConfigured: Boolean(provider.keyEnv),
          credentialSource: (() => {
            try { return findHermesModelCredential({ configPath: home.configPath, providerId: provider.name }).preview.source; } catch { return "missing"; }
          })(),
          routeMode: "custom_provider",
        },
      });
    }

    const primaryModel = asRecord(parsed.data.model);
    if (primaryModel) addHermesModelItem(items, home, providerMap, "model", primaryModel, true);

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
  const ownership = new Map((readSelectiveSidecar()?.providers || []).map(record => [record.providerId, record]));
  const items: DiscoveredRoutingItem[] = [];
  for (const provider of providers) {
    const currentRoute = classifyConnectorRoute(provider.baseUrl);
    const models = modelEntries(provider);
    const capability = provider.value.auth === 'oauth' || models.some(model => providerCapability(provider.baseUrl, model.metadata.api || provider.value.api) === 'unsupported')
      ? 'unsupported' : providerCapability(provider.baseUrl, provider.value.api);
    const defaultDesiredRoute: DesiredRoutingState = currentRoute === "routed" ? "routed" : "direct";
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
        ...identityMetadata(provider.value.headers, ownership.get(provider.id)),
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
          ...identityMetadata(provider.value.headers, ownership.get(provider.id)),
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
  const homes = knownHermesHomes();
  const watcherSourceToConfigSource = (sourceId: string): { sourceId: string; profileName: string } => {
    const profileMatch = sourceId.match(/^hermes:profile:([^:]+):/i);
    if (profileMatch) {
      const profileName = profileMatch[1];
      const profileHome = homes.find((home) => home.profileName.toLowerCase() === profileName.toLowerCase());
      if (profileHome) return { sourceId: profileHome.sourceId, profileName: profileHome.profileName };
    }
    const matchingHome = homes.find((home) => home.sourceId === sourceId);
    if (matchingHome) return { sourceId: matchingHome.sourceId, profileName: matchingHome.profileName };
    const defaultHome = homes.find((home) => home.profileName === "default");
    if (sourceId === defaultHome?.sourceId) return { sourceId: defaultHome.sourceId, profileName: defaultHome.profileName };
    return { sourceId, profileName: "observed profile" };
  };
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
    const { providerId } = splitObservedHermesModel(model);
    const source = watcherSourceToConfigSource(row.source_id || "default");
    const sourceId = source.sourceId;
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
      // Keep the provider-qualified ID in the observed inventory. Configured
      // Hermes models use the same identity, which lets reconciliation match
      // real watcher traffic to the configured route without losing context.
      modelId: model,
      displayName: model,
      baseUrl: null,
      capability: "read-only",
      currentRoute: "unknown",
      defaultDesiredRoute: "direct",
      metadata: {
        source: "watcher",
        profileName: source.profileName,
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
    const profileName = homes.find((home) => home.sourceId === sourceId)?.profileName || "observed profile";
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
        profileName,
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
      const eligibleDefault = ['provider-routing', 'model-inventory'].includes(item.capability) &&
        !['litellm', HERMES_LITELLM_PROVIDER_NAME].includes(item.providerId);
      const desired = previous?.desiredRoute || (eligibleDefault ? 'routed' : item.defaultDesiredRoute);
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
  const pendingChanges = after.filter((item) =>
    item.present &&
    item.capability !== "read-only" &&
    item.capability !== "unsupported" &&
    !isProxyBridgeProvider(item.connector, item.providerId) &&
    item.desiredRoute !== item.currentRoute,
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
    pendingChanges,
    scannedAt: now,
  };
}

export function syncConnectorRoutingInventory(trigger = "sync"): ConnectorRoutingResponse {
  const openclaw = persistDiscovery("openclaw", discoverOpenClawItems());
  const hermes = persistDiscovery("hermes", discoverHermesItems());
  const opencode = persistDiscovery('opencode', discoverOpenCodeItems());
  const snapshots = (summary: ConnectorRoutingSummary) => {
    const sources = [...new Set([summary.sourceId, ...summary.items.map(item => item.sourceId)])];
    return sources.map(sourceId => recordRoutingSnapshot(summary.connector,
      { ...summary, sourceId, items: summary.items.filter(item => item.sourceId === sourceId) }, trigger));
  };
  const openclawSnapshot = snapshots(openclaw)[0];
  const hermesSnapshot = snapshots(hermes)[0];
  const opencodeSnapshot = snapshots(opencode)[0];
  const scannedAt = nowIso();
  return {
    litellmTarget: litellmTarget(),
    openclaw,
    hermes,
    opencode,
    driftTotal: openclaw.drift.total + hermes.drift.total + opencode.drift.total,
    scannedAt,
    reconciliation: {
      events: listUnresolvedRoutingEvents(),
      lastSnapshotIds: { openclaw: openclawSnapshot.snapshotId, hermes: hermesSnapshot.snapshotId, opencode: opencodeSnapshot.snapshotId },
    },
  };
}

export function setConnectorRoutingSelections(connector: ConnectorId, itemIds: string[], desiredRoute: DesiredRoutingState): ConnectorRoutingSummary {
  const now = nowIso();
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) {
    return persistDiscovery(connector, discoverConnectorItems(connector));
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
  return persistDiscovery(connector, discoverConnectorItems(connector));
}

export function setAllConnectorRoutingSelections(connector: ConnectorId, desiredRoute: DesiredRoutingState): ConnectorRoutingSummary {
  const now = nowIso();
  const excludedProvider = connector === "openclaw" ? "litellm" : connector === 'hermes' ? HERMES_LITELLM_PROVIDER_NAME : '__none__';
  run(
    `UPDATE connector_routing_items
     SET desired_route = ?, updated_at = ?
     WHERE connector = ? AND present = 1
       AND capability IN ('provider-routing','model-inventory')
       AND provider_id != ?`,
    [desiredRoute, now, connector, excludedProvider],
  );
  return persistDiscovery(connector, discoverConnectorItems(connector));
}

function readSelectiveSidecar(): SelectiveRoutingSidecar | null {
  try {
    if (!fs.existsSync(SELECTIVE_SIDECAR_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(SELECTIVE_SIDECAR_PATH, "utf8"));
    if ([1, 2, SELECTIVE_SIDECAR_VERSION].includes(raw?.version) && Array.isArray(raw.providers)) {
      const seen = new Set<string>();
      for (const record of raw.providers) {
        if (!record || typeof record.providerId !== 'string' || !record.providerId || seen.has(record.providerId) ||
            !['baseUrl', 'base_url'].includes(record.baseUrlKey) || typeof record.originalBaseUrl !== 'string' ||
            typeof record.routedBaseUrl !== 'string') throw new Error('Invalid provider recovery record');
        seen.add(record.providerId);
        if (raw.version === 2 || record.apiKeyKey !== undefined) {
          if (!['apiKey', 'api_key'].includes(record.apiKeyKey) || typeof record.hadApiKey !== 'boolean' ||
              typeof record.routedApiKeySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.routedApiKeySha256) ||
              (record.hadApiKey && !Object.hasOwn(record, 'originalApiKey') && !record.encryptedOriginalApiKey)) throw new Error('Invalid credential recovery record');
        }
      }
      return raw as SelectiveRoutingSidecar;
    }
  } catch { throw new Error('OpenClaw routing ownership cannot be read. Recover the ownership file before changing routing.'); }
  throw new Error('Unsupported OpenClaw routing ownership format. No routing changes were made.');
}

function credentialOwner(record: SelectiveProviderRecord): string {
  return JSON.stringify(['openclaw-recovery-v3', record.providerId, record.baseUrlKey, record.originalBaseUrl, record.apiKeyKey, record.hadApiKey]);
}

function protectedSelectiveSidecar(sidecar: SelectiveRoutingSidecar): SelectiveRoutingSidecar {
  return { ...sidecar, version: 3, providers: sidecar.providers.map(record => {
    const { originalApiKey, ...safe } = record;
    if (record.apiKeyKey && record.hadApiKey && Object.hasOwn(record, 'originalApiKey')) {
      safe.encryptedOriginalApiKey = sealRoutingCredential(SELECTIVE_SIDECAR_PATH, credentialOwner(record), originalApiKey);
    }
    return safe;
  }) };
}

function legacyCredentialMatches(value: Record<string, unknown>, record: SelectiveProviderRecord): boolean {
  return !record.apiKeyKey || stableHash(value[record.apiKeyKey] ?? null) === record.routedApiKeySha256;
}

function writeSelectiveSidecar(sidecar: SelectiveRoutingSidecar | null): void {
  if (!sidecar || sidecar.providers.length === 0) {
    removeRoutingJournal(SELECTIVE_SIDECAR_PATH);
    return;
  }
  publishRoutingFile(SELECTIVE_SIDECAR_PATH, JSON.stringify(protectedSelectiveSidecar(sidecar), null, 2), 0o600);
}

function readHermesSidecar(): HermesRoutingSidecar | null {
  try {
    if (!fs.existsSync(HERMES_SIDECAR_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(HERMES_SIDECAR_PATH, "utf8"));
    if (raw?.version === HERMES_SIDECAR_VERSION && Array.isArray(raw.providers)) return raw as HermesRoutingSidecar;
  } catch { throw new Error('Hermes routing ownership cannot be read. Recover the ownership file before changing routing.'); }
  throw new Error('Unsupported Hermes routing ownership format. No routing changes were made.');
}

function writeHermesSidecar(sidecar: HermesRoutingSidecar | null): void {
  if (!sidecar || sidecar.providers.length === 0) {
    removeRoutingJournal(HERMES_SIDECAR_PATH);
    return;
  }
  publishRoutingFile(HERMES_SIDECAR_PATH, JSON.stringify(sidecar, null, 2), 0o600);
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

function hermesManagedFieldsMatch(record: HermesProviderRecord, map: unknown): boolean {
  const endpoint = getYamlString(map, record.baseUrlKey);
  const keyEnv = getYamlString(map, 'key_env') || getYamlString(map, 'keyEnv');
  const apiMode = getYamlString(map, 'api_mode') || getYamlString(map, 'apiMode');
  const headers = YAML.isMap(map) ? map.get('extra_headers', true) : null;
  return identityHeaderMatches(YAML.isMap(headers) ? headers.toJSON() : {}, record) && endpoint === record.routedBaseUrl && keyEnv === HERMES_LITELLM_KEY_ENV &&
    apiMode === (record.originalApiMode || 'chat_completions');
}

function attachHermesIdentity(map: unknown, ownership: RoutingIdentityOwnership, sourceId: string): boolean {
  if (!YAML.isMap(map)) return false;
  const existing = map.get('extra_headers', true);
  if (existing != null && !YAML.isMap(existing)) throw new Error('Hermes extra_headers is not a supported mapping.');
  if (!ownership.identityHash) ownership.identityContainerExisted = existing != null;
  const token = prepareIdentityHeader(YAML.isMap(existing) ? existing.toJSON() : {}, ownership, 'hermes', sourceId);
  if (!token) return false;
  const headers = YAML.isMap(existing) ? existing : new YAML.YAMLMap();
  headers.set(ROUTING_IDENTITY_HEADER, token);
  map.set('extra_headers', headers);
  return true;
}

function removeHermesIdentity(map: unknown, ownership: RoutingIdentityOwnership): void {
  if (!ownership.identityHash || !YAML.isMap(map)) return;
  const headers = map.get('extra_headers', true);
  if (!YAML.isMap(headers) || !identityHeaderMatches(headers.toJSON(), ownership)) throw new Error('The Hermes routing identity changed. Recovery ownership was preserved.');
  for (const key of Object.keys(headers.toJSON())) {
    if (key.toLowerCase() === ROUTING_IDENTITY_HEADER) headers.delete(key);
  }
  if (!headers.items.length && !ownership.identityContainerExisted) map.delete('extra_headers');
}

function restoreHermesFields(map: unknown, record: HermesProviderRecord, primary = false): void {
  if (!primary) removeHermesIdentity(map, record);
  for (const key of ['base_url', 'baseUrl']) deleteYamlKey(map, key);
  if (record.hadBaseUrl && record.originalBaseUrl !== null) setYamlString(map, record.baseUrlKey, record.originalBaseUrl);
  for (const key of ['api_mode', 'apiMode']) deleteYamlKey(map, key);
  if (record.hadApiMode && record.originalApiMode !== null) setYamlString(map, record.apiModeKey || 'api_mode', record.originalApiMode);
  if (!primary) {
    for (const key of ['key_env', 'keyEnv']) deleteYamlKey(map, key);
    if (record.hadKeyEnv && record.originalKeyEnv !== null) setYamlString(map, record.keyEnvKey || 'key_env', record.originalKeyEnv);
  }
}

function hermesPrimaryManagedFieldsMatch(record: HermesProviderRecord, map: unknown): boolean {
  const currentProvider = getYamlString(map, 'provider');
  const currentBaseUrl = getYamlString(map, 'base_url') || getYamlString(map, 'baseUrl');
  const currentApiMode = getYamlString(map, 'api_mode') || getYamlString(map, 'apiMode');
  const currentModelId = getYamlString(map, 'default') || getYamlString(map, 'model') || '__primary_model__';
  const expectedModelId = record.routedModelId || record.primaryModelId;
  return currentProvider === HERMES_LITELLM_PROVIDER_NAME && currentBaseUrl === record.routedBaseUrl &&
    currentApiMode === 'chat_completions' && (!expectedModelId || expectedModelId === currentModelId);
}

function restoreHermesPrimaryFields(map: unknown, record: HermesProviderRecord): void {
  if (record.originalProvider) setYamlString(map, 'provider', record.originalProvider);
  else deleteYamlKey(map, 'provider');
  if (record.primaryModelId) {
    const modelKey = record.primaryModelKey || (YAML.isMap(map) && map.has('default') ? 'default' : 'model');
    setYamlString(map, modelKey, record.primaryModelId);
  }
  restoreHermesFields(map, record, true);
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

function hermesPrimaryModelMap(doc: YAML.Document.Parsed): unknown {
  const model = doc.get("model", true);
  return YAML.isMap(model) ? model : null;
}

function ensureHermesProxyProvider(doc: YAML.Document.Parsed, target: string): boolean {
  let seq: YAML.YAMLSeq;
  const existingSeq = doc.get("custom_providers", true);
  if (YAML.isSeq(existingSeq)) seq = existingSeq;
  else {
    seq = new YAML.YAMLSeq();
    doc.set("custom_providers", seq);
  }
  const existing = seq.items.find((item) => YAML.isMap(item) && getYamlString(item, "name") === HERMES_LITELLM_PROVIDER_NAME);
  if (existing) {
    if (getYamlString(existing, 'base_url') !== target || getYamlString(existing, 'key_env') !== HERMES_LITELLM_KEY_ENV ||
      getYamlString(existing, 'api_mode') !== 'chat_completions') {
      throw new Error('The existing Hermes proxy provider does not match the prepared connection. Its operator-owned settings were preserved.');
    }
    return false;
  }
  const provider = new YAML.YAMLMap();
  provider.set("name", HERMES_LITELLM_PROVIDER_NAME);
  provider.set("base_url", target);
  provider.set("key_env", HERMES_LITELLM_KEY_ENV);
  provider.set("api_mode", "chat_completions");
  seq.add(provider);
  return true;
}

function removeHermesProxyProvider(doc: YAML.Document.Parsed): boolean {
  const seq = doc.get("custom_providers", true);
  if (!YAML.isSeq(seq)) return false;
  const index = seq.items.findIndex((item) => YAML.isMap(item) && getYamlString(item, "name") === HERMES_LITELLM_PROVIDER_NAME);
  if (index < 0) return false;
  const bridge = seq.items[index];
  const expected = { name: HERMES_LITELLM_PROVIDER_NAME, base_url: litellmTarget(), key_env: HERMES_LITELLM_KEY_ENV, api_mode: 'chat_completions' };
  const actual = YAML.isMap(bridge) ? bridge.toJSON() as Record<string, unknown> : null;
  // Hermes persists its live /models result back onto custom providers. This
  // cache is Hermes-owned only when it carries the explicit discovery marker;
  // hand-curated model metadata must continue to block bridge removal.
  const managedShape = actual?.models_discovered === true
    ? Object.fromEntries(Object.entries(actual).filter(([key]) => key !== 'models' && key !== 'models_discovered'))
    : actual;
  const referencesBridge = (value: unknown): boolean => typeof value === 'string' ? value === HERMES_LITELLM_PROVIDER_NAME || value.startsWith(`${HERMES_LITELLM_PROVIDER_NAME}/`)
    : Array.isArray(value) ? value.some(referencesBridge)
    : Boolean(value && typeof value === 'object' && Object.values(value).some(referencesBridge));
  const documentValue = doc.toJSON() as Record<string, unknown>;
  const { custom_providers: ignored, ...otherConfiguration } = documentValue;
  void ignored;
  if (stableHash(managedShape) !== stableHash(expected) || referencesBridge(otherConfiguration)) {
    throw new Error('The Hermes proxy bridge was edited or remains referenced. Configuration and recovery ownership were preserved for review.');
  }
  seq.items.splice(index, 1);
  return true;
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

export interface RoutingApplyScope { sourceId?: string; expectedFiles?: Record<string, string>; restore?: boolean }

export async function withConnectorRoutingLock<T>(connector: ConnectorId, task: () => T | Promise<T>): Promise<T> {
  const journal = connector === 'openclaw' ? SELECTIVE_SIDECAR_PATH : connector === 'hermes' ? HERMES_SIDECAR_PATH : OPENCODE_SIDECAR_PATH;
  return await withRoutingOperationLock(journal, task);
}

export function routingOwnershipFingerprint(connector: ConnectorId): string {
  if (connector === 'opencode') return openCodeRoutingOwnershipFingerprint();
  const file = connector === 'openclaw' ? SELECTIVE_SIDECAR_PATH : HERMES_SIDECAR_PATH;
  return stableHash(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
}

function assertReviewedFile(file: string, raw: string, scope: RoutingApplyScope) {
  if (scope.expectedFiles && scope.expectedFiles[file] !== stableHash(raw)) {
    throw new Error('Agent configuration changed after review. Refresh and approve again.');
  }
}

export function applyOpenClawDesiredRouting(scope: RoutingApplyScope = {}): ApplyOpenClawRoutingResult {
  if (scope.sourceId && scope.sourceId !== 'default') throw new Error('This OpenClaw instance has no supported local configuration access.');
  const { configPath } = resolveOpenClawPaths();
  const expectedRaw = configPath && fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
  const cfg = readOpenClawConfig();
  if (configPath && expectedRaw !== null) assertReviewedFile(configPath, expectedRaw, scope);
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
    const capability = providerCapability(provider.baseUrl, provider.value.api);
    const wantsRouted = selectedProviders.has(provider.id);

    const previous = records.get(provider.id);
    if (wantsRouted && previous && (provider.baseUrl !== previous.routedBaseUrl ||
        !legacyCredentialMatches(provider.value, previous))) {
      skippedProviders.push({ providerId: provider.id, reason: 'Existing endpoint or credential ownership conflicts with this provider. Operator changes and recovery records were preserved.' });
      continue;
    }

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
      const owned = records.get(provider.id);
      if (owned) {
        const headers = asRecord(provider.value.headers) || {};
        if (provider.value.headers != null && !asRecord(provider.value.headers)) throw new Error('OpenClaw provider headers must be a mapping.');
        if (!owned.identityHash) owned.identityContainerExisted = provider.value.headers != null;
        const token = prepareIdentityHeader(headers, owned, 'openclaw', 'default');
        if (token) { headers[ROUTING_IDENTITY_HEADER] = token; provider.value.headers = headers; changed = true; }
      }
      continue;
    }

    const record = records.get(provider.id);
    if (record && scope.restore === false) continue;
    if (record && provider.baseUrlKey === record.baseUrlKey && provider.baseUrl === record.routedBaseUrl && legacyCredentialMatches(provider.value, record) && identityHeaderMatches(asRecord(provider.value.headers) || {}, record)) {
      if (record.apiKeyKey) {
        if (!record.hadApiKey) delete provider.value[record.apiKeyKey];
        else provider.value[record.apiKeyKey] = record.encryptedOriginalApiKey
          ? openRoutingCredential(SELECTIVE_SIDECAR_PATH, credentialOwner(record), record.encryptedOriginalApiKey)
          : record.originalApiKey;
      }
      if (record.identityHash && asRecord(provider.value.headers)) {
        const headers = provider.value.headers as Record<string, unknown>;
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === ROUTING_IDENTITY_HEADER) delete headers[key];
        }
        if (!Object.keys(headers).length && !record.identityContainerExisted) delete provider.value.headers;
      }
      provider.value[provider.baseUrlKey] = record.originalBaseUrl;
      records.delete(provider.id);
      changed = true;
      restoredProviders.push(provider.id);
    } else if (record) {
      skippedProviders.push({ providerId: provider.id, reason: 'The endpoint, credential, or identity changed after ClawNex routed it. The operator edit and recovery record were preserved.' });
    }
  }

  if (scope.restore !== false) {
    for (const record of records.values()) {
      if (!providers.some(provider => provider.id === record.providerId)) skippedProviders.push({ providerId: record.providerId, reason: 'Provider was removed. Its recovery record was retained; no provider was recreated.' });
    }
  }

  if (!changed) {
    return {
      ok: skippedProviders.length === 0,
      status: skippedProviders.length ? "error" : "noop",
      detail: skippedProviders.length ? 'Some routes could not be changed safely. Review the preserved conflicts.' : "OpenClaw routing already matches the selected provider set.",
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
  const recoveryRecords = new Map(sidecar.providers.map(record => [record.providerId, record]));
  for (const [key, record] of records) recoveryRecords.set(key, record);
  commitRoutingFile({ configPath, expectedRaw: expectedRaw!, updatedRaw: JSON.stringify(cfg, null, 2),
    journalPath: SELECTIVE_SIDECAR_PATH,
    recoveryJournal: protectedSelectiveSidecar({ ...sidecar, providers: [...recoveryRecords.values()] }),
  });
  writeSelectiveSidecar({
    ...sidecar,
    managedAt: nowIso(),
    clawnexVersion: CLAWNEX_VERSION,
    openclawVersion: (cfg.meta as { lastTouchedVersion?: string } | undefined)?.lastTouchedVersion ?? sidecar.openclawVersion,
    providers: [...records.values()],
  });

  syncConnectorRoutingInventory();

  return {
    ok: skippedProviders.length === 0,
    status: skippedProviders.length ? "error" : "applied",
    detail: `Applied selected OpenClaw routing. Routed ${routedProviders.length}; restored ${restoredProviders.length}; preserved conflicts ${skippedProviders.length}.`,
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

export interface WireHermesModelResult {
  ok: boolean;
  status: "wired" | "already-configured" | "missing" | "credential-unavailable" | "error";
  detail: string;
  itemId: string;
  providerId: string | null;
  modelId: string | null;
  credential: HermesCredentialPreview | null;
}

function hermesProviderType(providerId: string): string {
  const value = providerId.toLowerCase();
  if (value.includes("openrouter")) return "openrouter";
  if (value.includes("anthropic") || value.includes("claude")) return "anthropic";
  if (value.includes("nvidia") || value.includes("nim") || value.includes("kimi")) return "nvidia-nim";
  if (value.includes("openai") || value.includes("gpt")) return "openai";
  return "openai-compatible";
}

/**
 * Register one readable Hermes model in ClawNex before the Hermes config is
 * rewired. This is the explicit assisted-confirmation step: the browser only
 * sends the inventory item ID; the server resolves the credential locally.
 */
export async function wireHermesModel(itemIdValue: string): Promise<WireHermesModelResult> {
  const row = queryOne<DbRoutingRow>(
    "SELECT * FROM connector_routing_items WHERE id = ? AND connector = 'hermes' AND present = 1",
    [itemIdValue],
  );
  if (!row) return { ok: false, status: "missing", detail: "The Hermes model is no longer present. Refresh Hermes inventory and try again.", itemId: itemIdValue, providerId: null, modelId: null, credential: null };

  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(row.metadata || "{}"); } catch { metadata = {}; }
  const configPath = stringValue(metadata.configPath);
  if (!configPath) return { ok: false, status: "missing", detail: "ClawNex cannot locate the Hermes config file for this model.", itemId: itemIdValue, providerId: row.provider_id, modelId: row.model_id, credential: null };

  const resolvedPath = normalizePathKey(configPath);
  let parsed: { data: Record<string, unknown> };
  try {
    const result = parseHermesConfig(resolvedPath);
    if (!result.ok) throw new Error(result.error);
    parsed = result;
  } catch (error) {
    return { ok: false, status: "missing", detail: `Hermes config could not be read: ${error instanceof Error ? error.message : String(error)}`, itemId: itemIdValue, providerId: row.provider_id, modelId: row.model_id, credential: null };
  }

  const primaryModel = metadata.primaryModel === true;
  const credential = findHermesModelCredential({ configPath: resolvedPath, providerId: row.provider_id, primaryModel });
  if (!credential.value) {
    return { ok: false, status: "credential-unavailable", detail: `${credential.preview.detail} Keep this route direct or expose the provider through a readable environment variable before wiring it.`, itemId: itemIdValue, providerId: row.provider_id, modelId: row.model_id, credential: credential.preview };
  }

  let modelConfig: Record<string, unknown> = {};
  if (primaryModel) {
    modelConfig = (asRecord(parsed.data.model) || {});
  } else {
    const provider = (Array.isArray(parsed.data.custom_providers) ? parsed.data.custom_providers : [])
      .find((entry) => asRecord(entry) && stringValue(asRecord(entry)?.name) === row.provider_id);
    modelConfig = asRecord(provider) || {};
  }
  const providerId = stringValue(modelConfig.provider) || row.provider_id || inferProviderFromModel(row.model_id);
  const baseUrl = stringValue(modelConfig.base_url) || stringValue(modelConfig.baseUrl) || row.base_url;
  if (!baseUrl || classifyConnectorRoute(baseUrl) === "unsupported") {
    return { ok: false, status: "missing", detail: "This Hermes model has no HTTP-compatible upstream endpoint for LiteLLM.", itemId: itemIdValue, providerId, modelId: row.model_id, credential: credential.preview };
  }

  const providerKey = `hermes-${stableHash([resolvedPath, providerId, row.model_id]).slice(0, 18)}`;
  const providerName = `Hermes ${stringValue(metadata.profileName) || "default"} · ${providerId}`;
  try {
    const existing = getProvider(providerKey);
    if (existing) {
      await updateProvider(providerKey, { name: providerName, type: hermesProviderType(providerId), baseUrl, apiKey: credential.value, apiKeyEnv: "" });
    } else {
      await addProvider({ id: providerKey, name: providerName, type: hermesProviderType(providerId), baseUrl, apiKey: credential.value });
    }
    addModel(providerKey, row.model_id, row.display_name || row.model_id);
    run("UPDATE connector_routing_items SET desired_route = 'routed', updated_at = ? WHERE id = ?", [nowIso(), itemIdValue]);
    syncProvidersToYaml({
      db: getDb(),
      configPath: resolveLiteLLMConfigPath(),
    });
    const status: WireHermesModelResult["status"] = existing ? "already-configured" : "wired";
    return { ok: true, status, detail: `${row.display_name || row.model_id} is configured in ClawNex. Apply the selected Hermes route, then restart Hermes.`, itemId: itemIdValue, providerId, modelId: row.model_id, credential: credential.preview };
  } catch (error) {
    return { ok: false, status: "error", detail: `ClawNex could not configure this Hermes model: ${error instanceof Error ? error.message : String(error)}`, itemId: itemIdValue, providerId, modelId: row.model_id, credential: credential.preview };
  }
}

export function applyHermesDesiredRouting(scope: RoutingApplyScope = {}): ApplyHermesRoutingResult {
  const selectedRows = queryAll<{ provider_id: string; metadata: string }>(
    `SELECT DISTINCT provider_id, metadata
     FROM connector_routing_items
     WHERE connector = 'hermes'
       AND present = 1
       AND desired_route = 'routed'
       AND provider_id != ''
       AND capability IN ('provider-routing','model-inventory')
       ${scope.sourceId ? 'AND source_id = ?' : ''}`,
    scope.sourceId ? [scope.sourceId] : [],
  );

  const selectedByConfig = new Map<string, Set<string>>();
  const selectedPrimaryByConfig = new Set<string>();
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
    if (metadata.primaryModel === true) {
      selectedPrimaryByConfig.add(resolvedConfig);
      continue;
    }
    const providers = selectedByConfig.get(resolvedConfig) || new Set<string>();
    providers.add(row.provider_id);
    selectedByConfig.set(resolvedConfig, providers);
  }

  const homes = knownHermesHomes().filter((home) => fs.existsSync(home.configPath) && (!scope.sourceId || home.sourceId === scope.sourceId));
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
    assertReviewedFile(home.configPath, parsed.raw, scope);
    const primarySelected = selectedPrimaryByConfig.has(normalizePathKey(home.configPath));
    const providerMaps = hermesProviderMaps(parsed.doc);
    let homeChanged = false;

    // Hermes stores the active agent model in the top-level `model:` block.
    // It is a real writable route even when `custom_providers` is empty. When
    // selected, introduce one named local provider so Hermes resolves the
    // LiteLLM key_env instead of sending the upstream credential to ClawNex.
    const primaryMap = hermesPrimaryModelMap(parsed.doc);
    const primaryKey = sidecarKey(home.configPath, "__primary_model__");
    const primaryRecord = records.get(primaryKey);
    if (YAML.isMap(primaryMap)) {
      const primaryModelKey: 'default' | 'model' = primaryMap.has('default') ? 'default' : 'model';
      const configuredPrimaryModelId = getYamlString(primaryMap, primaryModelKey) || "__primary_model__";
      const primaryModelId = primaryRecord?.primaryModelId || configuredPrimaryModelId;
      const currentProvider = getYamlString(primaryMap, "provider");
      const currentBaseUrl = getYamlString(primaryMap, "base_url") || getYamlString(primaryMap, "baseUrl");
      const currentApiMode = getYamlString(primaryMap, "api_mode") || getYamlString(primaryMap, "apiMode");
      if (primarySelected) {
        const upstreamProvider = primaryRecord?.originalProvider || currentProvider;
        const configuredProvider = providerMaps.find(provider => provider.providerId === upstreamProvider);
        const configuredProviderBaseUrl = configuredProvider
          ? getYamlString(configuredProvider.map, configuredProvider.baseUrlKey)
          : null;
        const upstreamBaseUrl = primaryRecord?.originalBaseUrl || currentBaseUrl || configuredProviderBaseUrl;
        const proxyModel = resolveConfiguredProxyModel(primaryModelId, { providerId: upstreamProvider, baseUrl: upstreamBaseUrl });
        if (!proxyModel) {
          skippedProviders.push({ providerId: primaryModelId, reason: "no unique configured LiteLLM model alias matches this Hermes model" });
          continue;
        }
        // A primary model may name a custom provider. Rewire both the model
        // selector and that provider endpoint so LiteLLM has one consistent
        // enforcement boundary and the provider can be restored independently.
        if (currentProvider && currentProvider !== HERMES_LITELLM_PROVIDER_NAME) {
          selectedProviders.add(currentProvider);
        }
        const createdProxyProvider = ensureHermesProxyProvider(parsed.doc, target);
        if (!primaryRecord) {
          records.set(primaryKey, {
            homePath: home.homePath,
            configPath: home.configPath,
            providerId: "__primary_model__",
            originalBaseUrl: currentBaseUrl,
            hadBaseUrl: currentBaseUrl !== null,
            baseUrlKey: primaryMap.has('baseUrl') ? 'baseUrl' : 'base_url',
            apiModeKey: primaryMap.has('apiMode') ? 'apiMode' : 'api_mode',
            originalKeyEnv: null,
            hadKeyEnv: false,
            originalApiMode: currentApiMode,
            hadApiMode: currentApiMode !== null,
            routedBaseUrl: target,
            routedAt: nowIso(),
            scope: "primary-model",
            originalProvider: currentProvider,
            createdProxyProvider,
            primaryModelId,
            primaryModelKey,
            routedModelId: proxyModel.modelAlias,
          });
        }
        const activePrimaryRecord = records.get(primaryKey)!;
        activePrimaryRecord.primaryModelId ||= primaryModelId;
        activePrimaryRecord.primaryModelKey ||= primaryModelKey;
        activePrimaryRecord.routedModelId = proxyModel.modelAlias;
        const bridgeMap = hermesProviderMaps(parsed.doc).find(provider => provider.providerId === HERMES_LITELLM_PROVIDER_NAME)?.map;
        if (attachHermesIdentity(bridgeMap, activePrimaryRecord, home.sourceId)) { homeChanged = true; changed = true; }
        if (configuredPrimaryModelId !== proxyModel.modelAlias) {
          setYamlString(primaryMap, primaryModelKey, proxyModel.modelAlias);
          homeChanged = true;
          changed = true;
        }
        if (currentProvider !== HERMES_LITELLM_PROVIDER_NAME) {
          setYamlString(primaryMap, "provider", HERMES_LITELLM_PROVIDER_NAME);
          homeChanged = true;
          changed = true;
        }
        if (currentBaseUrl !== target) {
          setYamlString(primaryMap, "base_url", target);
          deleteYamlKey(primaryMap, "baseUrl");
          homeChanged = true;
          changed = true;
        }
        if (currentApiMode !== "chat_completions") {
          setYamlString(primaryMap, "api_mode", "chat_completions");
          deleteYamlKey(primaryMap, "apiMode");
          homeChanged = true;
          changed = true;
        }
        // The model is the selection, but Hermes enforces the route at the
        // provider boundary. Report both so the result is unambiguous.
        if (!routedProviders.includes(primaryModelId)) routedProviders.push(primaryModelId);
        if (currentProvider && !routedProviders.includes(currentProvider)) routedProviders.push(currentProvider);
      } else if (primaryRecord?.scope === "primary-model" && scope.restore !== false) {
        if (hermesPrimaryManagedFieldsMatch(primaryRecord, primaryMap)) {
          restoreHermesPrimaryFields(primaryMap, primaryRecord);
          removeHermesIdentity(hermesProviderMaps(parsed.doc).find(provider => provider.providerId === HERMES_LITELLM_PROVIDER_NAME)?.map, primaryRecord);
          records.delete(primaryKey);
          const hasOtherManagedProvider = [...records.values()].some((record) => normalizePathKey(record.configPath) === normalizePathKey(home.configPath));
          if (primaryRecord.createdProxyProvider && !hasOtherManagedProvider) removeHermesProxyProvider(parsed.doc);
          homeChanged = true;
          changed = true;
          restoredProviders.push("__primary_model__");
          if (primaryRecord.originalProvider && !restoredProviders.includes(primaryRecord.originalProvider)) {
            restoredProviders.push(primaryRecord.originalProvider);
          }
        } else {
          skippedProviders.push({ providerId: "__primary_model__", reason: "the active Hermes model changed after ClawNex routed it; preserving the operator edit" });
        }
      }
    }

    for (const provider of providerMaps) {
      if (provider.providerId === HERMES_LITELLM_PROVIDER_NAME) continue;
      const key = sidecarKey(home.configPath, provider.providerId);
      const record = records.get(key);
      const currentBaseUrl = getYamlString(provider.map, provider.baseUrlKey);
      const currentKeyEnv = getYamlString(provider.map, "key_env") || getYamlString(provider.map, "keyEnv");
      const currentApiMode = getYamlString(provider.map, "api_mode") || getYamlString(provider.map, "apiMode");
      const wantsRouted = selectedProviders.has(provider.providerId);

      if (wantsRouted) {
        const currentCapability = providerCapability(currentBaseUrl, currentApiMode);
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
            keyEnvKey: YAML.isMap(provider.map) && provider.map.has('keyEnv') ? 'keyEnv' : 'key_env',
            apiModeKey: YAML.isMap(provider.map) && provider.map.has('apiMode') ? 'apiMode' : 'api_mode',
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
        const ownership = records.get(key);
        if (ownership && attachHermesIdentity(provider.map, ownership, home.sourceId)) { homeChanged = true; changed = true; }
        if (!routedProviders.includes(provider.providerId)) routedProviders.push(provider.providerId);
        continue;
      }

      if (record) {
        if (scope.restore === false) continue;
        if (!hermesManagedFieldsMatch(record, provider.map)) {
          skippedProviders.push({ providerId: provider.providerId, reason: "provider changed after ClawNex routed it; preserving operator edit" });
          continue;
        }
        restoreHermesFields(provider.map, record);

        records.delete(key);
        homeChanged = true;
        changed = true;
        restoredProviders.push(provider.providerId);
      }
    }

    if (homeChanged) {
      const recoveryRecords = new Map(sidecar.providers.map(record => [sidecarKey(record.configPath, record.providerId), record]));
      for (const [key, record] of records) recoveryRecords.set(key, record);
      commitRoutingFile({ configPath: home.configPath, expectedRaw: parsed.raw, updatedRaw: parsed.doc.toString(),
        journalPath: HERMES_SIDECAR_PATH, recoveryJournal: { ...sidecar, providers: [...recoveryRecords.values()] },
      });
    }
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

export function revertHermesRouting(scope: RoutingApplyScope = {}): RevertHermesRoutingResult {
  const sidecar = readHermesSidecar();
  if (!sidecar || sidecar.providers.length === 0) {
    run(
      `UPDATE connector_routing_items
       SET desired_route = 'direct', updated_at = ?
       WHERE connector = 'hermes' ${scope.sourceId ? 'AND source_id = ?' : ''}`,
      [nowIso(), ...(scope.sourceId ? [scope.sourceId] : [])],
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
  const allowedFiles = scope.sourceId ? new Set(knownHermesHomes().filter(home => home.sourceId === scope.sourceId).map(home => normalizePathKey(home.configPath))) : null;
  for (const record of sidecar.providers) {
    const configPath = normalizePathKey(record.configPath);
    if (allowedFiles && !allowedFiles.has(configPath)) { remainingRecords.push(record); continue; }
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
    assertReviewedFile(configPath, parsed.raw, scope);
    let homeChanged = false;

    // Restore the top-level Hermes model separately from custom providers.
    // The primary model is the path used by a normal Hermes installation, so
    // it must have the same guarded restore semantics as provider wires.
    const primaryRecord = records.find((record) => record.scope === "primary-model");
    const primaryMap = hermesPrimaryModelMap(parsed.doc);
    if (primaryRecord && YAML.isMap(primaryMap)) {
      if (!hermesPrimaryManagedFieldsMatch(primaryRecord, primaryMap)) {
        remainingRecords.push(primaryRecord);
        skippedProviders.push({ providerId: primaryRecord.providerId, reason: "the active Hermes model changed after ClawNex routed it; preserving operator edit" });
      } else {
        restoreHermesPrimaryFields(primaryMap, primaryRecord);
        removeHermesIdentity(providerMaps.get(HERMES_LITELLM_PROVIDER_NAME)?.map, primaryRecord);
        homeChanged = true;
        changed = true;
        restoredProviders.push(primaryRecord.providerId);
        if (primaryRecord.originalProvider && !restoredProviders.includes(primaryRecord.originalProvider)) {
          restoredProviders.push(primaryRecord.originalProvider);
        }
      }
    }

    if (primaryRecord && !YAML.isMap(primaryMap)) {
      remainingRecords.push(primaryRecord);
      skippedProviders.push({ providerId: primaryRecord.providerId, reason: 'The primary model configuration was removed or changed shape; recovery ownership was preserved.' });
    }

    for (const record of records) {
      if (record.scope === "primary-model") continue;
      const provider = providerMaps.get(record.providerId);
      if (!provider) {
        skippedProviders.push({ providerId: record.providerId, reason: "provider no longer exists; preserved recovery ownership for review" });
        remainingRecords.push(record);
        continue;
      }

      const currentBaseUrl = getYamlString(provider.map, provider.baseUrlKey);
      if (!hermesManagedFieldsMatch(record, provider.map)) {
        remainingRecords.push(record);
        skippedProviders.push({ providerId: record.providerId, reason: "provider changed after ClawNex routed it; preserving operator edit" });
        continue;
      }

      restoreHermesFields(provider.map, record);

      homeChanged = true;
      changed = true;
      restoredProviders.push(record.providerId);
    }

    const hasRemainingManagedProvider = remainingRecords.some((record) => normalizePathKey(record.configPath) === configPath);
    if (primaryRecord?.scope === "primary-model" && primaryRecord.createdProxyProvider && !hasRemainingManagedProvider) {
      if (removeHermesProxyProvider(parsed.doc)) homeChanged = true;
    }

    if (homeChanged) commitRoutingFile({ configPath, expectedRaw: parsed.raw, updatedRaw: parsed.doc.toString(),
      journalPath: HERMES_SIDECAR_PATH, recoveryJournal: sidecar,
    });
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
     WHERE connector = 'hermes' ${scope.sourceId ? 'AND source_id = ?' : ''}`,
    [nowIso(), ...(scope.sourceId ? [scope.sourceId] : [])],
  );
  syncConnectorRoutingInventory();

  if (!changed && skippedProviders.length > 0) {
    return {
      ok: false,
      status: "error",
      detail: `No Hermes providers were reverted. ${skippedProviders.length} provider(s) were preserved because ClawNex could not safely restore them.`,
      restartRequired: false,
      restoredProviders,
      skippedProviders,
      sidecarPath: HERMES_SIDECAR_PATH,
    };
  }

  return {
    ok: skippedProviders.length === 0,
    status: skippedProviders.length ? "error" : "reverted",
    detail: `Reverted ClawNex-managed Hermes wire for ${restoredProviders.length} provider(s).`,
    restartRequired: restoredProviders.length > 0,
    restoredProviders,
    skippedProviders,
    sidecarPath: HERMES_SIDECAR_PATH,
  };
}

export function getConnectorRoutingDriftSnapshot(): { total: number; openclaw: number; hermes: number; opencode: number; lastChecked: string | null } {
  const rows = queryAll<{ connector: ConnectorId; count: number }>(
    `SELECT connector, COUNT(*) AS count
     FROM connector_routing_items
     WHERE last_changed_at IS NOT NULL
       AND updated_at >= datetime('now','-24 hours')
     GROUP BY connector`,
  );
  const openclaw = rows.find((row) => row.connector === "openclaw")?.count || 0;
  const hermes = rows.find((row) => row.connector === "hermes")?.count || 0;
  const opencode = rows.find((row) => row.connector === 'opencode')?.count || 0;
  const last = queryOne<{ ts: string }>("SELECT MAX(updated_at) AS ts FROM connector_routing_items");
  return { total: openclaw + hermes + opencode, openclaw, hermes, opencode, lastChecked: last?.ts || null };
}
