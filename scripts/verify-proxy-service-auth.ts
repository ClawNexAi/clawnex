import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.RBAC_ENABLED = 'true';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'true';
process.env.CLAWNEX_INGEST_SECRET = 'fixture-only-proxy-service-secret-32-bytes';

async function main() {
  const { NextRequest } = await import('next/server');
  const { middleware } = await import('../src/middleware');
  const scan = await import('../src/app/api/shield/scan/route');
  const mode = await import('../src/app/api/proxy/block-mode/route');
  const glass = await import('../src/app/api/break-glass/status/route');
  const { getDb } = await import('../src/lib/db');
  const secret = process.env.CLAWNEX_INGEST_SECRET!;
  const request = (url: string, method: string, token?: string) => new NextRequest(`http://127.0.0.1:5001${url}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-clawnex-ingest-secret': token } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ text: 'Reply with OK.', source: 'litellm-proxy' }) } : {}),
  });
  try {
    const routes = [
      ['/api/shield/scan', 'POST', scan.POST],
      ['/api/proxy/block-mode', 'GET', mode.GET],
      ['/api/break-glass/status', 'GET', glass.GET],
    ] as const;
    for (const [url, method, handler] of routes) {
      assert.equal((await handler(request(url, method, secret))).status, 200, `${url} accepts service credential with RBAC on`);
      assert.equal(middleware(request(url, method, secret)).headers.get('x-middleware-next'), '1');
      for (const token of [undefined, 'incorrect', 'é'.repeat(secret.length)]) {
        assert.equal((await handler(request(url, method, token))).status, 401, `${url} rejects missing/wrong credentials`);
      }
    }
    assert.equal((await mode.POST(request('/api/proxy/block-mode', 'POST', secret))).status, 401, 'service cannot disable blocking');
    for (const [url, method] of [['/api/proxy/block-mode', 'POST'], ['/api/shield/scan/extra', 'POST'], ['/api/config/providers', 'GET']]) {
      assert.equal(middleware(request(url, method, secret)).status, 401, 'no broader middleware bypass');
    }
    delete process.env.CLAWNEX_INGEST_SECRET;
    assert.equal((await scan.POST(request('/api/shield/scan', 'POST', secret))).status, 401, 'missing configured secret fails closed');
    console.log('PASS: authenticated proxy scanning/status with RBAC; invalid tokens and administrative access rejected');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
