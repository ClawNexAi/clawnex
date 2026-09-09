/** Disposable browser-QA server. Never reads/writes operator tool configurations. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-routing-ui-'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'fixture.db'), CLAWNEX_TEST_SKIP_DB_SEED: '1',
  OPENCLAW_HOME: path.join(root, 'openclaw'), HERMES_HOME: path.join(root, 'hermes'),
  OPENCLAW_SESSIONS_PATH: path.join(root, 'openclaw', 'sessions'),
  OPENCLAW_WORKSPACE_PATH: path.join(root, 'openclaw', 'workspace'),
  SESSION_WATCHER_ENABLED: 'false',
  CLAWNEX_INGEST_SECRET: 'fixture-only-routing-identity-secret-32-bytes',
  CLAWNEX_SELECTIVE_ROUTING_SIDECAR: path.join(root, 'openclaw-managed.json'),
  CLAWNEX_HERMES_ROUTING_SIDECAR: path.join(root, 'hermes-managed.json'),
  CLAWNEX_LEGACY_ROUTING_SIDECAR: path.join(root, 'legacy-managed.json'),
  CLAWNEX_LITELLM_CONFIG: path.join(root, 'litellm.yaml'),
  RBAC_ENABLED: 'false', NEXT_PUBLIC_RBAC_ENABLED: 'false',
  LITELLM_PORT: '15999', OPENCLAW_GATEWAY_URL: 'http://127.0.0.1:15998',
  HOSTNAME: '127.0.0.1', CLAWNEX_AUDIT_STDOUT: 'false',
});
delete process.env.LITELLM_CONFIG_PATH;
fs.mkdirSync(process.env.OPENCLAW_HOME!);
fs.mkdirSync(process.env.HERMES_HOME!);
fs.writeFileSync(path.join(process.env.OPENCLAW_HOME!, 'openclaw.json'), JSON.stringify({ models: { providers: {
  'local-inference': { baseUrl: 'http://127.0.0.1:15997/v1', models: [{ id: 'fixture-model' }, { id: 'fixture-code-model' }] },
  'oauth-session': { models: [{ id: 'session-model' }] },
} } }));
fs.writeFileSync(path.join(process.env.HERMES_HOME!, 'config.yaml'), 'custom_providers:\n  - name: local-inference\n    base_url: http://127.0.0.1:15997/v1\n    api_mode: chat_completions\nmodel:\n  provider: local-inference\n  default: fixture-model\n');
fs.writeFileSync(process.env.CLAWNEX_LITELLM_CONFIG!, 'model_list: []\n');

async function main() {
  const { getDb } = await import('../src/lib/db');
  const { addProvider, addModel } = await import('../src/lib/services/config-service');
  const routing = await import('../src/lib/services/connector-routing-inventory');
  await addProvider({ id: 'fixture', name: 'QA fixture · no real inference', type: 'lmstudio', baseUrl: 'http://127.0.0.1:15997/v1' });
  addModel('fixture', 'fixture-model'); addModel('fixture', 'fixture-code-model');
  routing.syncConnectorRoutingInventory();
  routing.setAllConnectorRoutingSelections('openclaw', 'routed');
  routing.setAllConnectorRoutingSelections('hermes', 'routed');
  getDb().close();
  console.log(`Isolated fixture: ${root}\nBrowser URL: http://127.0.0.1:15001/#tab=configuration`);
  const production = process.argv.includes('--production');
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...(production ? ['start'] : ['dev', '--webpack']), '-H', '127.0.0.1', '-p', '15001'],
    { stdio: 'inherit', env: { ...process.env, NODE_ENV: production ? 'production' : 'development' } });
  process.on('SIGINT', () => child.kill('SIGTERM'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', code => { fs.rmSync(root, { recursive: true, force: true }); process.exitCode = code || 0; });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
