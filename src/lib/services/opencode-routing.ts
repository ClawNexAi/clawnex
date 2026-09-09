import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queryAll, queryOne } from '@/lib/db';
import { resolveOpenCodeGlobalConfig } from './coding-agent-connectors';
import { commitRoutingFile, removeRoutingJournal } from './routing-file-transaction';
import { identityHeaderMatches, prepareIdentityHeader, routingIdentityHash, ROUTING_IDENTITY_HEADER, type RoutingIdentityOwnership } from './routing-identity';
import { stableRoutingFingerprint } from './routing-reconciliation';
import { openRoutingCredential, sealRoutingCredential, type EncryptedRoutingCredential } from './routing-credential-recovery';
import { parseOpenCodeConfig } from './opencode-config';
import { resolveConfiguredProxyModel } from './configured-proxy-model';
import type { ApplyOpenClawRoutingResult, ConnectorRoutingSummary, DiscoveredRoutingItem, RoutingApplyScope } from './connector-routing-inventory';

interface OpenCodeConnectorRow {
  id: string;
  name: string;
  is_active: number;
}

interface OpenCodeProviderRecord extends RoutingIdentityOwnership {
  providerId: string;
  configPath: string;
  originalBaseUrl: string;
  routedBaseUrl: string;
  routedAt: string;
  models: Array<{ key: string; hadId: boolean; originalId?: string; routedId: string }>;
  hadApiKey: boolean;
  encryptedOriginalApiKey?: EncryptedRoutingCredential;
  routedApiKeyHash: string;
}

interface OpenCodeRoutingSidecar {
  version: 1;
  managedAt: string;
  providers: OpenCodeProviderRecord[];
}

export const OPENCODE_SIDECAR_PATH = process.env.CLAWNEX_OPENCODE_ROUTING_SIDECAR
  || path.join(os.homedir(), '.clawnex-opencode-routing-managed.json');

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readSidecar(): OpenCodeRoutingSidecar | null {
  if (!fs.existsSync(OPENCODE_SIDECAR_PATH)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(OPENCODE_SIDECAR_PATH, 'utf8'));
    if (value?.version !== 1 || !Array.isArray(value.providers)) throw new Error('invalid');
    const providers = value.providers as OpenCodeProviderRecord[];
    const ids = new Set<string>();
    for (const provider of providers) {
      if (!provider || typeof provider.providerId !== 'string' || !provider.providerId || ids.has(provider.providerId) ||
          typeof provider.originalBaseUrl !== 'string' || typeof provider.routedBaseUrl !== 'string' || !Array.isArray(provider.models) ||
          typeof provider.hadApiKey !== 'boolean' || typeof provider.routedApiKeyHash !== 'string') throw new Error('invalid');
      ids.add(provider.providerId);
    }
    return value as OpenCodeRoutingSidecar;
  } catch {
    throw new Error('OpenCode routing ownership cannot be read. Recover the ownership file before changing routing.');
  }
}

const ROUTED_API_KEY = '{env:LITELLM_MASTER_KEY}';

function credentialOwner(record: Pick<OpenCodeProviderRecord, 'providerId' | 'configPath' | 'originalBaseUrl' | 'routedBaseUrl' | 'hadApiKey'>): string {
  return JSON.stringify(['opencode-recovery-v1', record.providerId, record.configPath, record.originalBaseUrl, record.routedBaseUrl, record.hadApiKey]);
}

function identityMetadata(headers: unknown, owner?: OpenCodeProviderRecord): Record<string, unknown> {
  const values = asRecord(headers) || {};
  const key = Object.keys(values).find(name => name.toLowerCase() === ROUTING_IDENTITY_HEADER);
  const value = key ? values[key] : null;
  return {
    identityHash: owner?.identityHash || null,
    identityFingerprint: typeof value === 'string' ? routingIdentityHash(value) : null,
    identityIntact: owner?.identityHash ? identityHeaderMatches(values, owner) : null,
  };
}

function directRoute(baseUrl: string | null): 'direct' | 'routed' | 'unknown' | 'unsupported' {
  if (!baseUrl) return 'direct';
  try {
    const parsed = new URL(baseUrl);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const proxyPort = process.env.LITELLM_PORT || '4001';
    if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname.toLowerCase()) &&
        port === proxyPort && parsed.pathname.replace(/\/$/, '') === '/v1' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password) return 'routed';
    return ['http:', 'https:'].includes(parsed.protocol) ? 'direct' : 'unsupported';
  } catch {
    return 'unknown';
  }
}

