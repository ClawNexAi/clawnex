import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const installer = readFileSync(path.join(root, 'deploy/install-prod.sh'), 'utf8');
const wrapper = readFileSync(path.join(root, 'scripts/deploy-prod.sh'), 'utf8');
const temp = mkdtempSync(path.join(tmpdir(), 'clawnex-caddy-test-'));
const slice = (source, start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing script section: ${start}`);
  return source.slice(a, b);
};
function run(code, flags = {}) {
  return spawnSync('bash', ['-s'], {
    input: `set -e\nSUDO=sudo\nPUBLIC_DOMAIN=qa.example.com\nDOMAIN=qa.example.com\nDASHBOARD_PORT=5001\nsudo() { "$@"; }\ncaddy() { echo "CALL caddy $*"; }\nsystemctl() { echo "CALL systemctl $*"; }\napt-get() { echo UNEXPECTED_APT; return 99; }\nsleep() { :; }\n${code.replaceAll('/etc/caddy/Caddyfile', `${temp}/Caddyfile`)}\n`,
    env: { ...process.env, PRESERVE_CADDY: '1', ...flags }, encoding: 'utf8',
  });
}
try {
  const config = 'qa.example.com {\n reverse_proxy 127.0.0.1:5001 {\n header_up X-Forwarded-For {remote_host}\n }\n}\n';
  const guard = slice(installer, '# Preservation is opt-in', 'if [ ! -f "$INSTALL_DIR/.env.local" ]; then');
  writeFileSync(path.join(temp, 'Caddyfile'), config);
  assert.equal(run(guard).status, 0, 'valid existing proxy accepted');
  writeFileSync(path.join(temp, 'Caddyfile'), config.replace('qa.example.com', 'wrong.example.com'));
  assert.notEqual(run(guard).status, 0, 'wrong domain rejected');
  writeFileSync(path.join(temp, 'Caddyfile'), config.replace('header_up X-Forwarded-For', '# disabled X-Forwarded-For'));
  assert.notEqual(run(guard).status, 0, 'missing trusted forwarded-header contract rejected');
  rmSync(path.join(temp, 'Caddyfile'));
  assert.notEqual(run(guard).status, 0, 'missing configuration rejected');
  writeFileSync(path.join(temp, 'Caddyfile'), config);
  const configure = slice(installer, 'echo -e "${BOLD}[4/8]', '# systemd unit for the dashboard');
  const result = run(configure);
  assert.equal(result.status, 0, result.stderr);
  assert(!result.stdout.includes('UNEXPECTED_APT'));
  assert.equal(readFileSync(path.join(temp, 'Caddyfile'), 'utf8'), config, 'configuration byte-for-byte unchanged');
  const start = slice(installer, 'if [ "$PRESERVE_CADDY" != "1" ]; then\n$SUDO systemctl enable caddy', 'echo "  Triggering cert acquisition');
  const preserved = run(start);
  assert.equal(preserved.status, 0, preserved.stderr);
  assert(!preserved.stdout.includes('CALL systemctl restart caddy'), 'preserve must not restart Caddy');
  const normal = run(start, { PRESERVE_CADDY: '0' });
  assert.equal(normal.status, 0, normal.stderr);
  assert(normal.stdout.includes('CALL systemctl restart caddy'), 'normal install still restarts Caddy');
  const cleanup = slice(wrapper, '  if [ "${PRESERVE_CADDY:-0}" != "1" ]; then\n    sudo -A rm', '  # Watchdog cron');
  const cleanRun = run(`sudo() { shift; "$@"; }\n${cleanup}`);
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
  assert.equal(readFileSync(path.join(temp, 'Caddyfile'), 'utf8'), config, 'deep clean retains Caddyfile');
  assert(wrapper.indexOf('# Validate protected infrastructure') < wrapper.indexOf('# --- 1/8 stop services'));
  assert(wrapper.includes('-sTCP:LISTEN'), 'port cleanup must exclude connected agent clients');
  assert(wrapper.includes('PRESERVE_CADDY=\'$PRESERVE_CADDY\''), 'flag forwarded over SSH');
  assert(wrapper.includes('INSTALL_OPTIONS+=(--preserve-caddy)'), 'flag forwarded to installer');
  writeFileSync(path.join(temp, '.env.local'), 'RBAC_ENABLED=true\n');
  const dbPath = slice(wrapper, 'RESOLVED_DB_PATH=""', 'TSX_BIN=');
  const resolved = run(`set -o pipefail\nINSTALL_DIR=${temp}\n${dbPath}`);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert(resolved.stdout.includes(`${temp}/clawnex.db`), 'absent DATABASE_PATH falls back under strict error handling');
  console.log('PASS: Caddy validation, unchanged config, restart behavior, deep-clean preservation, and flag forwarding');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
