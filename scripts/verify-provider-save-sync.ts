/** Real route + memory DB + failing temporary filesystem; no running services. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';
const cwd = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-save-sync-'));
delete process.env.CLAWNEX_LITELLM_CONFIG;
delete process.env.LITELLM_CONFIG_PATH;
delete process.env.CLAWNEX_INSTALL_DIR;

async function main() {
  process.chdir(temp);
  fs.mkdirSync(path.join(temp, 'litellm', 'config.yaml'), { recursive: true });
  const { NextRequest } = await import('next/server');
  const { POST } = await import('../src/app/api/config/providers/route');
  const providerDetailRoute = await import('../src/app/api/config/providers/[id]/route');
  const providerTestRoute = await import('../src/app/api/config/providers/[id]/test/route');
  const { getProvider } = await import('../src/lib/services/config-service');
  const { getDb } = await import('../src/lib/db/index');
  try {
    const response = await POST(new NextRequest('http://127.0.0.1:5001/api/config/providers', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'save-sync-fixture', name: 'Fixture', type: 'openai',
        baseUrl: 'http://127.0.0.1:19999/v1', apiKey: 'fake-key-no-leak' }),
    }));
    const body = await response.json();
    assert.equal(response.status, 503, 'Sync failure must not return ordinary create success');
    assert.equal(body.saved, true, 'Tell the caller the DB save already occurred');
    assert.equal(body.configSynced, false);
    assert.equal(body.provider?.id, 'save-sync-fixture');
    assert.ok(getProvider('save-sync-fixture'), 'Do not pretend the provider was not saved');
    assert.ok(!JSON.stringify(body).includes('fake-key-no-leak'));
    assert.match(body.error, /saved.*sync/i);
    console.log('PASS: provider save reports partial failure without leaking credentials');
    fs.rmdirSync(path.join(temp, 'litellm', 'config.yaml')); // Empty test-owned failure fixture.
    const successful = await POST(new NextRequest('http://127.0.0.1:5001/api/config/providers', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'save-success-fixture', name: 'Local fixture', type: 'lmstudio',
        baseUrl: 'http://127.0.0.1:19998/v1' }),
    }));
    assert.equal(successful.status, 201);
    assert.equal((await successful.json()).configSynced, true);
    assert.ok(fs.statSync(path.join(temp, 'litellm', 'config.yaml')).isFile());
    console.log('PASS: successful save explicitly reports configuration synced');
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        assert.equal(String(input), 'http://127.0.0.1:19998/v1/models');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer rotated-key-no-leak');
        return Response.json({ data: [] });
      };
      const updated = await providerDetailRoute.PATCH(new NextRequest('http://127.0.0.1:5001/api/config/providers/save-success-fixture', {
        method: 'PATCH', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'rotated-key-no-leak' }),
      }), { params: Promise.resolve({ id: 'save-success-fixture' }) });
      const updateBody = await updated.json();
      assert.equal(updated.status, 200);
      assert.equal(updateBody.updated, true);
      assert.equal(updateBody.configSynced, true);
      assert.ok(!JSON.stringify(updateBody).includes('rotated-key-no-leak'));
      const tested = await providerTestRoute.POST(new NextRequest('http://127.0.0.1:5001/api/config/providers/save-success-fixture/test', {
        method: 'POST', headers: { origin: 'http://127.0.0.1:5001' },
      }), { params: Promise.resolve({ id: 'save-success-fixture' }) });
      assert.equal(tested.status, 200);
      assert.equal((await tested.json()).status, 'connected');
      console.log('PASS: provider API rotates credentials without returning the secret');
    } finally { globalThis.fetch = originalFetch; }
    const refused = await POST(new NextRequest('http://127.0.0.1:5001/api/config/providers', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'metadata-fixture', name: 'Unsafe fixture', type: 'openai',
        baseUrl: 'http://169.254.169.254/latest/meta-data', apiKey: 'fake-key-no-leak' }),
    }));
    const refusal = await refused.json();
    assert.equal(refused.status, 400, 'Rejected provider input is an actionable client error');
    assert.match(refusal.error, /link-local|metadata|reserved/i);
    assert.ok(!JSON.stringify(refusal).includes('fake-key-no-leak'));
    console.log('PASS: provider rejection returns its safe actionable reason');
    const { DELETE } = await import('../src/app/api/config/providers/[id]/route');
    fs.renameSync(path.join(temp, 'litellm', 'config.yaml'), path.join(temp, 'previous.yaml'));
    fs.mkdirSync(path.join(temp, 'litellm', 'config.yaml'));
    const removed = await DELETE(new NextRequest('http://127.0.0.1:5001/api/config/providers/save-success-fixture', {
      method: 'DELETE', headers: { origin: 'http://127.0.0.1:5001' },
    }), { params: Promise.resolve({ id: 'save-success-fixture' }) });
    const removal = await removed.json();
    assert.equal(removed.status, 503, 'Failed removal sync must not claim complete success');
    assert.equal(removal.removed, true);
    assert.equal(removal.configSynced, false);
    assert.equal(getProvider('save-success-fixture'), undefined);
    assert.match(removal.error, /may still/i);
    console.log('PASS: removal warns that stale proxy configuration may remain active');
    fs.rmdirSync(path.join(temp, 'litellm', 'config.yaml'));
    fs.renameSync(path.join(temp, 'previous.yaml'), path.join(temp, 'litellm', 'config.yaml'));
    const before = fs.readFileSync(path.join(temp, 'litellm', 'config.yaml'), 'utf8');
    process.env.CLAWNEX_LITELLM_CONFIG = path.join(temp, 'missing-explicit.yaml');
    const wrongPath = await POST(new NextRequest('http://127.0.0.1:5001/api/config/providers', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'path-fixture', name: 'Path fixture', type: 'lmstudio',
        baseUrl: 'http://127.0.0.1:19997/v1' }),
    }));
    assert.equal(wrongPath.status, 503, 'Missing explicit path must not silently use cwd');
    assert.equal(fs.readFileSync(path.join(temp, 'litellm', 'config.yaml'), 'utf8'), before);
    console.log('PASS: explicit missing path rejects sync and preserves fallback file');
    const modelRoutes = await import('../src/app/api/config/models/route');
    const modelSave = await modelRoutes.POST(new NextRequest('http://127.0.0.1:5001/api/config/models', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ provider_id: 'path-fixture', model_id: 'fixture-model' }),
    }));
    assert.equal(modelSave.status, 503);
    assert.equal((await modelSave.json()).saved, true);
    const modelRemoval = await modelRoutes.DELETE(new NextRequest(
      'http://127.0.0.1:5001/api/config/models?providerId=path-fixture&modelId=fixture-model', {
        method: 'DELETE', headers: { origin: 'http://127.0.0.1:5001' },
      }));
    assert.equal(modelRemoval.status, 503);
    assert.equal((await modelRemoval.json()).removed, true);
    console.log('PASS: model changes report database success separately from failed proxy sync');
    const { resolveLiteLLMConfigPath } = await import('../src/lib/litellm/paths');
    const authoritative = path.join(temp, 'authoritative.yaml');
    fs.writeFileSync(authoritative, '# authoritative fixture\n');
    process.env.CLAWNEX_LITELLM_CONFIG = authoritative;
    assert.equal(resolveLiteLLMConfigPath(), authoritative);
    process.env.LITELLM_CONFIG_PATH = path.join(temp, 'other.yaml');
    assert.throws(resolveLiteLLMConfigPath, /conflicting/i);
    delete process.env.CLAWNEX_LITELLM_CONFIG;
    process.env.LITELLM_CONFIG_PATH = authoritative;
    assert.equal(resolveLiteLLMConfigPath(), authoritative);
    delete process.env.LITELLM_CONFIG_PATH;
    process.env.CLAWNEX_INSTALL_DIR = path.join(temp, 'installation');
    assert.equal(resolveLiteLLMConfigPath(), path.join(temp, 'installation', 'litellm', 'config.yaml'));
    process.env.CLAWNEX_LITELLM_CONFIG = 'relative.yaml';
    assert.throws(resolveLiteLLMConfigPath, /absolute/i);
    console.log('PASS: explicit, legacy, conflict and installation-root path contracts');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  process.chdir(cwd);
  fs.rmSync(temp, { recursive: true, force: true });
});
