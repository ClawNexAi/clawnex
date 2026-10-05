/**
 * Provider onboarding contract: add -> discover -> sync -> proxy inference.
 *
 * Uses the real API routes, an in-memory database, a temporary LiteLLM YAML,
 * and mocked provider/proxy responses. No external requests or service restarts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-provider-onboarding-'));
const configPath = path.join(temporaryDirectory, 'config.yaml');
process.env.CLAWNEX_LITELLM_CONFIG = configPath;
delete process.env.LITELLM_CONFIG_PATH;
fs.writeFileSync(configPath, 'model_list: []\n');

const cases = [
  { id: 'lmstudio-fixture', type: 'lmstudio', port: 19101, model: 'qwen/qwen3-test', upstream: 'openai/qwen/qwen3-test', apiKey: '' },
  { id: 'compatible-fixture', type: 'openai-compatible', port: 19102, model: 'fixture-chat', upstream: 'openai/fixture-chat', apiKey: 'compatible-secret' },
  { id: 'openrouter-fixture', type: 'openrouter', port: 19103, model: 'openrouter/auto', upstream: 'openrouter/auto', apiKey: 'openrouter-secret' },
  { id: 'nvidia-fixture', type: 'nvidia-nim', port: 19104, model: 'nvidia/nemotron-fixture', upstream: 'nvidia_nim/nvidia/nemotron-fixture', apiKey: 'nvidia-secret' },
] as const;

async function main() {
  const { NextRequest } = await import('next/server');
  const providerRoutes = await import('../src/app/api/config/providers/route');
  const providerTestRoutes = await import('../src/app/api/config/providers/[id]/test/route');
  const providerDetailRoutes = await import('../src/app/api/config/providers/[id]/route');
  const modelRoutes = await import('../src/app/api/config/models/route');
  const { getDb } = await import('../src/lib/db');
  const { PROVIDER_CATALOG } = await import('../src/lib/provider-catalog');
  const originalFetch = globalThis.fetch;

  try {
    assert.deepEqual(PROVIDER_CATALOG.filter(provider => provider.enabled).map(provider => provider.type).sort(), cases.map(provider => provider.type).sort(), 'every enabled family has the complete public onboarding fixture');
    const yamlBefore = fs.readFileSync(configPath, 'utf8');
    const unsupported = await providerRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'unsupported-fixture', name: 'Unsupported', type: 'anthropic', baseUrl: 'http://127.0.0.1:19105/v1' }),
    }));
    assert.equal(unsupported.status, 400, 'untested native families cannot be added');
    assert.match((await unsupported.json()).error, /not supported.*tested|tested.*not supported/i);
    assert.equal(getDb().prepare('SELECT id FROM config_providers WHERE id = ?').get('unsupported-fixture'), undefined);
    assert.equal(fs.readFileSync(configPath, 'utf8'), yamlBefore, 'refused onboarding leaves working YAML untouched');
    for (const type of [...PROVIDER_CATALOG.filter(provider => !provider.enabled).map(provider => provider.type), 'unknown-provider', 'openrouter-extra', 42]) {
      const refused = await providerRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers', {
        method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'refused-fixture', name: 'Untested family', type, baseUrl: 'http://127.0.0.1:19105/v1' }),
      }));
      assert.equal(refused.status, 400, `${String(type)} is not silently treated as OpenAI-compatible`);
      assert.equal((await refused.json()).code, 'unsupported-provider-type');
    }
    const providerCount = getDb().prepare('SELECT COUNT(*) AS count FROM config_providers').get() as { count: number };
    assert.equal(providerCount.count, 0, 'all refused families leave the provider table unchanged');
    assert.equal(fs.readFileSync(configPath, 'utf8'), yamlBefore);
    getDb().prepare('INSERT INTO config_providers (id, name, type, base_url, api_key, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run('legacy-fixture', 'Legacy native provider', 'anthropic', 'http://127.0.0.1:19105/v1', 'legacy-secret');
    let unsupportedRequests = 0;
    globalThis.fetch = async () => { unsupportedRequests++; return Response.json({ data: [] }); };
    for (const body of [undefined, { action: 'inference', modelAlias: 'legacy-model', approved: true }]) {
      const tested = await providerTestRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers/legacy-fixture/test', {
        method: 'POST', headers: { origin: 'http://127.0.0.1:5001' }, ...(body ? { body: JSON.stringify(body) } : {}),
      }), { params: Promise.resolve({ id: 'legacy-fixture' }) });
      assert.equal(tested.status, 400, 'legacy unsupported discovery/readiness is refused before sending credentials');
      assert.equal((await tested.json()).code, 'unsupported-provider-type');
    }
    assert.equal(unsupportedRequests, 0);
    assert.ok(getDb().prepare('SELECT id FROM config_providers WHERE id = ?').get('legacy-fixture'), 'legacy record is preserved');
    const editedLegacy = await providerDetailRoutes.PATCH(new NextRequest('http://127.0.0.1:5001/api/config/providers/legacy-fixture', {
      method: 'PATCH', headers: { origin: 'http://127.0.0.1:5001' }, body: JSON.stringify({ name: 'Renamed legacy provider' }),
    }), { params: Promise.resolve({ id: 'legacy-fixture' }) });
    assert.equal(editedLegacy.status, 200, 'legacy records remain editable');
    const legacyBody = await editedLegacy.json();
    assert.equal(legacyBody.provider.type, 'anthropic');
    assert.ok(!JSON.stringify(legacyBody).includes('legacy-secret'));
    for (const provider of cases) {
      const baseUrl = `http://127.0.0.1:${provider.port}/v1/`;
      const created = await providerRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
        body: JSON.stringify({ id: provider.id, name: provider.type, type: provider.type, baseUrl, apiKey: provider.apiKey }),
      }));
      const creation = await created.json();
      assert.equal(created.status, 201, `${provider.type} can be added`);
      assert.equal(creation.configSynced, true, `${provider.type} save syncs LiteLLM configuration`);
      assert.ok(!JSON.stringify(creation).includes(provider.apiKey || 'never-match'), `${provider.type} response does not expose its credential`);

      const discoveryUrls: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        discoveryUrls.push(url);
        if (provider.type === 'openrouter' && url.endsWith('/key')) return Response.json({ label: 'fixture' });
        assert.equal(url, `${baseUrl}models`, `${provider.type} discovery preserves a trailing-slash API root`);
        const authorization = new Headers(init?.headers).get('authorization');
        assert.equal(authorization, provider.apiKey ? `Bearer ${provider.apiKey}` : null);
        return Response.json({ data: [{ id: provider.model.replace(/^openrouter\//, '') }] });
      };
      const discovered = await providerTestRoutes.POST(new NextRequest(`http://127.0.0.1:5001/api/config/providers/${provider.id}/test`, {
        method: 'POST', headers: { origin: 'http://127.0.0.1:5001' },
      }), { params: Promise.resolve({ id: provider.id }) });
      assert.equal(discovered.status, 200, `${provider.type} discovery succeeds`);
      assert.equal((await discovered.json()).status, 'connected');
      assert.equal(discoveryUrls.at(-1), `${baseUrl}models`);

      const modelSaved = await modelRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/models', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
        body: JSON.stringify({ provider_id: provider.id, model_id: provider.model }),
      }));
      assert.equal(modelSaved.status, 200, `${provider.type} model can be configured`);
      assert.equal((await modelSaved.json()).synced, true, `${provider.type} model save syncs LiteLLM configuration`);

      const loadedModels = YAML.parse(fs.readFileSync(configPath, 'utf8')).model_list;
      const configured = loadedModels.find((entry: { model_name?: string }) => entry.model_name === provider.model);
      assert.equal(configured?.litellm_params?.model, provider.upstream, `${provider.type} uses the expected LiteLLM adapter`);

      globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/model/info')) return Response.json({ data: loadedModels });
        assert.equal(String(input), 'http://127.0.0.1:4001/v1/chat/completions');
        assert.equal(JSON.parse(String(init?.body)).model, provider.model);
        return Response.json({
          id: `${provider.id}-response`,
          choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        });
      };
      const tested = await providerTestRoutes.POST(new NextRequest(`http://127.0.0.1:5001/api/config/providers/${provider.id}/test`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'inference', modelAlias: provider.model, approved: true }),
      }), { params: Promise.resolve({ id: provider.id }) });
      assert.equal(tested.status, 200, `${provider.type} proxy test succeeds`);
      assert.equal((await tested.json()).ready, true);
    }
    globalThis.fetch = async () => Response.json({ data: [{ id: { credential: 'must-not-leak' } }] });
    const malformed = await providerTestRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers/lmstudio-fixture/test', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001' },
    }), { params: Promise.resolve({ id: 'lmstudio-fixture' }) });
    const malformedResult = await malformed.json();
    assert.equal(malformedResult.status, 'error', 'malformed discovery is not a connected provider');
    assert.match(malformedResult.error, /invalid model catalog/i);
    assert.ok(!JSON.stringify(malformedResult).includes('must-not-leak'));
    getDb().prepare("UPDATE config_providers SET api_key = '' WHERE id = 'nvidia-fixture'").run();
    let unauthenticatedRequests = 0;
    globalThis.fetch = async () => { unauthenticatedRequests++; return Response.json({ data: [] }); };
    const unauthenticated = await providerTestRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers/nvidia-fixture/test', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001' },
    }), { params: Promise.resolve({ id: 'nvidia-fixture' }) });
    assert.equal((await unauthenticated.json()).status, 'error', 'required provider authentication is not optional');
    assert.equal(unauthenticatedRequests, 0, 'missing required credential is refused before any request');
    console.log('PASS: validated provider families satisfy add -> discover -> sync -> proxy-test contract');
  } finally {
    globalThis.fetch = originalFetch;
    getDb().close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
