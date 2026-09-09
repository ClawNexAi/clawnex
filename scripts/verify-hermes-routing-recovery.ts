import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-hermes-recovery-'));
Object.assign(process.env, { DATABASE_PATH: ':memory:', CLAWNEX_TEST_SKIP_DB_SEED: '1',
  CLAWNEX_INGEST_SECRET: 'fixture-only-routing-identity-secret-32-bytes',
  OPENCLAW_HOME: path.join(root, 'absent'), HERMES_HOME: root,
  CLAWNEX_HERMES_ROUTING_SIDECAR: path.join(root, 'managed.json'),
  CLAWNEX_SELECTIVE_ROUTING_SIDECAR: path.join(root, 'openclaw-managed.json') });
const file = path.join(root, 'config.yaml');
const original = { custom_providers: [{ name: 'openrouter', baseUrl: 'http://127.0.0.1:19999/v1', keyEnv: 'FIXTURE_KEY', apiMode: 'chat_completions' }],
  model: { provider: 'openrouter', default: 'deepseek/deepseek-v4-flash-0731', baseUrl: 'http://127.0.0.1:19999/v1', apiMode: 'chat_completions' } };
fs.writeFileSync(file, YAML.stringify(original));
const secondFile = path.join(root, 'profiles', 'second', 'config.yaml');
fs.mkdirSync(path.dirname(secondFile), { recursive: true });
fs.writeFileSync(secondFile, YAML.stringify(original));

async function main() {
  const { getDb } = await import('../src/lib/db');
  const { addProvider, addModel } = await import('../src/lib/services/config-service');
  const routing = await import('../src/lib/services/connector-routing-inventory');
  try {
    await addProvider({ id: 'openrouter-fixture', name: 'OpenRouter fixture', type: 'openrouter', baseUrl: 'http://127.0.0.1:19999/v1', apiKey: 'fixture-key' });
    addModel('openrouter-fixture', 'openrouter/deepseek/deepseek-v4-flash-0731');
    const firstInventory = routing.syncConnectorRoutingInventory();
    const firstSource = firstInventory.hermes.items.find(item => item.metadata.configPath === file)!.sourceId;
    const secondBefore = fs.readFileSync(secondFile, 'utf8');
    routing.setAllConnectorRoutingSelections('hermes', 'routed');
    assert.equal(routing.applyHermesDesiredRouting({ sourceId: firstSource }).ok, true);
    assert.equal(YAML.parse(fs.readFileSync(file, 'utf8')).model.default, 'openrouter/deepseek/deepseek-v4-flash-0731',
      'Hermes sends the exact model alias exposed by LiteLLM');
    assert.equal(fs.readFileSync(secondFile, 'utf8'), secondBefore, 'Applying one instance cannot write another with the same provider/model');
    assert.equal(routing.revertHermesRouting({ sourceId: firstSource }).ok, true);
    assert.equal(fs.readFileSync(secondFile, 'utf8'), secondBefore);
    const wire = () => {
      routing.syncConnectorRoutingInventory();
      routing.setAllConnectorRoutingSelections('hermes', 'routed');
      assert.equal(routing.applyHermesDesiredRouting().ok, true);
    };
    wire();
    const recased = YAML.parse(fs.readFileSync(file, 'utf8'));
    for (const provider of recased.custom_providers) {
      if (provider.extra_headers?.['x-clawnex-routing-identity']) {
        provider.extra_headers['X-ClawNex-Routing-Identity'] = provider.extra_headers['x-clawnex-routing-identity'];
        delete provider.extra_headers['x-clawnex-routing-identity'];
      }
    }
    fs.writeFileSync(file, YAML.stringify(recased));
    assert.equal(routing.revertHermesRouting().ok, true);
    assert.deepEqual(YAML.parse(fs.readFileSync(file, 'utf8')), original, 'Camel-case keys and primary selection round-trip exactly');
    wire();
    const changed = YAML.parse(fs.readFileSync(file, 'utf8'));
    changed.model.default = 'operator-new-model';
    fs.writeFileSync(file, YAML.stringify(changed));
    const conflict = routing.revertHermesRouting();
    assert.equal(conflict.ok, false);
    const preserved = YAML.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(preserved.model.default, 'operator-new-model');
    assert.equal(preserved.model.provider, 'clawnex-litellm');
    assert(preserved.custom_providers.some((provider: { name: string }) => provider.name === 'clawnex-litellm'), 'Referenced proxy bridge survives');
    assert(fs.existsSync(process.env.CLAWNEX_HERMES_ROUTING_SIDECAR!));
    console.log('PASS: Hermes primary/provider round-trip preserves original key spelling; changed model and referenced bridge survive restore');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