export function discoverOpenCodeItems(): {
  status: ConnectorRoutingSummary['status']; detail: string; sourceId: string; items: DiscoveredRoutingItem[];
} {
  const connector = queryOne<OpenCodeConnectorRow>("SELECT id, name, is_active FROM coding_agent_connectors WHERE type = 'opencode' AND is_active = 1 ORDER BY created_at ASC LIMIT 1");
  if (!connector) return { status: 'missing', detail: 'Global OpenCode connector is not configured.', sourceId: 'opencode:global', items: [] };
  const check = resolveOpenCodeGlobalConfig();
  if (!check.available) return { status: 'error', detail: check.error || 'Global OpenCode configuration is unavailable.', sourceId: 'opencode:global', items: [] };

  const config = parseOpenCodeConfig(fs.readFileSync(check.configPath, 'utf8'));
  const providers = asRecord(config.provider) || {};
  const ownership = new Map((readSidecar()?.providers || []).map(record => [record.providerId, record]));
  const items: DiscoveredRoutingItem[] = [];
  for (const [providerId, providerValue] of Object.entries(providers)) {
    const provider = asRecord(providerValue);
    if (!provider) continue;
    const options = asRecord(provider.options) || {};
    const baseUrl = typeof options.baseURL === 'string' && options.baseURL.trim() ? options.baseURL.trim() : null;
    const route = directRoute(baseUrl);
    const models = asRecord(provider.models) || {};
    const supportedPackage = provider.npm === '@ai-sdk/openai-compatible';
    const supportedModels = Object.values(models).every(model => asRecord(model) !== null);
    const supportedCredential = options.apiKey === undefined || typeof options.apiKey === 'string';
    const capability = supportedPackage && supportedModels && supportedCredential && baseUrl && ['direct', 'routed'].includes(route) ? 'provider-routing' : 'unsupported';
    const metadata = { configPath: check.configPath, connectorId: connector.id, globalOnly: true, package: provider.npm || null,
      ...identityMetadata(options.headers, ownership.get(providerId)) };
    items.push({
      connector: 'opencode', sourceId: 'opencode:global', itemType: 'provider', providerId, modelId: '', displayName: typeof provider.name === 'string' ? provider.name : providerId,
      baseUrl, capability, currentRoute: route, defaultDesiredRoute: route === 'routed' ? 'routed' : 'direct', metadata: { ...metadata, modelCount: Object.keys(models).length },
    });
    for (const [modelKey, modelValue] of Object.entries(models)) {
      const model = asRecord(modelValue) || {};
      const modelId = modelKey.startsWith(`${providerId}/`) ? modelKey : `${providerId}/${modelKey}`;
      const managedModel = ownership.get(providerId)?.models.find(entry => entry.key === modelKey);
      const proxyModelAlias = route === 'routed' && managedModel
        ? managedModel.routedId
        : resolveConfiguredProxyModel(modelId, { providerId, baseUrl })?.modelAlias || modelId;
      items.push({
        connector: 'opencode', sourceId: 'opencode:global', itemType: 'model', providerId, modelId,
        displayName: typeof model.name === 'string' ? model.name : modelId, baseUrl,
        capability: capability === 'provider-routing' ? 'model-inventory' : capability,
        currentRoute: route, defaultDesiredRoute: route === 'routed' ? 'routed' : 'direct',
        metadata: { ...metadata, enforcedAt: 'provider', proxyModelAlias, note: 'OpenCode global routing changes this provider endpoint for all of its configured models.' },
      });
    }
  }
  return { status: 'ok', detail: `Discovered ${items.length} global OpenCode routing item(s). Project-specific configuration is outside this connector's scope.`, sourceId: 'opencode:global', items };
}

export function openCodeRoutingOwnershipFingerprint(): string {
  const raw = fs.existsSync(OPENCODE_SIDECAR_PATH) ? fs.readFileSync(OPENCODE_SIDECAR_PATH, 'utf8') : '';
  return stableRoutingFingerprint(raw);
}

