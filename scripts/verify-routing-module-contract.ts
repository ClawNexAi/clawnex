import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-module-contract-'));
const configPath = path.join(root, 'proxy.yaml');
const originalFetch = globalThis.fetch;
const originalHomedir = os.homedir;
const fixtureUserHome = path.join(root, 'user');
os.homedir = () => fixtureUserHome;
const unrelatedConfig = path.join(fixtureUserHome, '.openclaw', 'openclaw.json');
fs.mkdirSync(path.dirname(unrelatedConfig), { recursive: true });
const unrelatedBytes = JSON.stringify({ models: { providers: { unrelated: { baseUrl: 'http://127.0.0.1:19998/v1', models: [{ id: 'unrelated-model' }] } } } });
fs.writeFileSync(unrelatedConfig, unrelatedBytes);
const mode = process.argv[2] || 'openclaw-only';
assert(['openclaw-only', 'hermes-only', 'hermes-multi', 'hermes-primary', 'hermes-primary-empty'].includes(mode));
const connector = mode === 'openclaw-only' ? 'openclaw' : 'hermes';
Object.assign(process.env, {
  DATABASE_PATH: ':memory:', CLAWNEX_TEST_SKIP_DB_SEED: '1', CLAWNEX_AUDIT_STDOUT: 'false',
  RBAC_ENABLED: 'false', NEXT_PUBLIC_RBAC_ENABLED: 'false', HOSTNAME: '127.0.0.1',
  CLAWNEX_INGEST_SECRET: 'fixture-only-module-contract-secret-32-bytes',
  OPENCLAW_HOME: path.join(root, 'openclaw'), HERMES_HOME: path.join(root, 'hermes'),
  CLAWNEX_LITELLM_CONFIG: configPath,
  CLAWNEX_SELECTIVE_ROUTING_SIDECAR: path.join(root, 'openclaw-managed.json'),
  CLAWNEX_LEGACY_ROUTING_SIDECAR: path.join(root, 'legacy-managed.json'),
  CLAWNEX_HERMES_ROUTING_SIDECAR: path.join(root, 'hermes-managed.json'),
});
delete process.env.LITELLM_CONFIG_PATH;
const agentFile = connector === 'openclaw' ? path.join(process.env.OPENCLAW_HOME!, 'openclaw.json') : path.join(process.env.HERMES_HOME!, 'config.yaml');
const original = connector === 'openclaw' ? { meta: {}, models: { providers: { fixture: {
  baseUrl: 'http://127.0.0.1:19999/v1', api: 'openai-completions', models: [{ id: 'fixture-model' }],
} } } } : mode.startsWith('hermes-primary') ? {
  ...(mode === 'hermes-primary-empty' ? { custom_providers: [] } : {}),
  model: { provider: 'custom', default: 'fixture-model', base_url: 'http://127.0.0.1:19999/v1' },
} : {
  custom_providers: [{ name: 'fixture', base_url: 'http://127.0.0.1:19999/v1', api_mode: 'chat_completions', models: ['fixture-model'] }],
  model: { provider: 'fixture', default: 'fixture-model', base_url: 'http://127.0.0.1:19999/v1', api_mode: 'chat_completions' },
};
const serialize = (value: unknown) => connector === 'openclaw' ? JSON.stringify(value) : YAML.stringify(value);
const readConfig = () => connector === 'openclaw' ? JSON.parse(fs.readFileSync(agentFile, 'utf8')) : YAML.parse(fs.readFileSync(agentFile, 'utf8'));
fs.mkdirSync(path.dirname(agentFile), { recursive: true });
fs.writeFileSync(agentFile, serialize(original));
const peerFile = path.join(process.env.HERMES_HOME!, 'profiles', 'second', 'config.yaml');
if (mode === 'hermes-multi') {
  fs.mkdirSync(path.dirname(peerFile), { recursive: true });
  fs.writeFileSync(peerFile, serialize(original));
}
fs.writeFileSync(configPath, 'model_list: []\n');

