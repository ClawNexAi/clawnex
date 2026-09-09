/** Isolated public-interface tests: fake database rows, temporary YAML, no network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import Database from 'better-sqlite3';
import { syncProvidersToYaml } from '../src/lib/litellm/sync';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-provider-safety-'));
const configPath = path.join(temp, 'config.yaml');
const original = '# existing working configuration\nmodel_list: []\n';
const providers = ['a', 'b'].map(id => ({
  id, name: `Provider ${id}`, type: 'openai',
  base_url: `https://${id}.example.test/v1`, api_key: '',
  api_key_env: 'CLAWNEX_TEST_PROVIDER_KEY', is_active: 1,
}));
const models = providers.map(p => ({ provider_id: p.id, model_id: 'shared-model' }));
const db = new Database(':memory:');
db.exec(`CREATE TABLE config_providers (
  id TEXT, name TEXT, type TEXT, base_url TEXT, api_key TEXT, api_key_env TEXT, is_active INTEGER
); CREATE TABLE config_models (provider_id TEXT, model_id TEXT);`);
for (const p of providers) db.prepare('INSERT INTO config_providers VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(p.id, p.name, p.type, p.base_url, p.api_key, p.api_key_env, p.is_active);
for (const m of models) db.prepare('INSERT INTO config_models VALUES (?, ?)').run(m.provider_id, m.model_id);

try {
  fs.writeFileSync(configPath, original);
  assert.throws(() => syncProvidersToYaml({ db, configPath }), /duplicate model alias/i,
    'Ambiguous model aliases must fail instead of silently routing to either provider');
  assert.equal(fs.readFileSync(configPath, 'utf8'), original,
    'Rejected configuration must leave the previous working file intact');
  console.log('PASS: duplicate aliases rejected without changing working configuration');

  db.prepare('UPDATE config_models SET model_id = ? WHERE provider_id = ?').run('other-model', 'b');
  const result = syncProvidersToYaml({ db, configPath });
  assert.equal(result.wrote_config, true);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600,
    'Generated provider configuration must be readable only by its owner');
  const generated = YAML.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(result.model_names, ['shared-model', 'other-model'],
    'Only explicitly configured models may be published; no invented provider or wildcard aliases');
  for (const name of ['shared-model', 'other-model']) {
    const entry = generated.model_list.find((row: { model_name: string }) => row.model_name === name);
    assert.equal(entry?.litellm_params.api_key, 'os.environ/CLAWNEX_TEST_PROVIDER_KEY',
      'Unique model routes preserve environment-backed credential references');
  }
  console.log('PASS: unique aliases retain environment-backed credentials');

  const working = fs.readFileSync(configPath, 'utf8');
  db.prepare('UPDATE config_models SET model_id = ? WHERE provider_id = ?').run('openai/openai/broken', 'b');
  assert.throws(() => syncProvidersToYaml({ db, configPath }), /model alias/i);
  assert.equal(fs.readFileSync(configPath, 'utf8'), working);
  db.prepare('UPDATE config_models SET model_id = ? WHERE provider_id = ?').run('other-model', 'b');
  console.log('PASS: repeated provider prefixes cannot replace working routes');
  db.prepare('UPDATE config_providers SET api_key = ? WHERE id = ?').run('invalid\ncredential', 'b');
  assert.throws(() => syncProvidersToYaml({ db, configPath }), /invalid.*configuration/i);
  assert.equal(fs.readFileSync(configPath, 'utf8'), working,
    'One invalid provider must not silently remove its working model routes');
  db.prepare('UPDATE config_providers SET api_key = ? WHERE id = ?').run('', 'b');
  console.log('PASS: invalid configured provider rejects the entire update');

  const invalidTarget = path.join(temp, 'directory-not-config');
  fs.mkdirSync(invalidTarget);
  assert.throws(() => syncProvidersToYaml({ db, configPath: invalidTarget }),
    'A filesystem failure must not return a successful sync result');
  console.log('PASS: filesystem failure propagates to the caller');
  db.exec('DELETE FROM config_models');
  const unselected = syncProvidersToYaml({ db, configPath });
  assert.equal(unselected.placeholder_only, true,
    'A provider without selected models is unconfigured, not an arbitrary inference target');
  assert.deepEqual(unselected.model_names, ['no-provider-configured']);
  console.log('PASS: providers without selected models do not invent routes');
} finally {
  db.close();
  // Only this test-owned mkdtemp directory is removed.
  fs.rmSync(temp, { recursive: true, force: true });
}
