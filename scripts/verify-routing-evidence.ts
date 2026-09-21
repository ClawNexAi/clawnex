import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ConnectorRoutingItem, ConnectorRoutingSummary } from '../src/lib/services/connector-routing-inventory';
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';

async function main() {
  const { getDb, run } = await import('../src/lib/db');
  const { verifyRouting, recordRoutingSnapshot, listUnresolvedRoutingEvents, recordRoutingOperation } = await import('../src/lib/services/routing-reconciliation');
  const item: ConnectorRoutingItem = { id: 'a', connector: 'hermes', sourceId: 'instance-a', itemType: 'model', providerId: 'upstream',
    modelId: 'shared-model', displayName: 'Shared model', baseUrl: 'http://127.0.0.1:4001/v1', capability: 'model-inventory',
    currentRoute: 'routed', desiredRoute: 'routed', present: true, fingerprint: 'fixture', metadata: { proxyModelAlias: 'proxy/shared-model' },
    firstSeenAt: '', lastSeenAt: '', lastChangedAt: null, updatedAt: '' };
  const secondItem: ConnectorRoutingItem = { ...item, id: 'b', modelId: 'second-model', displayName: 'Second model',
    metadata: { proxyModelAlias: 'proxy/second-model' } };
  const summary = { connector: 'hermes', sourceId: 'instance-a', items: [item, secondItem,
    { ...item, id: 'provider', itemType: 'provider', modelId: '' }] } as ConnectorRoutingSummary;
  try {
    const first = recordRoutingSnapshot('hermes', summary, 'apply');
    assert.equal(recordRoutingSnapshot('hermes', summary, 'refresh').snapshotId, first.snapshotId);
    const operation = recordRoutingOperation({ connector: 'hermes', sourceId: 'instance-a', operation: 'apply', outcome: 'applied', detail: 'fixture' });
    run("UPDATE connector_routing_operations SET created_at = '2026-09-08T12:00:00.000Z' WHERE id = ?", [operation]);
    const since = '2026-09-08T12:00:00.000Z';
    const insert = (source: string, status = 200, blocked = 0, trusted = 1, timestamp = '2026-09-08T12:00:01.000Z', error: string | null = null, model = 'proxy/shared-model') => run(
      `INSERT INTO proxy_traffic (id, timestamp, direction, model, source, routing_connector, routing_source_id,
        routing_identity_verified, proxy_request_id, status_code, blocked, error, total_tokens, shield_verdict)
       VALUES (?, ?, 'outbound', ?, 'hermes', 'hermes', ?, ?, ?, ?, ?, ?, 10, 'ALLOW')`,
      [randomUUID(), timestamp, model, source, trusted, randomUUID(), status, blocked, error]);
    insert('instance-b'); insert('instance-a', 500); insert('instance-a', 200, 1); insert('instance-a', 200, 0, 0);
    insert('instance-a', 200, 0, 1, '2026-09-08T11:59:59.000Z');
    insert('instance-a', 200, 0, 1, '2026-09-08T12:00:01.000Z', 'upstream failed');
    assert.equal(verifyRouting(summary, { since }).status, 'pending-traffic');
    insert('instance-a');
    assert.equal(verifyRouting(summary, { since }).status, 'partial-traffic', 'One model cannot verify every model behind the provider route');
    insert('instance-a', 200, 0, 1, '2026-09-08T12:00:02.000Z', null, 'proxy/second-model');
    const verified = verifyRouting(summary, { since });
    assert.equal(verified.status, 'verified');
    assert.equal(verified.configured, 1, 'provider rows do not duplicate model counts');
    assert.equal(verified.observedThroughClawNex, 2);
    const signedSummary = { ...summary, items: summary.items.map(row => ({ ...row, metadata: { ...row.metadata, identityHash: 'a'.repeat(64), identityIntact: true } })) };
    assert.equal(verifyRouting(signedSummary, { since }).status, 'pending-traffic', 'Unsigned or retired identity evidence cannot verify a newly managed route');
    run("UPDATE proxy_traffic SET routing_identity_hash = ? WHERE routing_source_id = 'instance-a'", ['a'.repeat(64)]);
    assert.equal(verifyRouting(signedSummary, { since }).status, 'verified');
    assert.equal(verifyRouting({ ...signedSummary, items: signedSummary.items.map(row => ({ ...row, metadata: { ...row.metadata, identityIntact: false } })) }, { since }).status, 'pending-traffic');
    const baseline = verifyRouting(summary).verificationSince;
    recordRoutingSnapshot('hermes', summary, 'refresh');
    assert.equal(verifyRouting(summary).verificationSince, baseline);
    const changed = { ...summary, items: [{ ...item, baseUrl: 'https://changed.example/v1', currentRoute: 'direct' as const }] };
    recordRoutingSnapshot('hermes', changed, 'drift');
    const event = listUnresolvedRoutingEvents().find(value => value.changeType === 'endpoint-changed');
    assert.equal(event?.current?.endpoint, 'https://changed.example/v1');
    assert.equal(event?.previous?.endpoint, 'http://127.0.0.1:4001/v1');
    assert.equal(verifyRouting(summary).verificationSince, baseline,
      'inventory snapshots and drift discovery do not move the post-operation evidence baseline');
    console.log('PASS: exact-instance successful evidence only; stable refresh baseline; no duplicate model denominator; readable drift states');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
