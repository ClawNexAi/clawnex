#!/usr/bin/env tsx
/** Shared routing API contract for the global OpenCode connector. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-opencode-routing-'));
const previousHome = process.env.HOME;
process.env.HOME = root;
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.CLAWNEX_INGEST_SECRET = 'fixture-only-routing-identity-secret-32-bytes';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';
process.env.OPENCLAW_HOME = path.join(root, '.openclaw');
process.env.HERMES_HOME = path.join(root, '.hermes');
process.env.CLAWNEX_OPENCODE_ROUTING_SIDECAR = path.join(root, '.clawnex-opencode-routing-managed.json');
process.env.LITELLM_PORT = '4001';
process.env.LITELLM_MASTER_KEY = 'fixture-only-litellm-key';
const liteLlmConfigPath = path.join(root, 'litellm-config.yaml');
process.env.CLAWNEX_LITELLM_CONFIG = liteLlmConfigPath;
fs.writeFileSync(liteLlmConfigPath, 'model_list: []\n');

const configDirectory = path.join(root, '.config', 'opencode');
const configPath = path.join(configDirectory, 'opencode.jsonc');
fs.mkdirSync(configDirectory, { recursive: true });
fs.writeFileSync(configPath, `{
  // OpenCode accepts JSONC in its global configuration.
  "providers": {
    "fleet": {
      "name": "OpenRouter Friendly",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "https://openrouter.ai/api/v1", "apiKey": "upstream-secret" },
      "models": { "gpt-5.4": { "name": "GPT-5.4", "modelID": "openrouter/openai/gpt-5.4" } },
    },
  },
  "provider": {
    "compat": {
      "name": "Singular Compatibility",
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://openrouter.ai/api/v1" },
      "models": { "gpt-5.4": { "name": "GPT-5.4", "id": "openrouter/openai/gpt-5.4" } },
    },
  },
}\n`);

async function main(): Promise<void> {
  const { NextRequest } = await import('next/server');
  const connectorApi = await import('../src/app/api/config/coding-agent-connectors/route');
  const routingApi = await import('../src/app/api/connector-routing/route');
  const { getDb } = await import('../src/lib/db');
  const { addProvider, addModel } = await import('../src/lib/services/config-service');
  const { syncProvidersToYaml } = await import('../src/lib/litellm/sync');
  const readinessApi = await import('../src/app/api/config/providers/[id]/test/route');
  const originalFetch = globalThis.fetch;
  const request = (body: unknown) => new NextRequest('http://127.0.0.1:5001/api/connector-routing', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    const added = await connectorApi.POST(new NextRequest('http://127.0.0.1:5001/api/config/coding-agent-connectors', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'opencode', name: 'OpenCode Local' }),
    }));
    assert.equal(added.status, 201);
    const addedConnector = await added.json();

    const response = await routingApi.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing', {
      headers: { origin: 'http://127.0.0.1:5001' },
    }));
    const inventory = await response.json();
    assert.equal(response.status, 200);
    assert.equal(inventory.opencode.status, 'ok', 'shared routing inventory includes OpenCode');
    const provider = inventory.opencode.items.find((item: { providerId: string; itemType: string }) => item.providerId === 'fleet' && item.itemType === 'provider');
    assert.equal(provider.displayName, 'OpenRouter Friendly', 'JSONC provider display name reaches routing inventory');
    const compatibleProvider = inventory.opencode.items.find((item: { providerId: string; itemType: string }) => item.providerId === 'compat' && item.itemType === 'provider');
    assert.equal(compatibleProvider.capability, 'provider-routing', 'singular OpenCode provider schema remains supported');
    const model = inventory.opencode.items.find((item: { modelId: string }) => item.modelId === 'fleet/gpt-5.4');
    assert.equal(model.capability, 'model-inventory', 'OpenCode provider model is selectable');

    const selected = await routingApi.POST(request({ action: 'select', connector: 'opencode', itemIds: [model.id], desiredRoute: 'direct' }));
    assert.equal(selected.status, 200, 'shared routing selection accepts OpenCode');

    await addProvider({ id: 'fixture-openrouter', name: 'Fixture OpenRouter', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'upstream-secret' });
    addModel('fixture-openrouter', 'openrouter/openai/gpt-5.4');
    syncProvidersToYaml({ db: getDb(), configPath: liteLlmConfigPath });
    const preparedInventoryResponse = await routingApi.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing', {
      headers: { origin: 'http://127.0.0.1:5001' },
    }));
    const preparedInventory = await preparedInventoryResponse.json();
    const preparedModel = preparedInventory.opencode.items.find((item: { modelId: string }) => item.modelId === 'fleet/gpt-5.4');
    assert.equal(preparedModel.metadata.proxyModelAlias, 'openrouter/openai/gpt-5.4', 'OpenCode explicit model id resolves to the loaded LiteLLM alias');
    globalThis.fetch = async input => {
      if (String(input).endsWith('/model/info')) {
        const { default: YAML } = await import('yaml');
        return Response.json({ data: YAML.parse(fs.readFileSync(liteLlmConfigPath, 'utf8')).model_list });
      }
      return Response.json({
        id: 'opencode-readiness',
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });
    };
    const readiness = await readinessApi.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers/fixture-openrouter/test', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'inference', modelAlias: 'openrouter/openai/gpt-5.4', approved: true }),
    }), { params: Promise.resolve({ id: 'fixture-openrouter' }) });
    assert.equal(readiness.status, 200, 'OpenCode model replacement is prepared through LiteLLM');

    assert.equal((await routingApi.POST(request({ action: 'select', connector: 'opencode', itemIds: [model.id], desiredRoute: 'routed' }))).status, 200);
    const reviewed = await routingApi.POST(request({ action: 'prepare', connector: 'opencode', sourceId: 'opencode:global', operation: 'apply' }));
    const review = await reviewed.json();
    assert.equal(reviewed.status, 200, 'OpenCode routing changes can be reviewed');
    assert.deepEqual(review.plan.prerequisites, []);
    const applied = await routingApi.POST(request({ action: 'execute-plan', planId: review.plan.id, approved: true }));
    const appliedBody = await applied.json();
    assert.equal(applied.status, 200, `reviewed OpenCode routing applies: ${JSON.stringify(appliedBody)}`);
    let configured = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(configured.providers.fleet.settings.baseURL, 'http://127.0.0.1:4001/v1');
    assert.equal(configured.providers.fleet.models['gpt-5.4'].modelID, 'openrouter/openai/gpt-5.4', 'OpenCode sends the exact loaded LiteLLM alias');
    assert.equal(configured.providers.fleet.settings.apiKey, 'fixture-only-litellm-key', 'routed OpenCode receives the local LiteLLM credential');
    assert.equal(typeof configured.providers.fleet.settings.headers['x-clawnex-routing-identity'], 'string');
    const routedInventoryResponse = await routingApi.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing', {
      headers: { origin: 'http://127.0.0.1:5001' },
    }));
    const routedInventory = await routedInventoryResponse.json();
    const routedModel = routedInventory.opencode.items.find((item: { modelId: string }) => item.modelId === 'fleet/gpt-5.4');
    assert.equal(routedModel.metadata.proxyModelAlias, 'openrouter/openai/gpt-5.4', 'routed inventory preserves the exact LiteLLM alias written into OpenCode');
    const sidecar = fs.readFileSync(process.env.CLAWNEX_OPENCODE_ROUTING_SIDECAR!, 'utf8');
    assert.ok(!sidecar.includes('upstream-secret'), 'OpenCode recovery journal contains no credential material');
    assert.ok(!sidecar.includes('fixture-only-litellm-key'), 'OpenCode recovery journal contains no proxy credential material');
    const unsafeRemoval = await connectorApi.DELETE(new NextRequest(`http://127.0.0.1:5001/api/config/coding-agent-connectors?id=${encodeURIComponent(addedConnector.connector.id)}`, {
      method: 'DELETE', headers: { origin: 'http://127.0.0.1:5001' },
    }));
    assert.equal(unsafeRemoval.status, 409, 'a routed OpenCode connector cannot be removed before restoration');

    const restoreReview = await routingApi.POST(request({ action: 'prepare', connector: 'opencode', sourceId: 'opencode:global', operation: 'restore' }));
    const restorePlan = await restoreReview.json();
    const restored = await routingApi.POST(request({ action: 'execute-plan', planId: restorePlan.plan.id, approved: true }));
    assert.equal(restored.status, 200, 'reviewed OpenCode restoration succeeds');
    configured = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(configured.providers.fleet.settings.baseURL, 'https://openrouter.ai/api/v1');
    assert.equal(configured.providers.fleet.settings.apiKey, 'upstream-secret', 'restoration returns the upstream credential');
    assert.equal(configured.providers.fleet.models['gpt-5.4'].modelID, 'openrouter/openai/gpt-5.4', 'restoration returns the original upstream model id');
    assert.equal(configured.providers.fleet.settings.headers, undefined, 'restoration removes only the managed identity header container');
    console.log('PASS: global OpenCode connector completes shared readiness, routing, and restoration lifecycle');
  } finally {
    globalThis.fetch = originalFetch;
    getDb().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
