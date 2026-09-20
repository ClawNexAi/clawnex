import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { queryOne, run } from '../db';
import { getProvider, listModels } from './config-service';
import { resolveLiteLLMConfigPath } from '../litellm/paths';
import { deploymentRevision } from '../litellm/deployment-revision';
import { litellmModelForConfiguredModel } from '../litellm/sync';
import { checkProxyModelReadiness } from '../litellm/model-readiness';
import type { ConnectorRoutingSummary as Summary, RoutingConnectorId } from './connector-routing-inventory';
type ConnectorRoutingSummary = Summary<RoutingConnectorId>;
import { resolveConfiguredProxyModel } from './configured-proxy-model';

function proxyTarget(item: ConnectorRoutingSummary['items'][number]) {
  const recordedAlias = typeof item.metadata.proxyModelAlias === 'string' ? item.metadata.proxyModelAlias : null;
  return resolveConfiguredProxyModel(recordedAlias || item.modelId, {
    providerId: item.providerId,
    baseUrl: item.baseUrl,
  });
}

function expected(providerId: string, modelAlias: string) {
  const provider = getProvider(providerId);
  if (!provider?.is_active || provider.type === 'openclaw' ||
      !listModels(providerId).some(model => model.model_id === modelAlias)) throw new Error('not configured');
  const configPath = resolveLiteLLMConfigPath();
  const revision = deploymentRevision(configPath, modelAlias, {
    model: litellmModelForConfiguredModel(provider.type, modelAlias),
    ...(provider.base_url ? { api_base: provider.base_url } : {}),
    api_key: provider.api_key || (provider.api_key_env ? `os.environ/${provider.api_key_env}` : 'not-needed'),
  });
  return { configPath, revision, port: Number(process.env.LITELLM_PORT || '4001') };
}

/** Returns only a server-recorded result still matching the selected provider and file. */
export function hasCurrentProviderReadiness(providerId: string, modelAlias: string): boolean {
  try {
    const target = expected(providerId, modelAlias);
    const row = queryOne<{ receipt_json: string }>('SELECT receipt_json FROM provider_routing_readiness WHERE provider_id = ? AND model_alias = ?', [providerId, modelAlias]);
    if (!row) return false;
    const receipt = JSON.parse(row.receipt_json);
    return receipt.ready === true && Date.parse(receipt.expiresAt) > Date.now() &&
      receipt.port === target.port && receipt.revision === target.revision &&
      receipt.fingerprint === createHash('sha256').update(fs.readFileSync(target.configPath)).digest('hex');
  } catch { return false; }
}

export async function testConfiguredProxyModel(providerId: string, modelAlias: string, approved: boolean) {
  if (!approved) return { ready: false, status: 'approval-required' };
  run('DELETE FROM provider_routing_readiness WHERE provider_id = ? AND model_alias = ?', [providerId, modelAlias]);
  try {
    const target = expected(providerId, modelAlias);
    const result = await checkProxyModelReadiness({ ...target, modelAlias, approved,
      expectedRevision: target.revision, proxyKey: process.env.LITELLM_MASTER_KEY,
    });
    if (result.ready) {
      if (expected(providerId, modelAlias).revision !== target.revision) return { ready: false, status: 'configuration-changed' };
      run('INSERT OR REPLACE INTO provider_routing_readiness (provider_id, model_alias, receipt_json) VALUES (?, ?, ?)',
        [providerId, modelAlias, JSON.stringify({ ...result, port: target.port })]);
      if (!hasCurrentProviderReadiness(providerId, modelAlias)) return { ready: false, status: 'configuration-changed' };
    }
    return result;
  } catch { return { ready: false, status: 'not-configured' }; }
}

/** Provider-wide enforcement means every sibling model needs a prepared replacement. */
export function selectedRoutingPrerequisites(summary: ConnectorRoutingSummary): string[] {
  const key = (item: ConnectorRoutingSummary['items'][number]) => `${item.sourceId}\0${item.providerId}`;
  const selected = new Set(summary.items.filter(item => item.present && item.desiredRoute === 'routed' &&
    ['provider-routing', 'model-inventory'].includes(item.capability)).map(key));
  const failures: string[] = [];
  if (selected.size && Buffer.byteLength(process.env.CLAWNEX_INGEST_SECRET || '') < 32) {
    failures.push('Configure the same dedicated CLAWNEX_INGEST_SECRET (at least 32 bytes) for ClawNex and LiteLLM before wiring. It enables authenticated, instance-specific traffic evidence.');
  }
  for (const selectedKey of selected) {
    const siblings = summary.items.filter(item => item.present && key(item) === selectedKey && item.itemType === 'model');
    if (!siblings.length) { failures.push('A selected provider has no known models. Discover and configure its models first.'); continue; }
    for (const item of siblings) {
      const target = proxyTarget(item);
      if (!target || !hasCurrentProviderReadiness(target.providerId, target.modelAlias)) {
        failures.push(`${item.displayName || item.modelId}: configure and test this exact model through ClawNex before applying the provider route.`);
      }
    }
  }
  return [...new Set(failures)];
}

/** Read-only recheck immediately before apply; never sends a model prompt. */
export async function assertSelectedLiveDeployments(summary: ConnectorRoutingSummary): Promise<void> {
  const key = (item: ConnectorRoutingSummary['items'][number]) => `${item.sourceId}\0${item.providerId}`;
  const selected = new Set(summary.items.filter(item => item.present && item.desiredRoute === 'routed' &&
    ['provider-routing', 'model-inventory'].includes(item.capability)).map(key));
  const targets = summary.items.filter(item => item.present && item.itemType === 'model' && selected.has(key(item)))
    .map(item => ({ item, target: proxyTarget(item) }));
  if (!targets.length) return;
  const headers: Record<string, string> = {};
  if (process.env.LITELLM_MASTER_KEY) headers.Authorization = `Bearer ${process.env.LITELLM_MASTER_KEY}`;
  const port = Number(process.env.LITELLM_PORT || '4001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LiteLLM port.');
  let data: { data?: Array<{ model_name?: string; model_info?: { x_clawnex_revision?: string } }> };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/model/info`, { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('unavailable');
    data = await response.json();
  } catch { throw new Error('The prepared proxy is no longer reachable. No agent configuration was changed.'); }
  for (const { item, target } of targets) {
    const alias = target?.modelAlias || item.modelId;
    const loaded = Array.isArray(data.data) ? data.data.filter(model => model.model_name === alias) : [];
    if (!target || loaded.length !== 1 || !hasCurrentProviderReadiness(target.providerId, alias) ||
      loaded[0].model_info?.x_clawnex_revision !== expected(target.providerId, alias).revision) {
      throw new Error(`${alias}: the loaded proxy deployment changed or its readiness expired. Test the model and review again.`);
    }
  }
}
