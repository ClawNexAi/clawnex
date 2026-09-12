#!/usr/bin/env tsx
/** Public Fleet Connectors contract for globally configured coding agents. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-coding-agent-'));
const previousHome = process.env.HOME;
const previousOpenCodeConfig = process.env.OPENCODE_CONFIG;
process.env.HOME = root;
process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';

const configDirectory = path.join(root, '.config', 'opencode');
const configPath = path.join(configDirectory, 'opencode.jsonc');
fs.mkdirSync(configDirectory, { recursive: true });
fs.writeFileSync(path.join(configDirectory, 'opencode.json'), '{}\n');
fs.writeFileSync(configPath, `{
  // OpenCode supports JSONC as a global configuration filename and format.
  "provider": {
    "openrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://openrouter.ai/api/v1", "apiKey": "{env:OPENROUTER_API_KEY}" },
      "models": { "openai/gpt-5.4": { "name": "GPT-5.4" } },
    },
  },
}\n`);

async function main(): Promise<void> {
  const { NextRequest } = await import('next/server');
  const routes = await import('../src/app/api/config/coding-agent-connectors/route');
  const { getDb } = await import('../src/lib/db');
  const request = (method: string, body?: unknown, suffix = '') => new NextRequest(`http://127.0.0.1:5001/api/config/coding-agent-connectors${suffix}`, {
    method,
    headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  try {
    const created = await routes.POST(request('POST', { type: 'opencode', name: 'OpenCode Local' }));
    const creation = await created.json();
    assert.equal(created.status, 201, 'OpenCode global connector can be added');
    assert.equal(creation.connector.type, 'opencode');
    assert.equal(creation.connector.configPath, fs.realpathSync(configPath));
    assert.equal(creation.connector.available, true);
    assert.ok(!JSON.stringify(creation).includes('OPENROUTER_API_KEY'), 'connector response does not expose configuration content');

    const listed = await routes.GET(request('GET'));
    const inventory = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(inventory.connectors.length, 1, 'saved OpenCode connector is listed');

    fs.unlinkSync(configPath);
    const fallbackInventory = await (await routes.GET(request('GET'))).json();
    assert.equal(fallbackInventory.connectors[0].configPath, fs.realpathSync(path.join(configDirectory, 'opencode.json')),
      'connector inventory follows the active supported global config filename');

    const duplicate = await routes.POST(request('POST', { type: 'opencode', name: 'Duplicate' }));
    assert.equal(duplicate.status, 409, 'global OpenCode connector cannot be added twice');

    const removed = await routes.DELETE(request('DELETE', undefined, `?id=${encodeURIComponent(creation.connector.id)}`));
    assert.equal(removed.status, 200, 'OpenCode connector can be removed');
    assert.equal((await routes.GET(request('GET'))).status, 200);

    const overridePath = path.join(root, 'custom', 'fleet.jsonc');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '{}\n');
    process.env.OPENCODE_CONFIG = overridePath;
    const overridden = await routes.POST(request('POST', { type: 'opencode', name: 'OpenCode Override' }));
    assert.equal(overridden.status, 201, 'documented OpenCode config override can be added');
    assert.equal((await overridden.json()).connector.configPath, fs.realpathSync(overridePath));
    console.log('PASS: global coding-agent connector API discovers JSONC and explicit config paths, then adds, lists, deduplicates, redacts, and removes OpenCode');
  } finally {
    getDb().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousOpenCodeConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = previousOpenCodeConfig;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
