import assert from 'node:assert/strict';
import { checkLiteLLM } from '../src/lib/health/litellm-check';

async function main() {
  const requests: string[] = [];
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: (async input => {
      requests.push(String(input));
      return Response.json({ healthy_endpoints: [], unhealthy_endpoints: [] });
    }) as typeof fetch,
  });
  assert.deepEqual(requests, ['http://127.0.0.1:4001/health/liveliness'],
    'Routine polling must not initiate upstream model probes');
  assert.equal(result.status, 'online');
  assert.match(result.detail || '', /not tested/i, 'Liveness must not imply model readiness');
  console.log('PASS: routine health polling does not initiate unapproved upstream probes');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
