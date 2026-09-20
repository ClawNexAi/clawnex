#!/usr/bin/env node
// Behavioral checks: exercise the same subprocesses used by deployment/systemd.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-runtime-'));
const run = (script, args = [], input = '') => spawnSync(process.execPath,
  [path.join(__dirname, script), ...args], { input, encoding: 'utf8' });
let checks = 0;
function check(result, success, label) {
  assert.equal(result.status === 0, success, `${label}: ${result.stderr}`);
  checks++;
}
try {
  check(run('check-native-runtime.cjs', [root]), true, 'real SQLite opens and queries');
  // The parent has a valid module: a missing standalone copy must NOT fall back.
  const missing = path.join(root, '.runtime-test-missing-artifact');
  check(run('check-native-runtime.cjs', [missing]), false, 'missing artifact rejected');
  const fixture = path.join(temp, 'node_modules', 'better-sqlite3');
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'index.js'),
    'module.exports = class { constructor() { throw new Error("NODE_MODULE_VERSION mismatch"); } };');
  const incompatible = run('check-native-runtime.cjs', [temp]);
  check(incompatible, false, 'native constructor ABI failure rejected');
  assert.match(incompatible.stderr, /NODE_MODULE_VERSION mismatch/);
  fs.writeFileSync(path.join(fixture, 'index.js'), 'module.exports = require("./broken.node");');
  fs.writeFileSync(path.join(fixture, 'broken.node'), 'invalid native artifact');
  check(run('check-native-runtime.cjs', [temp]), false, 'real native loader rejects broken binary');
  fs.writeFileSync(path.join(fixture, 'index.js'),
    'module.exports = class { prepare() { throw new Error("database unavailable"); } close() {} };');
  check(run('check-native-runtime.cjs', [temp]), false, 'query failure rejected');
  const fresh = { rbacEnabled: true, needsSetup: true, authenticated: false, operator: null };
  check(run('check-auth-status.cjs', ['200'], JSON.stringify(fresh)), true, 'fresh setup accepted');
  check(run('check-auth-status.cjs', ['200'], JSON.stringify({ ...fresh, needsSetup: false })), true, 'configured login accepted');
  for (const [status, body] of [['500', JSON.stringify(fresh)], ['302', '{}'], ['200', '<html>Error</html>'], ['200', '{}'], ['200', 'null'], ['200', JSON.stringify({ ...fresh, authenticated: 'false' })]]) {
    check(run('check-auth-status.cjs', [status], body), false, 'unhealthy auth rejected');
  }
  // Execute the real shell response parser and final deployment gates with all
  // other services healthy. Only curl is stubbed; no network or host mutation.
  const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-prod.sh'), 'utf8');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const authBlock = deploy.slice(deploy.indexOf('AUTH_RESPONSE=$(curl'), deploy.indexOf('CERT_ISSUER='))
    .replace('/usr/bin/node', quote(process.execPath)); // local Mac test runtime
  const gate = deploy.slice(deploy.indexOf('DEPLOY_OK=1'), deploy.indexOf('\nREMOTE_SCRIPT'));
  assert.ok(authBlock && gate.includes('SETUP URL'), 'deployment snippets found');
  for (const [response, success] of [
    [JSON.stringify(fresh) + '\n200', true],
    [JSON.stringify(fresh) + '\n500', false],
    ['{}\n200', false], ['\n000', false],
  ]) {
    const shell = spawnSync('bash', ['-c', `set -euo pipefail
curl() { printf '%s' "$FIXTURE_RESPONSE"; }
${authBlock}
${gate}`], { encoding: 'utf8', env: { ...process.env,
      FIXTURE_RESPONSE: response, INSTALL_DIR: root, DOMAIN: 'test.invalid', SETUP_SECRET: 'fixture-only',
      PRESERVE_CADDY: '0', HEALTH_HTTPS: '200', HEALTH_PUBLIC: '200', HEALTH_LB: '200',
      LITELLM_ACTIVE: 'active', LITELLM_HEALTH: '200', CADDY_ACTIVE: 'active', CADDY_443: ':443', CONFIG_PATH_OK: '1',
    } });
    check(shell, success, 'real deployment authentication gate');
    assert.equal(shell.stdout.includes('SETUP URL'), success, 'setup URL only on successful deployment');
  }
  const installer = fs.readFileSync(path.join(root, 'deploy/install-prod.sh'), 'utf8');
  assert.ok(installer.includes('ExecStartPre=/usr/bin/node "${INSTALL_DIR}/scripts/check-native-runtime.cjs" "${INSTALL_DIR}/.next/standalone"'));
  for (const source of [installer, deploy]) {
    assert.ok(source.indexOf('export PATH="/usr/bin:$PATH"') < source.indexOf('npm run build'));
    const probe = source.indexOf('/usr/bin/node "$INSTALL_DIR/scripts/check-native-runtime.cjs" "$INSTALL_DIR"');
    assert.ok(probe > 0 && probe < source.indexOf('npm run build'), 'root native probe before build');
  }
  console.log(`PASS: ${checks} runtime/auth behavioral checks`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
