import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-anythingllm-test-'));
Object.assign(process.env, { DATABASE_PATH: ':memory:', CLAWNEX_TEST_SKIP_DB_SEED: '1', CLAWNEX_AUDIT_STDOUT: 'false',
  EVIDENCE_ENCRYPTION_KEY: '42'.repeat(32), CLAWNEX_INGEST_SECRET: 'anythingllm-fixture-secret-at-least-32-bytes',
  CLAWNEX_LITELLM_CONFIG: path.join(root, 'litellm.json') });
delete process.env.LITELLM_CONFIG_PATH;
const settings: Record<string, unknown> = { LLMProvider: 'generic-openai', GenericOpenAiModelPref: 'original-model', GenericOpenAiKey: true };
const workspaces: Array<Record<string, unknown>> = [];
let failWrites = false;
let writes = 0;
let info: unknown[] = [];
let lastChat: Record<string, unknown> | null = null;
let lastIdentity = '';
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  res.setHeader('Content-Type', 'application/json');
  const send = (value: unknown) => res.end(JSON.stringify(value));
  if (req.url === '/model/info') return send({ data: info });
  if (req.url === '/v1/chat/completions') {
    lastChat = body; lastIdentity = String(req.headers['x-clawnex-routing-identity'] || '');
    if (body.stream) { res.setHeader('Content-Type', 'text/event-stream'); return res.end('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'); }
    return send({ id: 'fixture-completion', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
  }
  if (req.headers.authorization !== 'Bearer fixture-management-key') { res.statusCode = 401; return send({ error: 'unauthorized' }); }
  if (req.url === '/api/v1/system') return send({ settings: { ...settings, LiteLLMApiKey: Boolean(settings.LiteLLMApiKey) } });
  if (req.url === '/api/v1/workspaces') return send({ workspaces });
  if (req.url === '/api/v1/system/update-env') {
    writes++;
    if (failWrites) return send({ error: 'API can fail with HTTP 200' });
    Object.assign(settings, body); return send({ newValues: body, error: null });
  }
  const match = req.url?.match(/^\/api\/v1\/workspace\/([^/]+)\/update$/);
  if (match) {
    writes++;
    if (failWrites) return send({ error: 'fixture update rejected' });
    const workspace = workspaces.find(w => w.slug === decodeURIComponent(match[1]));
    if (!workspace) { res.statusCode = 404; return send({}); }
    Object.assign(workspace, body);
    if (body.chatProvider && body.chatProvider !== 'anythingllm-router') workspace.router_id = null;
    return send({ workspace, message: null });
  }
  res.statusCode = 404; send({});
});

