/** Public service tests with an in-memory database and a fake HTTP transport. */
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';

async function main() {
  const svc = await import('../src/lib/services/config-service');
  const { getDb } = await import('../src/lib/db/index');
  const originalFetch = globalThis.fetch;
  let authorized = false;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = String(input);
    assert.ok(url.startsWith('http://127.0.0.1:19999/'), 'No external requests permitted');
    assert.equal(init?.redirect, 'error', 'Credential requests must refuse redirects');
    if (url.endsWith('/key')) {
      assert.equal(new Headers(init?.headers).get('Authorization'),
        authorized ? 'Bearer fake-env-key' : 'Bearer fake-rejected-key');
      return Response.json(authorized ? { data: { label: 'fixture' } } : { error: { message: 'rejected' } },
        { status: authorized ? 200 : 401 });
    }
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'openai/test-model' }] });
    throw new Error('Unexpected request');
  };
  try {
    await svc.addProvider({ id: 'readiness-fixture', name: 'Fixture', type: 'openrouter',
      baseUrl: 'http://127.0.0.1:19999/api/v1', apiKey: 'fake-rejected-key' });
    const rejected = await svc.testProvider('readiness-fixture');
    assert.equal(rejected.status, 'error', 'Readable catalog must not make a rejected key connected');
    assert.match(rejected.error || '', /authentication/i);
    console.log('PASS: rejected credentials cannot pass through public catalog success');

    process.env.CLAWNEX_READINESS_FIXTURE_KEY = 'fake-env-key';
    await svc.updateProvider('readiness-fixture', { apiKey: '', apiKeyEnv: 'CLAWNEX_READINESS_FIXTURE_KEY' });
    authorized = true;
    assert.equal((await svc.testProvider('readiness-fixture')).status, 'connected');
    console.log('PASS: environment-backed credentials remain supported');

    delete process.env.CLAWNEX_READINESS_FIXTURE_KEY;
    calls = 0;
    assert.equal((await svc.testProvider('readiness-fixture')).status, 'error');
    assert.equal(calls, 0, 'Missing key must not trigger anonymous catalog success');
    console.log('PASS: missing credentials rejected without network activity');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLAWNEX_READINESS_FIXTURE_KEY;
    getDb().close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