export function hasOpenCodeRoutingOwnership(): boolean {
  return (readSidecar()?.providers.length || 0) > 0;
}

export function applyOpenCodeDesiredRouting(scope: RoutingApplyScope = {}): ApplyOpenClawRoutingResult {
  if (scope.sourceId && scope.sourceId !== 'opencode:global') throw new Error('This OpenCode instance has no supported global configuration access.');
  const check = resolveOpenCodeGlobalConfig();
  if (!check.available) return { ok: false, status: 'missing', detail: check.error || 'OpenCode configuration is unavailable.', restartRequired: false,
    routedProviders: [], restoredProviders: [], skippedProviders: [], sidecarPath: OPENCODE_SIDECAR_PATH };
  const expectedRaw = fs.readFileSync(check.configPath, 'utf8');
  if (scope.expectedFiles && scope.expectedFiles[check.configPath] !== stableRoutingFingerprint(expectedRaw)) {
    throw new Error('Agent configuration changed after review. Refresh and approve again.');
  }
  const config = parseOpenCodeConfig(expectedRaw);
  const providers = asRecord(config.provider) || {};
  const previousSidecar = readSidecar();
  const sidecar: OpenCodeRoutingSidecar = previousSidecar || { version: 1, managedAt: new Date().toISOString(), providers: [] };
  const records = new Map(sidecar.providers.map(record => [record.providerId, record]));
  const selected = new Set(queryAll<{ provider_id: string }>(
    `SELECT DISTINCT provider_id FROM connector_routing_items
     WHERE connector = 'opencode' AND present = 1 AND desired_route = 'routed'
       AND capability IN ('provider-routing','model-inventory')`,
  ).map(row => row.provider_id));
  const target = `http://127.0.0.1:${process.env.LITELLM_PORT || '4001'}/v1`;
  const routedProviders: string[] = [];
  const restoredProviders: string[] = [];
  const skippedProviders: Array<{ providerId: string; reason: string }> = [];
  let changed = false;

  for (const [providerId, providerValue] of Object.entries(providers)) {
    const provider = asRecord(providerValue);
    const options = provider ? asRecord(provider.options) : null;
    if (!provider || !options) continue;
    const baseUrl = typeof options.baseURL === 'string' ? options.baseURL : '';
    const record = records.get(providerId);
    if (selected.has(providerId)) {
      if (record && (baseUrl !== record.routedBaseUrl || !identityHeaderMatches(asRecord(options.headers) || {}, record) ||
          stableRoutingFingerprint(options.apiKey) !== record.routedApiKeyHash)) {
        skippedProviders.push({ providerId, reason: 'The endpoint or routing identity changed after ClawNex routed it. The operator edit and recovery record were preserved.' });
        continue;
      }
      if (!record) {
        if (provider.npm !== '@ai-sdk/openai-compatible' || directRoute(baseUrl) !== 'direct') {
          skippedProviders.push({ providerId, reason: 'Only explicit OpenAI-compatible global provider endpoints can be routed.' });
          continue;
        }
        const modelMap = asRecord(provider.models) || {};
        const models = Object.entries(modelMap).map(([key, value]) => {
          const model = asRecord(value);
          if (!model || (model.id !== undefined && typeof model.id !== 'string')) throw new Error('OpenCode model entries must be objects with optional string ids.');
          const modelId = key.startsWith(`${providerId}/`) ? key : `${providerId}/${key}`;
          const proxyModel = resolveConfiguredProxyModel(modelId, { providerId, baseUrl });
          if (!proxyModel) throw new Error('An OpenCode model has no unique configured LiteLLM alias. Refresh configuration and test the exact model.');
          return { key, hadId: Object.hasOwn(model, 'id'), ...(typeof model.id === 'string' ? { originalId: model.id } : {}),
            routedId: proxyModel.modelAlias };
        });
        const record: OpenCodeProviderRecord = {
          providerId, configPath: check.configPath, originalBaseUrl: baseUrl, routedBaseUrl: target,
          routedAt: new Date().toISOString(), models, hadApiKey: Object.hasOwn(options, 'apiKey'),
          routedApiKeyHash: stableRoutingFingerprint(ROUTED_API_KEY),
        };
        if (record.hadApiKey) record.encryptedOriginalApiKey = sealRoutingCredential(OPENCODE_SIDECAR_PATH, credentialOwner(record), options.apiKey);
        records.set(providerId, record);
      }
      const owner = records.get(providerId)!;
      const modelMap = asRecord(provider.models) || {};
      if (baseUrl === target && owner.models.some(model => asRecord(modelMap[model.key])?.id !== model.routedId)) {
        skippedProviders.push({ providerId, reason: 'A model identifier changed after ClawNex routed it. The operator edit and recovery record were preserved.' });
        continue;
      }
      const headers = asRecord(options.headers) || {};
      if (options.headers != null && !asRecord(options.headers)) throw new Error('OpenCode provider headers must be an object.');
      if (!owner.identityHash) owner.identityContainerExisted = options.headers != null;
      const token = prepareIdentityHeader(headers, owner, 'opencode', 'opencode:global');
      if (baseUrl !== target) { options.baseURL = target; changed = true; routedProviders.push(providerId); }
      if (options.apiKey !== ROUTED_API_KEY) { options.apiKey = ROUTED_API_KEY; changed = true; }
      for (const modelRecord of owner.models) {
        const model = asRecord(modelMap[modelRecord.key]);
        if (!model) throw new Error('An OpenCode model changed during routing. No configuration was written.');
        if (model.id !== modelRecord.routedId) { model.id = modelRecord.routedId; changed = true; }
      }
      if (token) { headers[ROUTING_IDENTITY_HEADER] = token; options.headers = headers; changed = true; }
      continue;
    }
    if (!record || scope.restore === false) continue;
    const modelMap = asRecord(provider.models) || {};
    const modelIdsIntact = record.models.every(model => asRecord(modelMap[model.key])?.id === model.routedId);
    if (baseUrl !== record.routedBaseUrl || !identityHeaderMatches(asRecord(options.headers) || {}, record) || !modelIdsIntact ||
        stableRoutingFingerprint(options.apiKey) !== record.routedApiKeyHash) {
      skippedProviders.push({ providerId, reason: 'The endpoint or routing identity changed after ClawNex routed it. The operator edit and recovery record were preserved.' });
      continue;
    }
    const headers = asRecord(options.headers) || {};
    for (const key of Object.keys(headers)) if (key.toLowerCase() === ROUTING_IDENTITY_HEADER) delete headers[key];
    if (Object.keys(headers).length) options.headers = headers;
    else if (!record.identityContainerExisted) delete options.headers;
    options.baseURL = record.originalBaseUrl;
    if (record.hadApiKey && record.encryptedOriginalApiKey) {
      options.apiKey = openRoutingCredential(OPENCODE_SIDECAR_PATH, credentialOwner(record), record.encryptedOriginalApiKey);
    } else delete options.apiKey;
    for (const modelRecord of record.models) {
      const model = asRecord(modelMap[modelRecord.key])!;
      if (modelRecord.hadId) model.id = modelRecord.originalId;
      else delete model.id;
    }
    records.delete(providerId);
    changed = true;
    restoredProviders.push(providerId);
  }

  const recoveryJournal: OpenCodeRoutingSidecar = { ...sidecar, managedAt: new Date().toISOString(), providers: [...records.values()] };
  if (changed) {
    commitRoutingFile({ configPath: check.configPath, expectedRaw, updatedRaw: `${JSON.stringify(config, null, 2)}\n`, journalPath: OPENCODE_SIDECAR_PATH,
      recoveryJournal, expectedJournal: previousSidecar });
    if (!recoveryJournal.providers.length) removeRoutingJournal(OPENCODE_SIDECAR_PATH);
  }
  const ok = skippedProviders.length === 0;
  return {
    ok,
    status: changed ? (ok ? 'applied' : 'error') : (ok ? 'noop' : 'error'),
    detail: changed ? `Updated ${routedProviders.length + restoredProviders.length} OpenCode provider route(s). Restart OpenCode before verification.`
      : ok ? 'OpenCode routing already matches the selected provider set.' : 'Some OpenCode routes could not be changed safely.',
    restartRequired: changed,
    routedProviders,
    restoredProviders,
    skippedProviders,
    sidecarPath: OPENCODE_SIDECAR_PATH,
  };
}