async function main() {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  process.env.LITELLM_PORT = String(port);
  const base = `http://127.0.0.1:${port}`;
  const svc = await import('../src/lib/services/anythingllm-routing');
  const { getDb, queryOne, run } = await import('../src/lib/db');
  const { addProvider, addModel } = await import('../src/lib/services/config-service');
  const { deploymentRevision } = await import('../src/lib/litellm/deployment-revision');
  const { POST: relay } = await import('../src/app/api/v1/connectors/anythingllm/[id]/chat/completions/route');
  const { NextRequest } = await import('next/server');
  try {
    await addProvider({ id: 'fixture', name: 'Fixture', type: 'openai', baseUrl: base }); addModel('fixture', 'fixture-model');
    const params = { model: 'openai/fixture-model', api_base: base, api_key: 'not-needed' };
    const revision = deploymentRevision(process.env.CLAWNEX_LITELLM_CONFIG!, 'fixture-model', params);
    info = [{ model_name: 'fixture-model', litellm_params: params, model_info: { x_clawnex_revision: revision } }];
    fs.writeFileSync(process.env.CLAWNEX_LITELLM_CONFIG!, JSON.stringify({ model_list: info }));
    run('INSERT INTO provider_routing_readiness (provider_id, model_alias, receipt_json) VALUES (?, ?, ?)', ['fixture', 'fixture-model', JSON.stringify({ ready: true, port, revision,
      fingerprint: createHash('sha256').update(fs.readFileSync(process.env.CLAWNEX_LITELLM_CONFIG!)).digest('hex'), expiresAt: new Date(Date.now() + 60_000).toISOString() })]);
    const instance = await svc.addAnythingConnector({ name: 'Fixture', managementUrl: base, relayOrigin: base, apiKey: 'fixture-management-key' });
    assert.equal(instance.snapshot.workspaces.length, 0);
    assert.equal(instance.choices.default.selected, true);
    assert.equal(writes, 0, 'Registration must not change AnythingLLM');
    const stored = queryOne<{ credentials: string }>('SELECT credentials FROM anythingllm_connectors WHERE id = ?', [instance.id])!;
    assert(!stored.credentials.includes('fixture-management-key'));
    assert(!JSON.stringify(svc.listAnythingConnectors()).includes('fixture-management-key'));
    workspaces.push({ id: 1, slug: 'inherit', name: 'Inherited', chatProvider: null, chatModel: null },
      { id: 2, slug: 'explicit', name: 'Selected override', chatProvider: 'openai', chatModel: 'gpt-test', agentProvider: 'anthropic', agentModel: 'agent-model' },
      { id: 3, slug: 'untouched', name: 'Unselected override', chatProvider: 'generic-openai', chatModel: 'untouched-model' },
      { id: 4, slug: 'router', name: 'Router', chatProvider: 'anythingllm-router', router_id: 7 });
    let refreshed = await svc.refreshAnythingConnector(instance.id);
    assert.equal(refreshed.choices['workspace:2'].selected, false);
    assert.equal(refreshed.snapshot.workspaces[1].agentProvider, 'anthropic');
    await assert.rejects(svc.selectAnythingRoute(instance.id, 'workspace:1', true, 'fixture-model'), /inherits/);
    await assert.rejects(svc.selectAnythingRoute(instance.id, 'workspace:4', true, 'fixture-model'), /unsupported/);
    await svc.selectAnythingRoute(instance.id, 'default', true, 'fixture-model');
    await svc.selectAnythingRoute(instance.id, 'workspace:2', true, 'fixture-model');
    let plan = await svc.prepareAnythingPlan(instance.id, 'apply');
    assert.deepEqual(plan.prerequisites, []);
    assert.deepEqual(plan.affectedWorkspaces, ['Inherited', 'Selected override']);
    workspaces[1].name = 'Renamed'; workspaces[1].slug = 'renamed';
    await assert.rejects(svc.executeAnythingPlan(plan.id, true, 'fixture'), /changed since review/);
    refreshed = await svc.refreshAnythingConnector(instance.id);
    assert.equal(refreshed.choices['workspace:2'].selected, true, 'Stable ID preserves selection across rename');
    plan = await svc.prepareAnythingPlan(instance.id, 'apply');
    await assert.rejects(svc.executeAnythingPlan(plan.id, false, 'fixture'), /Approve/);
    failWrites = true;
    await assert.rejects(svc.executeAnythingPlan(plan.id, true, 'fixture'), /rejected/);
    failWrites = false;
    plan = await svc.prepareAnythingPlan(instance.id, 'apply');
    assert.deepEqual(plan.prerequisites, [], 'An interrupted unused-slot reservation can be retried safely');
    await svc.executeAnythingPlan(plan.id, true, 'fixture');
    const writesAfter = writes;
    await svc.executeAnythingPlan(plan.id, true, 'fixture');
    assert.equal(writes, writesAfter, 'Repeated approved plan is idempotent');
    assert.equal(settings.LLMProvider, 'litellm');
    assert.equal(settings.GenericOpenAiModelPref, 'original-model');
    assert.equal(workspaces[0].chatProvider, null);
    assert.equal(workspaces[1].chatProvider, 'litellm');
    assert.equal(workspaces[1].agentProvider, 'anthropic');
    assert.equal(workspaces[2].chatProvider, 'generic-openai');
    assert.equal(workspaces[3].router_id, 7);
    assert.equal((await svc.verifyAnythingConnector(instance.id)).status, 'pending-traffic');
    const call = (authorization: string, extra: Record<string, unknown> = {}) => relay(new NextRequest(`${base}/chat`, { method: 'POST', headers: { authorization },
      body: JSON.stringify({ model: 'fixture-model', messages: [{ role: 'user', content: 'OK' }], stream: true, ...extra }) }), { params: Promise.resolve({ id: instance.id }) });
    assert.equal((await call('Bearer wrong')).status, 401);
    assert.equal((await call(`Bearer ${settings.LiteLLMApiKey}`, { model: 'unapproved' })).status, 401);
    const response = await call(`Bearer ${settings.LiteLLMApiKey}`, { api_base: 'http://evil.test', metadata: { clawnex_routing_source_id: 'forged' }, api_key: 'evil' });
    assert.equal(response.status, 200); assert((await response.text()).includes('[DONE]'));
    assert(lastIdentity.includes('.'));
    assert(!('api_base' in lastChat!)); assert(!('metadata' in lastChat!)); assert(!('api_key' in lastChat!));
    // External edits must prevent restore, not be silently replaced.
    workspaces[1].chatModel = 'operator-edit';
    plan = await svc.prepareAnythingPlan(instance.id, 'restore'); assert(plan.prerequisites.some(p => p.includes('edited outside')));
    await assert.rejects(svc.executeAnythingPlan(plan.id, true, 'fixture'), /prerequisites/);
    workspaces[1].chatModel = 'fixture-model';
    plan = await svc.prepareAnythingPlan(instance.id, 'restore');
    failWrites = true;
    await assert.rejects(svc.executeAnythingPlan(plan.id, true, 'fixture'), /rejected/);
    assert(Object.keys(svc.listAnythingConnectors()[0].ownership).length > 0, 'Recovery ownership survives failed writes');
    failWrites = false;
    plan = await svc.prepareAnythingPlan(instance.id, 'restore'); await svc.executeAnythingPlan(plan.id, true, 'fixture');
    assert.equal(settings.LLMProvider, 'generic-openai'); assert.equal(workspaces[1].chatModel, 'gpt-test');
    assert.equal(workspaces[1].agentProvider, 'anthropic'); assert.equal(workspaces[2].chatModel, 'untouched-model');
    assert.equal(Object.keys(svc.listAnythingConnectors()[0].ownership).length, 0);
    assert.equal((await call(`Bearer ${settings.LiteLLMApiKey}`)).status, 401, 'Restored connector key cannot perform inference');
    workspaces.push({ id: 5, slug: 'later', name: 'Created later', chatProvider: 'openai', chatModel: 'later-model' });
    refreshed = await svc.refreshAnythingConnector(instance.id);
    assert.equal(refreshed.choices['workspace:5'].selected, false);
    workspaces.pop(); await svc.refreshAnythingConnector(instance.id);
    assert.equal(svc.listAnythingConnectors()[0].choices['workspace:5'], undefined);
    await svc.selectAnythingRoute(instance.id, 'workspace:2', true, 'fixture-model');
    plan = await svc.prepareAnythingPlan(instance.id, 'apply'); await svc.executeAnythingPlan(plan.id, true, 'fixture');
    workspaces.splice(1, 1);
    plan = await svc.prepareAnythingPlan(instance.id, 'restore');
    assert.deepEqual(plan.retired, ['workspace:2']);
    await svc.executeAnythingPlan(plan.id, true, 'fixture');
    assert.equal(Object.keys(svc.listAnythingConnectors()[0].ownership).length, 0);
    workspaces.push({ id: 6, slug: 'model-only', name: 'Model-only override', chatProvider: null, chatModel: 'custom-model' });
    await svc.refreshAnythingConnector(instance.id);
    await svc.selectAnythingRoute(instance.id, 'default', true, 'fixture-model');
    plan = await svc.prepareAnythingPlan(instance.id, 'apply');
    assert(plan.prerequisites.some(p => p.includes('overrides its model')));
    await svc.selectAnythingRoute(instance.id, 'workspace:6', true, 'fixture-model');
    plan = await svc.prepareAnythingPlan(instance.id, 'apply'); assert.deepEqual(plan.prerequisites, []);
    console.log('PASS: AnythingLLM discovery, encrypted credentials, workspace inheritance/opt-in, stable selections, review expiry/conflicts, idempotent apply, streaming relay/auth/model limits, failure recovery, and restore.');
  } finally { getDb().close(); server.closeAllConnections(); server.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); server.closeAllConnections(); server.close(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = 1; });