async function main() {
  const { NextRequest } = await import('next/server');
  const { getDb } = await import('../src/lib/db');
  const { addProvider, addModel } = await import('../src/lib/services/config-service');
  const { syncProvidersToYaml } = await import('../src/lib/litellm/sync');
  const api = await import('../src/app/api/connector-routing/route');
  const probe = await import('../src/app/api/config/providers/[id]/test/route');
  const ingest = await import('../src/app/api/proxy/ingest/route');
  const request = (body: Record<string, unknown>, url = '/api/connector-routing') => new NextRequest(`http://127.0.0.1:5001${url}`, {
    method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const post = async (body: Record<string, unknown>) => {
    const response = await api.POST(request(body));
    return { status: response.status, data: await response.json() };
  };
  try {
    await addProvider({ id: 'fixture', name: 'Fixture', type: 'lmstudio', baseUrl: 'http://127.0.0.1:19999/v1' });
    addModel('fixture', 'fixture-model');
    syncProvidersToYaml({ db: getDb(), configPath });
    globalThis.fetch = async input => {
      if (String(input).endsWith('/model/info')) return Response.json({ data: YAML.parse(fs.readFileSync(configPath, 'utf8')).model_list });
      assert.equal(String(input), 'http://127.0.0.1:4001/v1/chat/completions', 'Only the fake proxy inference endpoint is permitted');
      return Response.json({ id: 'fixture-completion', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
    };
    const ready = await probe.POST(request({ action: 'inference', modelAlias: 'fixture-model', approved: true }, '/api/config/providers/fixture/test'), { params: Promise.resolve({ id: 'fixture' }) });
    assert.equal(ready.status, 200, JSON.stringify(await ready.json()));
    const inventoryResponse = await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'));
    assert.equal(inventoryResponse.status, 200);
    const inventory = await inventoryResponse.json();
    const other = connector === 'openclaw' ? 'hermes' : 'openclaw';
    assert.equal(inventory[other].items.filter((item: { present: boolean }) => item.present).length, 0, `${connector} works without ${other} installed`);
    const sourceId = inventory[connector].items.find((item: { metadata: { configPath?: string } }) => item.metadata.configPath === agentFile).sourceId;
    const itemIds = inventory[connector].items.filter((item: { present: boolean; sourceId: string }) => item.present && item.sourceId === sourceId).map((item: { id: string }) => item.id);
    const peerBefore = mode === 'hermes-multi' ? fs.readFileSync(peerFile, 'utf8') : null;
    assert(itemIds.length > 0);
    assert.equal((await post({ action: 'select', connector, itemIds, desiredRoute: 'routed' })).status, 200);
    assert.equal((await post({ action: 'prepare', connector, operation: 'apply' })).status, 400, 'A stable instance is mandatory');
    const reviewed = await post({ action: 'prepare', connector, sourceId, operation: 'apply' });
    assert.equal(reviewed.status, 200);
    assert.deepEqual(reviewed.data.plan.prerequisites, []);
    assert.equal(reviewed.data.plan.sourceId, sourceId);
    const before = fs.readFileSync(agentFile, 'utf8');
    const denied = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: false });
    assert.equal(denied.status, 400);
    assert.equal(fs.readFileSync(agentFile, 'utf8'), before, 'Unapproved plans cannot write settings');
    const applied = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
    assert.equal(applied.status, 200);
    assert.equal(applied.data.result.sourceId, sourceId);
    assert.equal(applied.data.result.restartRequired, true);
    const routed = readConfig();
    assert.equal(connector === 'openclaw' ? routed.models.providers.fixture.baseUrl : routed.model.base_url, 'http://127.0.0.1:4001/v1');
    if (peerBefore !== null) assert.equal(fs.readFileSync(peerFile, 'utf8'), peerBefore, 'Apply does not touch another instance sharing the same provider/model');
    const replay = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
    assert.equal(replay.data.result.operationId, applied.data.result.operationId, 'Repeat submission replays the original operation');
    const verified = await post({ action: 'verify', connector, sourceId });
    assert.equal(verified.status, 200);
    assert.notEqual(verified.data.verification.status, 'verified', 'A configuration write and provider probe are not agent traffic');
    let peerSourceId: string | undefined;
    if (mode === 'hermes-multi') {
      peerSourceId = inventory.hermes.items.find((item: { metadata: { configPath?: string } }) => item.metadata.configPath === peerFile).sourceId;
      assert.notEqual(peerSourceId, sourceId, 'Instances sharing a model have distinct stable identities');
      const peerPlan = await post({ action: 'prepare', connector, sourceId: peerSourceId, operation: 'apply' });
      assert.equal(peerPlan.status, 200);
      assert.equal((await post({ action: 'execute-plan', planId: peerPlan.data.plan.id, approved: true })).status, 200);
      const refreshed = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const identity = (id: string) => refreshed.hermes.items.find((item: { sourceId: string; metadata: { identityHash?: string } }) => item.sourceId === id && item.metadata.identityHash)?.metadata.identityHash;
      assert(identity(sourceId));
      assert(identity(peerSourceId!));
      assert.notEqual(identity(sourceId), identity(peerSourceId!), 'Ownership identity cannot leak between instances');
      const evidence = await ingest.POST(new NextRequest('http://127.0.0.1:5001/api/proxy/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-clawnex-ingest-secret': process.env.CLAWNEX_INGEST_SECRET! },
        body: JSON.stringify({ direction: 'outbound', model: 'fixture-model', status_code: 200, shield_verdict: 'ALLOW',
          routing_connector: 'hermes', routing_source_id: sourceId, routing_identity_hash: identity(sourceId), proxy_request_id: 'fixture-instance-a-completion' }),
      }));
      assert.equal(evidence.status, 200);
      assert.equal((await post({ action: 'verify', connector, sourceId })).data.verification.status, 'verified', 'Authenticated fake callback evidence verifies its own instance');
      assert.equal((await post({ action: 'verify', connector, sourceId: peerSourceId })).data.verification.status, 'pending-traffic', 'Another instance sharing the same model cannot borrow its evidence');
    } else {
      const refreshed = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const ownedModel = refreshed[connector].items.find((item: { present: boolean; sourceId: string; itemType: string; metadata: { identityHash?: string } }) => item.present && item.sourceId === sourceId && item.itemType === 'model' && item.metadata.identityHash);
      assert(ownedModel?.metadata.identityHash);
      const evidence = await ingest.POST(new NextRequest('http://127.0.0.1:5001/api/proxy/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-clawnex-ingest-secret': process.env.CLAWNEX_INGEST_SECRET! },
        body: JSON.stringify({ direction: 'outbound', model: 'fixture-model', status_code: 200, shield_verdict: 'ALLOW',
          routing_connector: connector, routing_source_id: sourceId, routing_identity_hash: ownedModel.metadata.identityHash, proxy_request_id: 'fixture-single-instance-completion' }),
      }));
      assert.equal(evidence.status, 200);
      assert.equal((await post({ action: 'verify', connector, sourceId })).data.verification.status, 'verified', 'Both modules share the successful callback verification contract');
    }
    const restore = await post({ action: 'prepare', connector, sourceId, operation: 'restore' });
    assert.equal(restore.status, 200);
    assert.equal((await post({ action: 'execute-plan', planId: restore.data.plan.id, approved: true })).status, 200);
    assert.deepEqual(readConfig(), original, 'Reviewed Restore returns original settings');
    if (peerSourceId) {
      assert.equal(YAML.parse(fs.readFileSync(peerFile, 'utf8')).model.base_url, 'http://127.0.0.1:4001/v1', 'Restoring one instance retains the other instance route and ownership');
      const peerRestore = await post({ action: 'prepare', connector, sourceId: peerSourceId, operation: 'restore' });
      assert.equal(peerRestore.status, 200);
      assert.equal((await post({ action: 'execute-plan', planId: peerRestore.data.plan.id, approved: true })).status, 200);
      assert.deepEqual(YAML.parse(fs.readFileSync(peerFile, 'utf8')), original, 'Second instance can still restore its original settings');
    }
    const restoredBytes = fs.readFileSync(agentFile, 'utf8');
    assert.equal((await post({ action: 'prepare', connector, sourceId: 'remote:unsupported', operation: 'apply' })).status, 400, 'Unknown or remote sources cannot fall back to the local instance');
    assert.equal(fs.readFileSync(agentFile, 'utf8'), restoredBytes);
    assert.equal(fs.readFileSync(unrelatedConfig, 'utf8'), unrelatedBytes, 'An explicitly configured instance cannot modify another discovered home');
    const unsupported = readConfig();
    if (connector === 'openclaw') unsupported.models.providers.fixture.api = 'anthropic-messages';
    else {
      unsupported.model.api_mode = 'anthropic_messages';
      if (unsupported.custom_providers?.[0]) unsupported.custom_providers[0].api_mode = 'anthropic_messages';
    }
    fs.writeFileSync(agentFile, serialize(unsupported));
    const unsupportedBytes = fs.readFileSync(agentFile, 'utf8');
    const unsupportedInventory = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
    const unsupportedIds = unsupportedInventory[connector].items.filter((item: { present: boolean; sourceId: string }) => item.present && item.sourceId === sourceId).map((item: { id: string }) => item.id);
    assert(unsupportedIds.length > 0, 'An excluded protocol remains visible to the operator');
    assert.equal((await post({ action: 'select', connector, itemIds: unsupportedIds, desiredRoute: 'routed' })).status, 400, 'Unsupported protocols cannot be selected for writes');
    assert.equal(fs.readFileSync(agentFile, 'utf8'), unsupportedBytes);
    fs.writeFileSync(agentFile, serialize(connector === 'openclaw' ? { models: { providers: 'future-layout' } } : { custom_providers: { fixture: { endpoint: 'future-layout' } } }));
    const unknownLayout = fs.readFileSync(agentFile, 'utf8');
    await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'));
    assert.equal((await post({ action: 'prepare', connector, sourceId, operation: 'apply' })).status, 400, 'An unknown layout cannot produce a writable plan');
    assert.equal(fs.readFileSync(agentFile, 'utf8'), unknownLayout);
    console.log(`PASS: ${mode} refuses unsupported protocols/layouts and unknown remote targets without speculative writes`);
    console.log(`PASS: ${mode} public routing API enforces scoped review/approval, replay, honest verification and independent restoration`);
  } finally { getDb().close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  os.homedir = originalHomedir;
  fs.rmSync(root, { recursive: true, force: true });
});
