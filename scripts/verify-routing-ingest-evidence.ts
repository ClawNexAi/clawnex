import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';

async function main() {
  const { NextRequest } = await import('next/server');
  const { getDb, queryOne } = await import('../src/lib/db');
  const { POST } = await import('../src/app/api/proxy/ingest/route');
  const body = (connector: 'hermes' | 'opencode' | 'anythingllm') => ({ direction: 'outbound', model: 'fixture-model', routing_connector: connector, routing_source_id: connector === 'opencode' ? 'opencode:global' : 'instance-a', proxy_request_id: `request-${connector}` });
  const request = (secret?: string, connector: 'hermes' | 'opencode' | 'anythingllm' = 'hermes') => new NextRequest('http://127.0.0.1:15001/api/proxy/ingest', {
    method: 'POST', headers: { origin: 'http://127.0.0.1:15001', 'content-type': 'application/json', ...(secret ? { 'x-clawnex-ingest-secret': secret } : {}) }, body: JSON.stringify(body(connector)),
  });
  try {
    delete process.env.CLAWNEX_INGEST_SECRET;
    const local = await POST(request());
    assert.equal(local.status, 200);
    const localId = (await local.json()).id;
    assert.equal(queryOne<{ trusted: number }>('SELECT routing_identity_verified AS trusted FROM proxy_traffic WHERE id = ?', [localId])?.trusted, 0);
    process.env.CLAWNEX_INGEST_SECRET = 'fixture-ingest-secret';
    assert.equal((await POST(request('wrong'))).status, 401);
    const authenticated = await POST(request('fixture-ingest-secret'));
    assert.equal(authenticated.status, 200);
    const id = (await authenticated.json()).id;
    assert.equal(queryOne<{ trusted: number }>('SELECT routing_identity_verified AS trusted FROM proxy_traffic WHERE id = ?', [id])?.trusted, 1);
    const openCode = await POST(request('fixture-ingest-secret', 'opencode'));
    assert.equal(openCode.status, 200);
    const openCodeId = (await openCode.json()).id;
    assert.equal(queryOne<{ connector: string }>('SELECT routing_connector AS connector FROM proxy_traffic WHERE id = ?', [openCodeId])?.connector, 'opencode');
    const anything = await POST(request('fixture-ingest-secret', 'anythingllm'));
    assert.equal(anything.status, 200);
    const anythingId = (await anything.json()).id;
    assert.equal(queryOne<{ connector: string }>('SELECT routing_connector AS connector FROM proxy_traffic WHERE id = ?', [anythingId])?.connector, 'anythingllm');
    console.log('PASS: localhost labels cannot attest identity; authenticated proxy callback can record exact-instance evidence');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
