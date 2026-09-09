import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-legacy-recovery-'));
process.env.OPENCLAW_HOME = root;
process.env.CLAWNEX_LEGACY_ROUTING_SIDECAR = path.join(root, 'ownership.json');
const configPath = path.join(root, 'openclaw.json');
const original = { baseUrl: 'http://127.0.0.1:4001/v1', models: [] };
const ownership = { version: 1, paths: [{ path: ['models', 'providers', 'litellm'],
  operation: 'set', valueSha256: createHash('sha256').update(JSON.stringify(original)).digest('hex') }] };

async function main() {
  const { revertLitellmRouting } = await import('../src/lib/services/openclaw-routing-wire');
  fs.writeFileSync(configPath, JSON.stringify({ models: { providers: { litellm: { ...original, baseUrl: 'https://operator.example/v1' } } } }));
  fs.writeFileSync(process.env.CLAWNEX_LEGACY_ROUTING_SIDECAR!, JSON.stringify(ownership));
  const edited = fs.readFileSync(configPath, 'utf8');
  const conflict = revertLitellmRouting();
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, 'conflict');
  assert.equal(fs.readFileSync(configPath, 'utf8'), edited);
  assert.equal(JSON.parse(fs.readFileSync(process.env.CLAWNEX_LEGACY_ROUTING_SIDECAR!, 'utf8')).paths.length, 1);
  fs.writeFileSync(configPath, JSON.stringify({ models: { providers: { litellm: original } } }));
  assert.equal(revertLitellmRouting().ok, true);
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).models?.providers?.litellm, undefined);
  fs.writeFileSync(process.env.CLAWNEX_LEGACY_ROUTING_SIDECAR!, '{broken');
  assert.throws(() => revertLitellmRouting(), /ownership|sidecar/i);
  console.log('PASS: legacy restoration preserves edited set paths, retains conflicts, and rejects corrupt ownership');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
