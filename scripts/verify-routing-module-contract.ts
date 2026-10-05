import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-module-contract-'));
const configPath = path.join(root, 'proxy.yaml');
const originalFetch = globalThis.fetch;
const originalHomedir = os.homedir;
const originalNow = Date.now;
const originalRename = fs.renameSync;
const fixtureUserHome = path.join(root, 'user');
os.homedir = () => fixtureUserHome;
const unrelatedConfig = path.join(fixtureUserHome, '.openclaw', 'openclaw.json');
fs.mkdirSync(path.dirname(unrelatedConfig), { recursive: true });
const unrelatedBytes = JSON.stringify({ models: { providers: { unrelated: { baseUrl: 'http://127.0.0.1:19998/v1', models: [{ id: 'unrelated-model' }] } } } });
fs.writeFileSync(unrelatedConfig, unrelatedBytes);
const mode = process.argv[2] || 'openclaw-only';
assert(['openclaw-only', 'hermes-only', 'hermes-multi', 'hermes-primary', 'hermes-primary-empty'].includes(mode));
const scenario = process.argv[3] || 'shared-contract';
assert([
  'shared-contract', 'selection-during-validation', 'approval-expiry-during-validation',
  'retained-operation-lock', 'corrupt-ownership', 'publish-failure', 'missing-recovery',
  'restore-conflict', 'cross-route-identity', 'retired-ownership-evidence',
  'shared-model-routes', 'invalid-completions', 'refresh-and-historical-evidence', 'model-change-after-apply',
].includes(scenario));
const pairedRoutes = ['cross-route-identity', 'shared-model-routes'].includes(scenario);
if (pairedRoutes || scenario === 'model-change-after-apply') assert(['openclaw-only', 'hermes-only'].includes(mode));
const secondModel = scenario === 'shared-model-routes' ? 'fixture-model' : 'second-model';
const secondEndpoint = scenario === 'shared-model-routes' ? 'http://127.0.0.1:19999/v1' : 'http://127.0.0.1:19997/v1';
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
}, ...(pairedRoutes ? { second: {
  baseUrl: secondEndpoint, api: 'openai-completions', models: [{ id: secondModel }],
} } : {}) } } } : mode.startsWith('hermes-primary') ? {
  ...(mode === 'hermes-primary-empty' ? { custom_providers: [] } : {}),
  model: { provider: 'custom', default: 'fixture-model', base_url: 'http://127.0.0.1:19999/v1' },
} : {
  custom_providers: [{ name: 'fixture', base_url: 'http://127.0.0.1:19999/v1', api_mode: 'chat_completions', models: ['fixture-model'] },
    ...(pairedRoutes ? [{ name: 'second', base_url: secondEndpoint, api_mode: 'chat_completions', models: [secondModel] }] : [])],
  model: { provider: 'fixture', default: 'fixture-model', base_url: 'http://127.0.0.1:19999/v1', api_mode: 'chat_completions' },
  ...(pairedRoutes ? { auxiliary: { second: { provider: 'second', default: secondModel } } } : {}),
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
    if (scenario === 'model-change-after-apply') addModel('fixture', 'second-model');
    if (scenario === 'cross-route-identity') {
      await addProvider({ id: 'second', name: 'Second fixture', type: 'lmstudio', baseUrl: 'http://127.0.0.1:19997/v1' });
      addModel('second', 'second-model');
    }
    syncProvidersToYaml({ db: getDb(), configPath });
    globalThis.fetch = async input => {
      if (String(input).endsWith('/model/info')) return Response.json({ data: YAML.parse(fs.readFileSync(configPath, 'utf8')).model_list });
      assert.equal(String(input), 'http://127.0.0.1:4001/v1/chat/completions', 'Only the fake proxy inference endpoint is permitted');
      return Response.json({ id: 'fixture-completion', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
    };
    const ready = await probe.POST(request({ action: 'inference', modelAlias: 'fixture-model', approved: true }, '/api/config/providers/fixture/test'), { params: Promise.resolve({ id: 'fixture' }) });
    assert.equal(ready.status, 200, JSON.stringify(await ready.json()));
    if (scenario === 'cross-route-identity') {
      const secondReady = await probe.POST(request({ action: 'inference', modelAlias: 'second-model', approved: true }, '/api/config/providers/second/test'), { params: Promise.resolve({ id: 'second' }) });
      assert.equal(secondReady.status, 200, JSON.stringify(await secondReady.json()));
    }
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
    if (scenario === 'publish-failure') {
      const journal = connector === 'openclaw' ? process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR! : process.env.CLAWNEX_HERMES_ROUTING_SIDECAR!;
      let failedPublication = false;
      fs.renameSync = (from, to) => {
        if (String(to) === agentFile) {
          failedPublication = true;
          throw Object.assign(new Error('Fixture-only configuration publication failure'), { code: 'EIO' });
        }
        originalRename(from, to);
      };
      const failed = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
      fs.renameSync = originalRename;
      assert(failedPublication, 'The fault must occur at atomic configuration publication, not readiness');
      assert.equal(failed.status, 400);
      assert.equal(fs.readFileSync(agentFile, 'utf8'), before, 'Failed publication retains the original agent file');
      assert.equal(fs.statSync(journal).mode & 0o777, 0o600, 'Restricted recovery is durable before the failed configuration write');
      const retained = fs.readFileSync(journal, 'utf8');
      const retry = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
      assert.equal(retry.status, 400);
      assert.match(retry.data.error, /recovery review/i, 'A failed plan cannot silently retry after partial publication');
      assert.equal(fs.readFileSync(journal, 'utf8'), retained);
      assert.equal(fs.readFileSync(agentFile, 'utf8'), before);
      console.log(`PASS: ${mode} retains restricted recovery after publication failure and refuses blind retries`);
      return;
    }
    if (scenario === 'corrupt-ownership') {
      const journal = connector === 'openclaw' ? process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR! : process.env.CLAWNEX_HERMES_ROUTING_SIDECAR!;
      fs.writeFileSync(journal, '{fixture-corrupt-ownership', { mode: 0o600 });
      const corrupt = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
      assert.equal(corrupt.status, 400, 'Corrupt recovery is not the same as an unwired instance');
      assert.equal(fs.readFileSync(agentFile, 'utf8'), before);
      assert.equal(fs.readFileSync(journal, 'utf8'), '{fixture-corrupt-ownership', 'Unusable recovery must not be replaced with empty ownership');
      console.log(`PASS: ${mode} refuses corrupt recovery ownership without replacing it or changing settings`);
      return;
    }
    if (scenario === 'retained-operation-lock') {
      const journal = connector === 'openclaw' ? process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR! : process.env.CLAWNEX_HERMES_ROUTING_SIDECAR!;
      const lock = `${journal}.operation.lock`;
      fs.writeFileSync(lock, 'fixture-retained-recovery-lock', { mode: 0o600 });
      const locked = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
      assert.equal(locked.status, 400);
      assert.match(locked.data.error, /retained recovery lock|another routing operation/i);
      assert.equal(fs.readFileSync(agentFile, 'utf8'), before);
      assert.equal(fs.readFileSync(lock, 'utf8'), 'fixture-retained-recovery-lock', 'A retained interrupted-operation lock cannot be removed to force success');
      assert.equal(fs.existsSync(journal), false);
      console.log(`PASS: ${mode} refuses a retained recovery lock without touching settings or removing the lock`);
      return;
    }
    if (['selection-during-validation', 'approval-expiry-during-validation'].includes(scenario)) {
      const fixtureFetch = globalThis.fetch;
      let changedDuringValidation = false;
      globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/model/info') && !changedDuringValidation) {
          changedDuringValidation = true;
          if (scenario === 'selection-during-validation') {
            const changed = await post({ action: 'select', connector, itemIds, desiredRoute: 'direct' });
            assert.equal(changed.status, 200, 'The operator can withdraw a proposed route while readiness is checked');
          } else {
            Date.now = () => Date.parse(reviewed.data.plan.expiresAt) + 1;
          }
        }
        return fixtureFetch(input, init);
      };
      const raced = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
      assert(changedDuringValidation, 'The test must exercise the asynchronous loaded-deployment check');
      assert.equal(raced.status, 400, `Apply must reject ${scenario} before mutation`);
      assert.match(raced.data.error, scenario === 'selection-during-validation' ? /changed since review/i : /review expired/i);
      assert.equal(fs.readFileSync(agentFile, 'utf8'), before, 'A stale reviewed plan cannot write agent settings');
      assert.equal(fs.existsSync(connector === 'openclaw' ? process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR! : process.env.CLAWNEX_HERMES_ROUTING_SIDECAR!), false, 'A rejected stale approval cannot create recovery ownership');
      console.log(`PASS: ${mode} rejects ${scenario} before mutation`);
      return;
    }
    const applied = await post({ action: 'execute-plan', planId: reviewed.data.plan.id, approved: true });
    assert.equal(applied.status, 200);
    assert.equal(applied.data.result.sourceId, sourceId);
    assert.equal(applied.data.result.restartRequired, true);
    const routed = readConfig();
    assert.equal(connector === 'openclaw' ? routed.models.providers.fixture.baseUrl : routed.model.base_url, 'http://127.0.0.1:4001/v1');
    if (peerBefore !== null) assert.equal(fs.readFileSync(peerFile, 'utf8'), peerBefore, 'Apply does not touch another instance sharing the same provider/model');
    if (scenario === 'model-change-after-apply') {
      const inventory = async () => (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const completion = async (model: string, requestId: string) => {
        const current = await inventory();
        const owned = current[connector].items.find((item: { sourceId: string; itemType: string; modelId: string; metadata: { identityHash?: string } }) =>
          item.sourceId === sourceId && item.itemType === 'model' && item.modelId === model && item.metadata.identityHash);
        assert(owned?.metadata.identityHash);
        const response = await ingest.POST(new NextRequest('http://127.0.0.1:5001/api/proxy/ingest', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-clawnex-ingest-secret': process.env.CLAWNEX_INGEST_SECRET! },
          body: JSON.stringify({ direction: 'outbound', model, status_code: 200, shield_verdict: 'ALLOW',
            routing_connector: connector, routing_source_id: sourceId, routing_identity_hash: owned.metadata.identityHash, proxy_request_id: requestId }),
        }));
        assert.equal(response.status, 200);
      };
      await completion('fixture-model', 'fixture-original-reviewed-model');
      assert.equal((await post({ action: 'verify', connector, sourceId })).data.verification.status, 'verified');
      const expected = connector === 'openclaw' ? JSON.parse(serialize(original)) : YAML.parse(serialize(original));
      if (connector === 'openclaw') {
        routed.models.providers.fixture.models.push({ id: 'second-model' });
        expected.models.providers.fixture.models.push({ id: 'second-model' });
      } else {
        routed.auxiliary = { late: { provider: 'fixture', default: 'second-model' } };
        expected.auxiliary = { late: { provider: 'fixture', default: 'second-model' } };
      }
      fs.writeFileSync(agentFile, serialize(routed));
      await completion('second-model', 'fixture-model-added-without-reviewed-apply');
      const unreviewed = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.notEqual(unreviewed.status, 'verified', 'A model added after Apply is not part of the approved configuration, even with an intact instance identity');
      assert.match(unreviewed.detail, /review|approved|changed/i);
      const ready = await probe.POST(request({ action: 'inference', modelAlias: 'second-model', approved: true }, '/api/config/providers/fixture/test'), { params: Promise.resolve({ id: 'fixture' }) });
      assert.equal(ready.status, 200);
      const review = await post({ action: 'prepare', connector, sourceId, operation: 'apply' });
      assert.equal((await post({ action: 'execute-plan', planId: review.data.plan.id, approved: true })).status, 200);
      await completion('fixture-model', 'fixture-first-model-after-new-review');
      await completion('second-model', 'fixture-second-model-after-new-review');
      assert.equal((await post({ action: 'verify', connector, sourceId })).data.verification.status, 'verified');
      const restore = await post({ action: 'prepare', connector, sourceId, operation: 'restore' });
      assert.equal((await post({ action: 'execute-plan', planId: restore.data.plan.id, approved: true })).status, 200);
      assert.deepEqual(readConfig(), expected, 'Restoration preserves the operator-added model while restoring owned connection fields');
      console.log(`PASS: ${mode} requires reviewed configuration scope for new models and preserves the operator addition on Restore`);
      return;
    }
    if (scenario === 'refresh-and-historical-evidence') {
      const refreshed = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const owned = refreshed[connector].items.find((item: { sourceId: string; itemType: string; metadata: { identityHash?: string } }) =>
        item.sourceId === sourceId && item.itemType === 'model' && item.metadata.identityHash);
      assert(owned?.metadata.identityHash);
      const callback = async (requestId: string) => {
        const response = await ingest.POST(new NextRequest('http://127.0.0.1:5001/api/proxy/ingest', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-clawnex-ingest-secret': process.env.CLAWNEX_INGEST_SECRET! },
          body: JSON.stringify({ direction: 'outbound', model: 'fixture-model', status_code: 200, shield_verdict: 'ALLOW',
            routing_connector: connector, routing_source_id: sourceId, routing_identity_hash: owned.metadata.identityHash, proxy_request_id: requestId }),
        }));
        assert.equal(response.status, 200);
      };
      await callback('fixture-before-later-operation');
      const baseline = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.equal(baseline.status, 'verified');
      assert.equal((await post({ action: 'sync' })).status, 200);
      await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'));
      const afterRefresh = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.equal(afterRefresh.status, 'verified');
      assert.equal(afterRefresh.verificationSince, baseline.verificationSince, 'Unchanged refresh and repeated Verify cannot move the operation baseline');
      assert.equal(afterRefresh.observedThroughClawNex, 1);
      // Keep the two real clock instants distinct beyond SQLite's date precision.
      await new Promise(resolve => setTimeout(resolve, 20));
      const laterPlan = await post({ action: 'prepare', connector, sourceId, operation: 'apply' });
      assert.equal((await post({ action: 'execute-plan', planId: laterPlan.data.plan.id, approved: true })).status, 200);
      const historical = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.equal(historical.status, 'pending-traffic', 'A prior operation completion cannot verify a later explicit Apply');
      assert.notEqual(historical.verificationSince, baseline.verificationSince);
      assert.equal(historical.observedThroughClawNex, 0);
      await callback('fixture-after-later-operation');
      assert.equal((await post({ action: 'verify', connector, sourceId })).data.verification.status, 'verified');
      const restore = await post({ action: 'prepare', connector, sourceId, operation: 'restore' });
      assert.equal((await post({ action: 'execute-plan', planId: restore.data.plan.id, approved: true })).status, 200);
      assert.deepEqual(readConfig(), original);
      console.log(`PASS: ${mode} keeps refresh baselines stable and requires fresh proof after later operator changes`);
      return;
    }
    if (scenario === 'invalid-completions') {
      const refreshed = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const owned = refreshed[connector].items.find((item: { sourceId: string; itemType: string; metadata: { identityHash?: string } }) =>
        item.sourceId === sourceId && item.itemType === 'model' && item.metadata.identityHash);
      assert(owned?.metadata.identityHash);
      const callback = async (overrides: Record<string, unknown>, secret = process.env.CLAWNEX_INGEST_SECRET!) => ingest.POST(new NextRequest('http://127.0.0.1:5001/api/proxy/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-clawnex-ingest-secret': secret },
        body: JSON.stringify({ direction: 'outbound', model: 'fixture-model', status_code: 200, shield_verdict: 'ALLOW',
          routing_connector: connector, routing_source_id: sourceId, routing_identity_hash: owned.metadata.identityHash,
          proxy_request_id: 'fixture-rejected-completion', ...overrides }),
      }));
      assert.equal((await callback({}, 'fixture-wrong-ingest-secret')).status, 401);
      const rejected: Array<[string, Record<string, unknown>]> = [
        ['another instance', { routing_source_id: `${sourceId}:other` }],
        ['inbound request', { direction: 'inbound' }],
        ['upstream failure', { status_code: 500, error: 'fixture upstream failure' }],
        ['blocked response', { blocked: true, shield_verdict: 'BLOCK' }],
        ['bypassed response', { shield_verdict: 'BYPASSED' }],
        ['completion carrying an error', { error: 'fixture completion error' }],
        ['missing signed identity', { routing_identity_hash: undefined }],
        ['watcher labels only', { source: `${connector}-watcher`, routing_connector: undefined, routing_source_id: undefined }],
      ];
      for (const [label, overrides] of rejected) {
        assert.equal((await callback(overrides)).status, 200, label);
        const verification = (await post({ action: 'verify', connector, sourceId })).data.verification;
        assert.equal(verification.status, 'pending-traffic', `${label} cannot become successful agent-routing proof`);
        assert.equal(verification.observedThroughClawNex, 0, label);
      }
      assert.equal((await callback({ proxy_request_id: 'fixture-valid-after-rejected-completions' })).status, 200);
      const verified = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.equal(verified.status, 'verified');
      assert.equal(verified.observedThroughClawNex, 1);
      const restore = await post({ action: 'prepare', connector, sourceId, operation: 'restore' });
      assert.equal((await post({ action: 'execute-plan', planId: restore.data.plan.id, approved: true })).status, 200);
      assert.deepEqual(readConfig(), original);
      console.log(`PASS: ${mode} rejects unauthenticated, watcher-only, wrong-instance, failed, inbound, blocked, bypassed and unsigned proof`);
      return;
    }
    if (scenario === 'retired-ownership-evidence') {
      const refreshed = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const owned = refreshed[connector].items.find((item: { sourceId: string; itemType: string; metadata: { identityHash?: string } }) =>
        item.sourceId === sourceId && item.itemType === 'model' && item.metadata.identityHash);
      assert(owned?.metadata.identityHash);
      fs.renameSync(applied.data.result.sidecarPath, `${applied.data.result.sidecarPath}.fixture-backup`);
      const routedBytes = fs.readFileSync(agentFile, 'utf8');
      const retired = await ingest.POST(new NextRequest('http://127.0.0.1:5001/api/proxy/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-clawnex-ingest-secret': process.env.CLAWNEX_INGEST_SECRET! },
        body: JSON.stringify({ direction: 'outbound', model: 'fixture-model', status_code: 200, shield_verdict: 'ALLOW',
          routing_connector: connector, routing_source_id: sourceId, routing_identity_hash: owned.metadata.identityHash, proxy_request_id: 'fixture-retired-ownership-completion' }),
      }));
      assert.equal(retired.status, 200);
      const verified = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.equal(verified.status, 'pending-traffic', 'A retired identity cannot verify routing after ownership disappears');
      assert.equal(verified.observedThroughClawNex, 0);
      assert.match(verified.detail, /ownership|identity|recovery/i, 'Missing ownership must be reported as recovery work, not a request to send more traffic');
      assert.equal(fs.readFileSync(agentFile, 'utf8'), routedBytes);
      console.log(`PASS: ${mode} refuses retired identity evidence when current recovery ownership is unavailable`);
      return;
    }
    if (pairedRoutes) {
      const refreshed = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const ownedModel = (providerId: string) => refreshed[connector].items.find((item: { present: boolean; sourceId: string; providerId: string; itemType: string; metadata: { identityHash?: string } }) =>
        item.present && item.sourceId === sourceId && item.providerId === providerId && item.itemType === 'model' && item.metadata.identityHash);
      const first = ownedModel('fixture'), second = ownedModel('second');
      assert(first?.metadata.identityHash && second?.metadata.identityHash);
      assert.notEqual(first.metadata.identityHash, second.metadata.identityHash, 'Provider routes have independent ownership identities');
      const callback = async (model: string, identityHash: string, requestId: string) => {
        const response = await ingest.POST(new NextRequest('http://127.0.0.1:5001/api/proxy/ingest', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-clawnex-ingest-secret': process.env.CLAWNEX_INGEST_SECRET! },
          body: JSON.stringify({ direction: 'outbound', model, status_code: 200, shield_verdict: 'ALLOW',
            routing_connector: connector, routing_source_id: sourceId, routing_identity_hash: identityHash, proxy_request_id: requestId }),
        }));
        assert.equal(response.status, 200);
      };
      await callback('fixture-model', first.metadata.identityHash, 'fixture-correct-first-route');
      assert.equal((await post({ action: 'verify', connector, sourceId })).data.verification.status, 'partial-traffic', 'One attested provider route cannot verify a peer using the same model alias');
      const partialInventory = await (await api.GET(new NextRequest('http://127.0.0.1:5001/api/connector-routing'))).json();
      const pendingPeerEvents = partialInventory.reconciliation.events.filter((event: { connector: string; sourceId: string; current?: { providerId: string; effectiveRoute: string } }) =>
        event.connector === connector && event.sourceId === sourceId && event.current?.providerId === 'second' && event.current.effectiveRoute === 'routed');
      assert(pendingPeerEvents.length > 0, 'The pending peer route has visible unresolved reconciliation evidence');
      assert(pendingPeerEvents.every((event: { protectionState: string }) => event.protectionState !== 'protected-and-verified'), 'A peer event cannot be promoted using another route identity');
      await callback(secondModel, first.metadata.identityHash, 'fixture-wrong-route-identity');
      const wrongRoute = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.equal(wrongRoute.status, 'partial-traffic', 'Another provider identity on the same instance cannot verify this model');
      assert.equal(wrongRoute.observedThroughClawNex, scenario === 'shared-model-routes' ? 2 : 1, 'Evidence accounting counts only completed requests valid for their own model/identity binding');
      await callback(secondModel, second.metadata.identityHash, 'fixture-correct-second-route');
      const verified = (await post({ action: 'verify', connector, sourceId })).data.verification;
      assert.equal(verified.status, 'verified');
      assert.equal(verified.observedThroughClawNex, scenario === 'shared-model-routes' ? 3 : 2);
      const restore = await post({ action: 'prepare', connector, sourceId, operation: 'restore' });
      assert.equal((await post({ action: 'execute-plan', planId: restore.data.plan.id, approved: true })).status, 200);
      assert.deepEqual(readConfig(), original);
      console.log(`PASS: ${mode} binds successful model evidence to its own provider identity and restores both routes`);
      return;
    }
    if (scenario === 'restore-conflict') {
      const operatorEndpoint = 'https://operator-edited.example.test/v1';
      if (connector === 'openclaw') routed.models.providers.fixture.baseUrl = operatorEndpoint;
      else routed.model.base_url = operatorEndpoint;
      fs.writeFileSync(agentFile, serialize(routed));
      const restore = await post({ action: 'prepare', connector, sourceId, operation: 'restore' });
      assert.equal(restore.status, 200);
      const conflict = await post({ action: 'execute-plan', planId: restore.data.plan.id, approved: true });
      assert.equal(conflict.status, 409, 'A conflicting operator edit is a partial/error result, not successful restoration');
      assert.equal(conflict.data.result.ok, false);
      assert(conflict.data.result.skippedProviders.length > 0);
      const preserved = readConfig();
      assert.equal(connector === 'openclaw' ? preserved.models.providers.fixture.baseUrl : preserved.model.base_url, operatorEndpoint);
      assert(JSON.parse(fs.readFileSync(applied.data.result.sidecarPath, 'utf8')).providers.length > 0, 'Unresolved recovery ownership must survive the conflict');
      if (peerBefore !== null) assert.equal(fs.readFileSync(peerFile, 'utf8'), peerBefore);
      console.log(`PASS: ${mode} reports Restore conflicts while preserving operator edits and unresolved ownership`);
      return;
    }
    if (scenario === 'missing-recovery') {
      const journal = applied.data.result.sidecarPath;
      const retained = `${journal}.fixture-backup`;
      const owned = fs.readFileSync(journal, 'utf8');
      fs.renameSync(journal, retained);
      const routedBytes = fs.readFileSync(agentFile, 'utf8');
      const restore = await post({ action: 'prepare', connector, sourceId, operation: 'restore' });
      assert.equal(restore.status, 200);
      const result = await post({ action: 'execute-plan', planId: restore.data.plan.id, approved: true });
      assert.equal(result.status, 409, 'Restore cannot report success while a routed instance has lost its recovery ownership');
      assert.equal(result.data.result.ok, false);
      assert.match(result.data.result.detail, /recovery|ownership/i);
      assert.equal(fs.readFileSync(agentFile, 'utf8'), routedBytes, 'No original settings can be guessed from a missing recovery journal');
      assert.equal(fs.readFileSync(retained, 'utf8'), owned);
      assert.equal(fs.existsSync(journal), false, 'Missing ownership is not recreated with speculative original settings');
      console.log(`PASS: ${mode} reports missing-recovery Restore as incomplete and preserves routed settings`);
      return;
    }
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
  Date.now = originalNow;
  fs.renameSync = originalRename;
  fs.rmSync(root, { recursive: true, force: true });
});
