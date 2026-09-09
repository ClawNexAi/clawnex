import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.CLAWNEX_INGEST_SECRET = 'fixture-only-routing-identity-secret-32-bytes';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';
const originalFetch = globalThis.fetch;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-inference-api-'));
const configPath = path.join(temp, 'config.yaml');
process.env.OPENCLAW_HOME = path.join(temp, 'openclaw');
process.env.HERMES_HOME = path.join(temp, 'hermes');
process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR = path.join(temp, 'openclaw-managed.json');
process.env.CLAWNEX_LEGACY_ROUTING_SIDECAR = path.join(temp, 'legacy-managed.json');
process.env.CLAWNEX_HERMES_ROUTING_SIDECAR = path.join(temp, 'hermes-managed.json');
fs.mkdirSync(process.env.OPENCLAW_HOME);
const agentConfig = path.join(process.env.OPENCLAW_HOME, 'openclaw.json');
fs.writeFileSync(agentConfig, JSON.stringify({ models: { providers: { fixture: {
  baseUrl: 'http://127.0.0.1:19999/v1', models: [{ id: 'fixture-model' }],
} } } }));
fs.writeFileSync(configPath, 'model_list: []\n');
process.env.CLAWNEX_LITELLM_CONFIG = configPath;
delete process.env.LITELLM_CONFIG_PATH;

async function main() {
  const { NextRequest } = await import('next/server');
  const { getDb } = await import('../src/lib/db');
  const { addProvider, addModel } = await import('../src/lib/services/config-service');
  const { syncProvidersToYaml } = await import('../src/lib/litellm/sync');
  const { hasCurrentProviderReadiness } = await import('../src/lib/services/provider-routing-readiness');
  const { POST } = await import('../src/app/api/config/providers/[id]/test/route');
  const routing = await import('../src/lib/services/connector-routing-inventory');
  const routingApi = await import('../src/app/api/connector-routing/route');
  const workflow = await import('../src/lib/services/routing-workflow');
  try {
    await addProvider({ id: 'fixture', name: 'Fixture', type: 'lmstudio', baseUrl: 'http://127.0.0.1:19999/v1' });
    addModel('fixture', 'fixture-model');
    syncProvidersToYaml({ db: getDb(), configPath });
    const inventory = routing.syncConnectorRoutingInventory();
    const model = inventory.openclaw.items.find(item => item.modelId === 'fixture-model')!;
    routing.setConnectorRoutingSelections('openclaw', [model.id], 'routed');
    const applyRequest = () => new NextRequest('http://127.0.0.1:5001/api/connector-routing', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'apply-openclaw' }),
    });
    const blockedApply = await routingApi.POST(applyRequest());
    assert.equal(blockedApply.status, 409);
    assert.equal(JSON.parse(fs.readFileSync(agentConfig, 'utf8')).models.providers.fixture.baseUrl, 'http://127.0.0.1:19999/v1');
    let count = 0;
    globalThis.fetch = async input => {
      count++;
      if (String(input).endsWith('/model/info')) return Response.json({ data: YAML.parse(fs.readFileSync(configPath, 'utf8')).model_list });
      assert.equal(String(input), 'http://127.0.0.1:4001/v1/chat/completions');
      return Response.json({
        id: 'fixture-request',
        choices: [{ message: { content: null, reasoning_content: 'The requested reply is OK.' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 8, completion_tokens: 16, total_tokens: 24 },
      });
    };
    const request = (approved: boolean) => new NextRequest('http://127.0.0.1:5001/api/config/providers/fixture/test', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'inference', modelAlias: 'fixture-model', approved }),
    });
    const denied = await POST(request(false), { params: Promise.resolve({ id: 'fixture' }) });
    assert.equal(denied.status, 409);
    assert.equal(count, 0);
    const response = await POST(request(true), { params: Promise.resolve({ id: 'fixture' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ready, true);
    assert.equal(hasCurrentProviderReadiness('fixture', 'fixture-model'), true);
    const plan = workflow.prepareRoutingPlan('openclaw', 'default', 'apply');
    assert.equal(plan.prerequisites.length, 0);
    await assert.rejects(() => workflow.executeRoutingPlan(plan.id, false, 'fixture'), /approve/i);
    const originalConfig = fs.readFileSync(agentConfig, 'utf8');
    fs.appendFileSync(agentConfig, '\n');
    await assert.rejects(() => workflow.executeRoutingPlan(plan.id, true, 'fixture'), /changed/i);
    fs.writeFileSync(agentConfig, originalConfig);
    const readyFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      assert.equal(fs.existsSync(`${process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR}.operation.lock`), true,
        'Live deployment validation runs while the instance routing lock is held');
      return Response.json({ data: [] });
    };
    await assert.rejects(() => workflow.executeRoutingPlan(plan.id, true, 'fixture'), /loaded proxy deployment changed/i);
    assert.equal(fs.readFileSync(agentConfig, 'utf8'), originalConfig, 'A stale live proxy cannot change the agent even when the disk receipt is fresh');
    globalThis.fetch = readyFetch;
    const applied = await workflow.executeRoutingPlan(plan.id, true, 'fixture');
    assert.equal(applied.ok, true);
    const wiredConfig = JSON.parse(fs.readFileSync(agentConfig, 'utf8'));
    const identityToken = wiredConfig.models.providers.fixture.headers['x-clawnex-routing-identity'];
    assert.equal(typeof identityToken, 'string');
    assert.equal(fs.readFileSync(process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR!, 'utf8').includes(identityToken), false, 'Journal stores a fingerprint, never the identity token');
    assert.equal(routing.syncConnectorRoutingInventory().openclaw.items.find(item => item.modelId === 'fixture-model')?.metadata.identityIntact, true);
    assert.equal(JSON.parse(fs.readFileSync(agentConfig, 'utf8')).models.providers.fixture.baseUrl, 'http://127.0.0.1:4001/v1');
    assert.equal((await workflow.executeRoutingPlan(plan.id, true, 'fixture')).operationId, applied.operationId);
    const loadedProxyConfig = fs.readFileSync(configPath, 'utf8');
    fs.appendFileSync(configPath, '# invalidate an already-routed model\n');
    routing.syncConnectorRoutingInventory();
    assert(workflow.prepareRoutingPlan('openclaw', 'default', 'apply').prerequisites.length > 0,
      'Already-routed providers remain blocked when their exact proxy readiness expires');
    fs.writeFileSync(configPath, loadedProxyConfig);
    const restore = workflow.prepareRoutingPlan('openclaw', 'default', 'restore');
    assert.equal((await workflow.executeRoutingPlan(restore.id, true, 'fixture')).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(agentConfig, 'utf8')).models.providers.fixture.baseUrl, 'http://127.0.0.1:19999/v1');
    assert.equal(JSON.parse(fs.readFileSync(agentConfig, 'utf8')).models.providers.fixture.headers, undefined, 'Restoration removes only the managed identity header');
    console.log('PASS: reviewed plans enforce approval, reject stale files, replay repeats, and restore direct routing');
    fs.appendFileSync(configPath, '# changed after approval\n');
    assert.equal(hasCurrentProviderReadiness('fixture', 'fixture-model'), false);
    console.log('PASS: approved inference API records readiness and invalidates it on configuration changes');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(temp, { recursive: true, force: true });
});
