import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-v2-recovery-'));
const file = path.join(root, 'openclaw.json');
const journal = path.join(root, 'managed.json');
Object.assign(process.env, { DATABASE_PATH: ':memory:', CLAWNEX_TEST_SKIP_DB_SEED: '1', OPENCLAW_HOME: root,
  HERMES_HOME: path.join(root, 'absent'), CLAWNEX_SELECTIVE_ROUTING_SIDECAR: journal,
  CLAWNEX_HERMES_ROUTING_SIDECAR: path.join(root, 'hermes.json'),
  CLAWNEX_INGEST_SECRET: 'fixture-only-routing-identity-secret-32-bytes', LITELLM_PORT: '4001' });
const secret = 'fixture-original-provider-key';
const proxyKey = 'fixture-old-proxy-key';
const target = 'http://127.0.0.1:4001/v1';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function setup(present = true) {
  fs.writeFileSync(file, JSON.stringify({ models: { providers: present ? {
    fixture: { baseUrl: target, apiKey: proxyKey, models: [{ id: 'fixture-model' }] },
  } : { fresh: { baseUrl: 'https://fresh.example/v1', models: [{ id: 'fresh-model' }] } } } }));
  fs.writeFileSync(journal, JSON.stringify({ version: 2, managedAt: '2026-08-01', clawnexVersion: '0.15.5', openclawVersion: null,
    providers: [{ providerId: 'fixture', baseUrlKey: 'baseUrl', originalBaseUrl: 'https://fixture.example/v1',
      apiKeyKey: 'apiKey', hadApiKey: true, originalApiKey: secret, routedBaseUrl: target,
      routedApiKeySha256: digest(proxyKey), routedAt: '2026-08-01' }] }), { mode: 0o600 });
}
async function main() {
  const routing = await import('../src/lib/services/connector-routing-inventory');
  const { getDb } = await import('../src/lib/db');
  try {
    setup();
    const before = fs.readFileSync(journal, 'utf8');
    const inventory = routing.syncConnectorRoutingInventory();
    assert.equal(inventory.openclaw.status, 'ok');
    assert.equal(fs.readFileSync(journal, 'utf8'), before, 'Discovery must not migrate ownership');
    assert(!JSON.stringify(inventory).includes(secret), 'Discovery must not expose recovery credentials');
    routing.setAllConnectorRoutingSelections('openclaw', 'direct');
    assert.equal(routing.applyOpenClawDesiredRouting({ restore: true }).ok, true);
    const restored = JSON.parse(fs.readFileSync(file, 'utf8')).models.providers.fixture;
    assert.equal(restored.baseUrl, 'https://fixture.example/v1');
    assert.equal(restored.apiKey, secret);
    console.log('PASS: v2 discovery is read-only; restore returns the original endpoint and credential');
    setup();
    routing.syncConnectorRoutingInventory();
    routing.setAllConnectorRoutingSelections('openclaw', 'routed');
    assert.equal(routing.applyOpenClawDesiredRouting({ restore: false }).ok, true);
    const encrypted = fs.readFileSync(journal, 'utf8');
    assert.equal(JSON.parse(encrypted).version, 3);
    assert(!encrypted.includes(secret) && !encrypted.includes('"originalApiKey"'));
    assert.equal(fs.statSync(`${journal}.credential-key`).mode & 0o777, 0o600);
    assert.equal(fs.statSync(journal).mode & 0o777, 0o600);
    routing.setAllConnectorRoutingSelections('openclaw', 'direct');
    const protectedConfig = fs.readFileSync(file, 'utf8');
    fs.renameSync(`${journal}.credential-key`, `${journal}.credential-key.saved`);
    assert.throws(() => routing.applyOpenClawDesiredRouting({ restore: true }), /cannot be authenticated/);
    assert.equal(fs.readFileSync(file, 'utf8'), protectedConfig);
    fs.renameSync(`${journal}.credential-key.saved`, `${journal}.credential-key`);
    const tampered = JSON.parse(encrypted);
    tampered.providers[0].encryptedOriginalApiKey.tag = Buffer.alloc(16).toString('base64');
    fs.writeFileSync(journal, JSON.stringify(tampered));
    assert.throws(() => routing.applyOpenClawDesiredRouting({ restore: true }), /cannot be authenticated/);
    assert.equal(fs.readFileSync(file, 'utf8'), protectedConfig);
    fs.writeFileSync(journal, encrypted);
    assert.equal(routing.applyOpenClawDesiredRouting({ restore: true }).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).models.providers.fixture.apiKey, secret);
    console.log('PASS: approved writes encrypt v2 credentials; missing keys and tampering fail before agent writes; v3 restores exactly');

    setup();
    const edited = JSON.parse(fs.readFileSync(file, 'utf8'));
    edited.models.providers.fixture.apiKey = 'operator-replacement';
    fs.writeFileSync(file, JSON.stringify(edited));
    routing.syncConnectorRoutingInventory();
    routing.setAllConnectorRoutingSelections('openclaw', 'direct');
    const editedRaw = fs.readFileSync(file, 'utf8');
    const oldOwnership = fs.readFileSync(journal, 'utf8');
    assert.equal(routing.applyOpenClawDesiredRouting({ restore: true }).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), editedRaw);
    assert.equal(fs.readFileSync(journal, 'utf8'), oldOwnership);
    routing.setAllConnectorRoutingSelections('openclaw', 'routed');
    assert.equal(routing.applyOpenClawDesiredRouting({ restore: false }).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), editedRaw);
    console.log('PASS: operator credential changes survive both apply and restore');

    setup(false);
    routing.syncConnectorRoutingInventory();
    routing.setAllConnectorRoutingSelections('openclaw', 'routed');
    assert.equal(routing.applyOpenClawDesiredRouting({ restore: false }).ok, true);
    assert(!fs.readFileSync(journal, 'utf8').includes(secret));
    assert(JSON.parse(fs.readFileSync(journal, 'utf8')).providers.some((r: {providerId: string}) => r.providerId === 'fixture'));
    assert(!JSON.parse(fs.readFileSync(file, 'utf8')).models.providers.fixture);
    routing.setAllConnectorRoutingSelections('openclaw', 'direct');
    const partial = routing.applyOpenClawDesiredRouting({ restore: true });
    assert.equal(partial.ok, false);
    assert(partial.skippedProviders.some(r => r.providerId === 'fixture'));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).models.providers.fresh.baseUrl, 'https://fresh.example/v1');
    assert.equal(JSON.parse(fs.readFileSync(journal, 'utf8')).providers.length, 1);
    console.log('PASS: removed providers are retained encrypted, never recreated, and do not prevent unrelated routing');
    setup();
    const originallyAbsent = JSON.parse(fs.readFileSync(journal, 'utf8'));
    originallyAbsent.providers[0].hadApiKey = false;
    delete originallyAbsent.providers[0].originalApiKey;
    fs.writeFileSync(journal, JSON.stringify(originallyAbsent));
    routing.syncConnectorRoutingInventory();
    routing.setAllConnectorRoutingSelections('openclaw', 'direct');
    assert.equal(routing.applyOpenClawDesiredRouting({ restore: true }).ok, true);
    assert(!Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')).models.providers.fixture, 'apiKey'));
    console.log('PASS: restoration removes a proxy credential when no original key existed');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
