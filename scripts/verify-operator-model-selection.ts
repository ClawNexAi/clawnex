import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-model-selection-'));
Object.assign(process.env, { DATABASE_PATH: path.join(temp, 'test.db'), CLAWNEX_TEST_SKIP_DB_SEED: '1',
  CLAWNEX_AUDIT_STDOUT: 'false', RBAC_ENABLED: 'false', NEXT_PUBLIC_RBAC_ENABLED: 'false', HOSTNAME: '127.0.0.1',
  CLAWNEX_LITELLM_CONFIG: path.join(temp, 'litellm.yaml') });
fs.writeFileSync(process.env.CLAWNEX_LITELLM_CONFIG!, 'model_list: []\n');
async function main() {
  const { getDb, queryAll } = await import('../src/lib/db');
  const svc = await import('../src/lib/services/config-service');
  const { NextRequest } = await import('next/server');
  const providers = await import('../src/app/api/config/providers/route');
  const originalFetch = globalThis.fetch;
  const types = ['openai', 'openrouter', 'anthropic', 'nvidia-nim', 'openai-compatible', 'lmstudio'];
  const request = (url: string, body: unknown) => new NextRequest(`http://127.0.0.1:5001${url}`, {
    method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const type of types) {
      const response = await providers.POST(request('/api/config/providers', { id: `api-${type}`, name: type, type, baseUrl: 'http://127.0.0.1:19999/v1' }));
      assert.equal(response.status, 201);
      assert.deepEqual(svc.getProvider(`api-${type}`)?.models, [], `${type}: API must not select models`);
      const cli = spawnSync(process.execPath, ['scripts/register-provider.cjs'], { encoding: 'utf8', env: { ...process.env,
        PROVIDER_NAME: `cli-${type}`, PROVIDER_TYPE: type, PROVIDER_BASE_URL: 'http://127.0.0.1:19999/v1', PROVIDER_MODEL_ID: '' } });
      assert.equal(cli.status, 0, cli.stderr);
    }
    assert.equal(queryAll('SELECT * FROM config_models').length, 0);
    svc.addModel('api-openai', 'gpt-4o');
    const selected = spawnSync(process.execPath, ['scripts/register-provider.cjs'], { encoding: 'utf8', env: { ...process.env,
      PROVIDER_NAME: 'explicit-selection', PROVIDER_TYPE: 'openai', PROVIDER_BASE_URL: 'http://127.0.0.1:19999/v1', PROVIDER_MODEL_ID: 'operator-selected-model' } });
    assert.equal(selected.status, 0, selected.stderr);
    assert.deepEqual(queryAll<{ model_id: string }>('SELECT model_id FROM config_models ORDER BY model_id').map(r => r.model_id), ['gpt-4o', 'operator-selected-model']);
    // Exercise the actual installer provider block without running installation.
    const setup = fs.readFileSync('setup.sh', 'utf8');
    const block = setup.slice(setup.indexOf('PROVIDER_REG_NAME=""'), setup.indexOf('# Generate LiteLLM master key'));
    for (const choice of ['1', '2', '3', '4', '5']) {
      const out = path.join(temp, `installer-${choice}.yaml`);
      const result = spawnSync('bash', ['-c', 'set -eu\nread_api_key() { printf -v "$1" fixture-key; }\n_tty_read() { printf -v "$2" ""; }\n' + block], {
        encoding: 'utf8', env: { ...process.env, PROVIDER_SELECT: choice, LITELLM_CONFIG_FILE: out },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(fs.readFileSync(out, 'utf8'), /model_list: \[\]/);
      assert(!fs.readFileSync(out, 'utf8').includes('model_name:'));
    }
    const demo = spawnSync('bash', ['deploy/demo-traffic.sh'], { encoding: 'utf8' });
    assert.equal(demo.status, 1); assert.match(demo.stderr, /--model/);
    const did = await import('../src/app/api/voice/did/route');
    const speech = await import('../src/app/api/voice/speak/route');
    svc.setSetting('did_api_key', 'fixture-key');
    svc.setSetting('elevenlabs_api_key', 'fixture-key'); svc.setSetting('voice_provider', 'elevenlabs');
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Unconfigured model must not make a network call'); };
    assert.equal((await did.POST(request('/api/voice/did', { action: 'create_agent' }))).status, 400);
    assert.equal((await speech.POST(request('/api/voice/speak', { text: 'Test' }))).status, 400);
    assert.equal(calls, 0);
    svc.setSetting('did_llm_provider', 'operator-provider'); svc.setSetting('did_llm_model', 'operator-avatar-model');
    svc.setSetting('elevenlabs_model_id', 'operator-speech-model');
    globalThis.fetch = async (url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      if (String(url).includes('api.d-id.com')) {
        assert.equal(payload.llm.provider, 'operator-provider'); assert.equal(payload.llm.model, 'operator-avatar-model');
        return Response.json({ id: 'fixture-agent', status: 'created' });
      }
      assert.equal(payload.model_id, 'operator-speech-model');
      return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } });
    };
    assert.equal((await did.POST(request('/api/voice/did', { action: 'create_agent' }))).status, 200);
    assert.equal((await speech.POST(request('/api/voice/speak', { text: 'Test' }))).status, 200);
    assert.equal(calls, 2);
    console.log('PASS: all provider types start empty; explicit choices survive; installer selects no models; demo and voice require operator-selected models.');
  } finally { globalThis.fetch = originalFetch; getDb().close(); fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
