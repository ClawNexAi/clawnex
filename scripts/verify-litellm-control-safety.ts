/** Real API and temporary database; all process-control boundaries intercepted. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';

process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-control-safety-'));
process.env.CLAWNEX_INSTALL_DIR = temp;
delete process.env.CLAWNEX_LITELLM_CONFIG;
delete process.env.LITELLM_CONFIG_PATH;
fs.mkdirSync(path.join(temp, 'litellm', 'config.yaml'), { recursive: true });
const original = { execSync: childProcess.execSync, execFileSync: childProcess.execFileSync, spawn: childProcess.spawn };
const actions: string[] = [];
let rejectServiceAction = false;
let systemdAvailable = true;
let launchdAvailable = false;
childProcess.execSync = (() => '/fixture/systemctl') as unknown as typeof childProcess.execSync;
childProcess.execFileSync = ((command: string, args: string[]) => {
  if (args[0] === 'is-enabled' && !systemdAvailable) throw new Error('No systemd in fixture');
  if (command === '/bin/launchctl' && args[0] === 'print' && !launchdAvailable) throw new Error('No launchd fixture');
  if (args[0] !== 'is-enabled') actions.push(`${command} ${args.join(' ')}`);
  if (rejectServiceAction && command === 'sudo') throw new Error('Fixture service failure');
  return Buffer.from('');
}) as typeof childProcess.execFileSync;
childProcess.spawn = (() => { throw new Error('Unexpected spawn blocked by safety test'); }) as typeof childProcess.spawn;
syncBuiltinESMExports();

async function main() {
  const { NextRequest } = await import('next/server');
  const { POST } = await import('../src/app/api/system/litellm/route');
  const { getDb } = await import('../src/lib/db/index');
  try {
    for (const action of ['start', 'restart']) {
      const response = await POST(new NextRequest('http://127.0.0.1:5001/api/system/litellm', {
        method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      }));
      assert.equal(response.status, 503, `${action} must reject failed configuration sync`);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.configSynced, false);
      assert.deepEqual(actions, [], 'Rejected preparation must not change a running service');
    }
    console.log('PASS: failed sync prevents start/restart without service mutation');
    process.env.CLAWNEX_LITELLM_CONFIG = path.join(temp, 'missing.yaml');
    const request = (action: string) => new NextRequest('http://127.0.0.1:5001/api/system/litellm', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:5001', 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const invalidPath = await POST(request('restart'));
    assert.equal(invalidPath.status, 503);
    assert.equal((await invalidPath.json()).configSynced, false);
    assert.deepEqual(actions, []);
    const stop = await POST(request('stop'));
    assert.equal(stop.status, 200, 'Missing config must not prevent an explicit stop');
    assert.deepEqual(actions, ['sudo -n /fixture/systemctl stop clawnex-litellm.service']);
    console.log('PASS: invalid explicit path blocks restart but permits operator-requested stop');
    const validConfig = path.join(temp, 'valid.yaml');
    fs.writeFileSync(validConfig, 'model_list: []\n');
    process.env.CLAWNEX_LITELLM_CONFIG = validConfig;
    rejectServiceAction = true;
    const rejectedReload = await POST(request('restart'));
    assert.equal(rejectedReload.status, 503);
    assert.equal((await rejectedReload.json()).ok, false);
    console.log('PASS: service-manager reload failure is not reported as success');
    systemdAvailable = false;
    rejectServiceAction = false;
    process.env.CLAWNEX_LITELLM_LAUNCHD_LABEL = 'gui/501/io.clawnex.litellm';
    launchdAvailable = true;
    actions.length = 0;
    const launchdRestart = await POST(request('restart'));
    assert.equal(launchdRestart.status, 200, 'Registered launchd service should handle restart');
    assert.equal((await launchdRestart.json()).usedLaunchd, true);
    const launchdActions = [...actions] as string[];
    assert.ok(launchdActions.includes('/bin/launchctl kickstart -k gui/501/io.clawnex.litellm'));
    assert.ok(!launchdActions.some(action => action.startsWith('lsof ') || action.includes('litellm --config')),
      'launchd restart must not race an unmanaged replacement process');
    console.log('PASS: launchd-owned LiteLLM restarts through its registered service');
    delete process.env.CLAWNEX_LITELLM_LAUNCHD_LABEL;
    process.env.CLAWNEX_LITELLM_LAUNCHD_PLIST = path.join(temp, 'missing.plist');
    launchdAvailable = false;
    actions.length = 0;
    const failedLaunch = await POST(request('start'));
    assert.equal(failedLaunch.status, 503, 'Local launch failure must not claim started');
    assert.equal((await failedLaunch.json()).ok, false);
    console.log('PASS: local process launch failure is reported explicitly');
    childProcess.spawn = (() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = () => {};
      // A fallback listener keeps the deliberately broken implementation test-safe.
      child.on('error', () => {});
      setImmediate(() => child.emit('error', new Error('Fixture executable unavailable')));
      return child;
    }) as unknown as typeof childProcess.spawn;
    syncBuiltinESMExports();
    const asyncFailure = await POST(request('start'));
    assert.equal(asyncFailure.status, 503, 'Asynchronous launch error must not claim started');
    console.log('PASS: asynchronous process launch failure is reported explicitly');
  } finally { getDb().close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Object.assign(childProcess, original);
  syncBuiltinESMExports();
  delete process.env.CLAWNEX_LITELLM_LAUNCHD_LABEL;
  delete process.env.CLAWNEX_LITELLM_LAUNCHD_PLIST;
  fs.rmSync(temp, { recursive: true, force: true });
});
