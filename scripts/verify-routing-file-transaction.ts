import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitRoutingFile } from '../src/lib/services/routing-file-transaction';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-routing-transaction-'));
try {
  const configPath = path.join(temp, 'agent.json');
  const journalPath = path.join(temp, 'managed.json');
  fs.writeFileSync(configPath, '{"direct":true}', { mode: 0o600 });
  assert.throws(() => commitRoutingFile({ configPath, expectedRaw: 'stale', updatedRaw: '{}', journalPath,
    recoveryJournal: { version: 1, providers: [] },
  }), /changed/i);
  assert.equal(fs.existsSync(journalPath), false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{"direct":true}');
  commitRoutingFile({ configPath, expectedRaw: '{"direct":true}', updatedRaw: '{"direct":false}', journalPath,
    recoveryJournal: { version: 1, providers: [{ providerId: 'fixture', originalBaseUrl: 'https://example.test/v1' }] },
  });
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{"direct":false}');
  assert.equal(JSON.parse(fs.readFileSync(journalPath, 'utf8')).providers[0].providerId, 'fixture');
  assert.equal(fs.statSync(journalPath).mode & 0o777, 0o600);
  console.log('PASS: stale files are refused; recovery ownership is persisted before routing changes');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
