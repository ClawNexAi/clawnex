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
  const modelRoutes = await import('../src/app/api/config/models/route');
  const { getDb } = await import('../src/lib/db');
  const originalFetch = globalThis.fetch;

  try {
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
    console.log('PASS: validated provider families satisfy add -> discover -> sync -> proxy-test contract');
  } finally {
    globalThis.fetch = originalFetch;
    getDb().close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
