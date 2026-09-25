import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-codex-launcher-'));
const bin = path.join(root, 'bin');
const capture = path.join(root, 'capture.json');
const secret = 'fixture-ingest-secret-that-is-at-least-32-bytes';
fs.mkdirSync(bin, { recursive: true });
fs.copyFileSync(new URL('../clawnex', import.meta.url), path.join(root, 'clawnex'));
fs.chmodSync(path.join(root, 'clawnex'), 0o755);
fs.writeFileSync(path.join(root, '.env.local'), `LITELLM_PORT=4001\nLITELLM_MASTER_KEY=fixture-proxy-key\nCLAWNEX_INGEST_SECRET=${secret}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/bash\nprintf \'%s\' \'{"data":[{"model_name":"provider/model"}]}\'\n', { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({
  args: process.argv.slice(2),
  key: process.env.CLAWNEX_LITELLM_API_KEY,
  identity: process.env.CLAWNEX_ROUTING_IDENTITY,
  stripped: !process.env.OPENAI_API_KEY && !process.env.OMNIROUTE_API_KEY,
}));
`, { mode: 0o755 });

const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, CAPTURE: capture,
  OPENAI_API_KEY: 'must-not-reach-child', OMNIROUTE_API_KEY: 'must-not-reach-child' };
const run = spawnSync(path.join(root, 'clawnex'), ['run', 'codex', '--model', 'provider/model', '--', 'exec', 'Reply OK'], { env, encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const child = JSON.parse(fs.readFileSync(capture, 'utf8'));
assert.equal(child.key, 'fixture-proxy-key');
assert.equal(child.stripped, true);
assert.deepEqual(child.args.slice(-4), ['--model', 'provider/model', 'exec', 'Reply OK']);
assert.ok(child.args.includes('model_provider="clawnex"'));
assert.ok(child.args.includes('model_providers.clawnex.base_url="http://127.0.0.1:4001/v1"'));
assert.ok(child.args.includes('model_providers.clawnex.env_key="CLAWNEX_LITELLM_API_KEY"'));
assert.ok(child.args.includes('model_providers.clawnex.env_http_headers={"x-clawnex-routing-identity"="CLAWNEX_ROUTING_IDENTITY"}'));

const [payload, signature] = child.identity.split('.');
const expected = crypto.createHmac('sha256', secret).update(`clawnex-routing-v1:${payload}`).digest('base64url');
assert.equal(signature, expected);
const identity = JSON.parse(Buffer.from(payload, 'base64url').toString());
assert.equal(identity.connector, 'codex');
assert.equal(identity.sourceId, 'codex:global');

const dryRun = spawnSync(path.join(root, 'clawnex'), ['run', 'codex', '--model', 'provider/model', '--dry-run'], { env, encoding: 'utf8' });
assert.equal(dryRun.status, 0, dryRun.stderr);
assert.match(dryRun.stdout, /Config files changed: none/);
assert.ok(!dryRun.stdout.includes('fixture-proxy-key') && !dryRun.stdout.includes(secret));

const override = spawnSync(path.join(root, 'clawnex'), ['run', 'codex', '--model', 'provider/model', '--', '--profile', 'direct'], { env, encoding: 'utf8' });
assert.equal(override.status, 2);
assert.match(override.stderr, /can override the inspected route/);
assert.equal(fs.existsSync(path.join(root, '.codex', 'config.toml')), false);

fs.rmSync(root, { recursive: true, force: true });
console.log('PASS: zero-write Codex launcher injects child-only proxy auth and signed routing identity');
