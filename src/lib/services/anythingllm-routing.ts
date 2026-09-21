import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { queryAll, queryOne, run } from '../db';
import { assertSafeProviderHttpFetchTarget, listProviders } from './config-service';
import { hasCurrentProviderReadiness, assertSelectedLiveDeployments } from './provider-routing-readiness';
import { recordRoutingOperation, recordRoutingSnapshot, stableRoutingFingerprint } from './routing-reconciliation';
import type { ConnectorRoutingItem, ConnectorRoutingSummary } from './connector-routing-inventory';

type Route = { provider: string | null; model: string | null };
export type AnythingWorkspace = Route & { id: string; slug: string; name: string; routerId: number | null; agentProvider: string | null; agentModel: string | null };
type Slot = { base: string; model: string; limit: string; keyPresent: boolean };
export type AnythingSnapshot = { provider: string; defaultModel: string; slot: Slot; workspaces: AnythingWorkspace[]; scannedAt: string };
type Choice = { selected: boolean; model: string };
type Ownership = { before: Route; after: Route };
type State = {
  snapshot: AnythingSnapshot; choices: Record<string, Choice>; ownership: Record<string, Ownership>;
  slot: Slot | null; appliedAt: string | null;
};
type Row = { id: string; name: string; management_url: string; relay_origin: string; credentials: string; state_json: string };
type Credentials = { management: string };
export type AnythingPlan = {
  id: string; connector: 'anythingllm'; sourceId: string; operation: 'apply' | 'restore'; fingerprint: string;
  changes: Array<{ key: string; name: string; before: Route; after: Route }>;
  affectedWorkspaces: string[]; retired: string[]; prerequisites: string[]; expiresAt: string; reserveSlot: boolean; slot: Slot;
};

const blank = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const same = (a: unknown, b: unknown) => stableRoutingFingerprint(a) === stableRoutingFingerprint(b);
const keyFor = (id: string) => `workspace:${id}`;
const proxyBase = () => `http://127.0.0.1:${process.env.LITELLM_PORT || '4001'}/v1`;

function cryptoKey() {
  const raw = process.env.EVIDENCE_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('Configure a persistent EVIDENCE_ENCRYPTION_KEY before adding AnythingLLM.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(raw, 'hex'), Buffer.alloc(0), 'clawnex-anythingllm-v1', 32));
}
function seal(id: string, value: Credentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify([iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')]);
}
function secrets(row: Row): Credentials {
  try {
    const [iv, tag, body] = JSON.parse(row.credentials).map((v: string) => Buffer.from(v, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), iv);
    decipher.setAAD(Buffer.from(row.id)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
  } catch { throw new Error('AnythingLLM credentials cannot be decrypted. Restore the persistent encryption key.'); }
}
function load(id: string): { row: Row; state: State } {
  const row = queryOne<Row>('SELECT * FROM anythingllm_connectors WHERE id = ?', [id]);
  if (!row) throw new Error('AnythingLLM connector not found.');
  return { row, state: JSON.parse(row.state_json) };
}
function save(id: string, state: State) {
  run('UPDATE anythingllm_connectors SET state_json = ? WHERE id = ?', [JSON.stringify(state), id]);
}
async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  // Cross-process lease. Each request is bounded to 10 seconds; at most 20 workspace changes per plan.
  const result = run('UPDATE anythingllm_connectors SET lock_token = ?, locked_until = ? WHERE id = ? AND locked_until < ?', [token, Date.now() + 600_000, id, Date.now()]);
  if (result.changes !== 1) throw new Error('Another AnythingLLM operation is running. Retry after it completes.');
  const heartbeat = setInterval(() => run('UPDATE anythingllm_connectors SET locked_until = ? WHERE id = ? AND lock_token = ?', [Date.now() + 600_000, id, token]), 30_000);
  heartbeat.unref();
  try { return await action(); }
  finally { clearInterval(heartbeat); run('UPDATE anythingllm_connectors SET lock_token = NULL, locked_until = 0 WHERE id = ? AND lock_token = ?', [id, token]); }
}

function origin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter an HTTP or HTTPS origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTP(S) origin with no path, credentials, query, or fragment.');
  }
  return url.origin;
}
async function api(row: Row, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const target = `${row.management_url}/api/v1/${path}`;
  const safe = await assertSafeProviderHttpFetchTarget(target, 'AnythingLLM configuration');
  if (safe.blocked) throw new Error('AnythingLLM address is not permitted. Use a trusted host or an approved private IP.');
  let response: Response;
  try {
    response = await fetch(target, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${secrets(row).management}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new Error('Cannot reach the AnythingLLM configuration API. Check its address and connectivity.'); }
  if (!response.ok) throw new Error(`AnythingLLM configuration API returned HTTP ${response.status}. Check the API key and supported version.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('AnythingLLM returned an empty configuration response.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('AnythingLLM configuration response is too large.'); }
    chunks.push(chunk.value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let result: Record<string, unknown>;
  try { result = JSON.parse(text); } catch { throw new Error('AnythingLLM returned an invalid configuration response.'); }
  if (!result || typeof result !== 'object' || result.error) throw new Error('AnythingLLM rejected the configuration change. Refresh and review the current state.');
  return result;
}

/** Only allowlisted, non-secret settings leave the management API boundary. */
export function parseAnythingSnapshot(settings: Record<string, unknown>, workspaces: unknown): AnythingSnapshot {
  if (typeof settings.LLMProvider !== 'string' || !Array.isArray(workspaces)) throw new Error('Unsupported AnythingLLM configuration response.');
  if (settings.LiteLLMBasePath) {
    let endpoint: URL;
    try { endpoint = new URL(String(settings.LiteLLMBasePath)); } catch { throw new Error('AnythingLLM has an invalid LiteLLM endpoint.'); }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Move credentials out of the AnythingLLM LiteLLM URL before discovery.');
  }
  const modelFields: Record<string, string> = { 'generic-openai': 'GenericOpenAiModelPref', litellm: 'LiteLLMModelPref', openai: 'OpenAiModelPref', anthropic: 'AnthropicModelPref', ollama: 'OllamaLLMModelPref', openrouter: 'OpenRouterModelPref' };
  const entries = workspaces.map((entry): AnythingWorkspace => {
    if (!entry || !Number.isInteger(entry.id) || typeof entry.slug !== 'string' || !entry.slug || typeof entry.name !== 'string') throw new Error('Unsupported AnythingLLM workspace response.');
    return { id: String(entry.id), slug: entry.slug, name: entry.name, provider: blank(entry.chatProvider), model: blank(entry.chatModel),
      routerId: entry.router_id == null ? null : Number(entry.router_id), agentProvider: blank(entry.agentProvider), agentModel: blank(entry.agentModel) };
  });
  if (new Set(entries.map(w => w.id)).size !== entries.length) throw new Error('Duplicate AnythingLLM workspace identifiers.');
  return { provider: settings.LLMProvider, defaultModel: blank(settings[modelFields[settings.LLMProvider]]) || '',
    slot: { base: blank(settings.LiteLLMBasePath) || '', model: blank(settings.LiteLLMModelPref) || '', limit: String(settings.LiteLLMTokenLimit || ''), keyPresent: Boolean(settings.LiteLLMApiKey) },
    workspaces: entries.sort((a, b) => a.id.localeCompare(b.id)), scannedAt: new Date().toISOString() };
}
async function discover(row: Row): Promise<AnythingSnapshot> {
  const [system, spaces] = await Promise.all([api(row, 'system'), api(row, 'workspaces')]);
  if (!system.settings || typeof system.settings !== 'object') throw new Error('AnythingLLM settings are unavailable.');
  return parseAnythingSnapshot(system.settings as Record<string, unknown>, spaces.workspaces);
}
function route(snapshot: AnythingSnapshot, key: string): Route | null {
  if (key === 'default') return { provider: snapshot.provider, model: null };
  const workspace = snapshot.workspaces.find(w => keyFor(w.id) === key);
  return workspace ? { provider: workspace.provider, model: workspace.model } : null;
}
function fingerprint(state: State) {
  return stableRoutingFingerprint({ ...state, snapshot: { ...state.snapshot, scannedAt: '' } });
}
function refreshChoices(state: State) {
  const present = new Set(['default', ...state.snapshot.workspaces.map(w => keyFor(w.id))]);
  for (const key of Object.keys(state.choices)) if (!present.has(key) && !state.ownership[key]) delete state.choices[key];
  for (const workspace of state.snapshot.workspaces) {
    state.choices[keyFor(workspace.id)] ??= { selected: false, model: '' };
  }
}
export function anythingModels() {
  return listProviders().filter(p => p.is_active && p.type !== 'openclaw').flatMap(p => p.models.map(m => ({
    providerId: p.id, alias: m.model_id, name: `${p.name} / ${m.model_id}`, ready: hasCurrentProviderReadiness(p.id, m.model_id),
  })));
}
function evidence(row: Row, state: State): ConnectorRoutingSummary<'anythingllm'> {
  const items: ConnectorRoutingItem<'anythingllm'>[] = [];
  const slotIntact = !!state.slot && same(state.snapshot.slot, state.slot);
  for (const [key, owner] of Object.entries(state.ownership)) {
    const current = route(state.snapshot, key);
    const alias = key === 'default' ? state.slot?.model || '' : owner.after.model || '';
    const providerId = anythingModels().find(model => model.alias === alias)?.providerId || key;
    items.push({ id: `${row.id}:${key}`, connector: 'anythingllm', sourceId: row.id, itemType: 'model', providerId,
      modelId: alias, displayName: key, baseUrl: proxyBase(), capability: 'model-inventory', currentRoute: slotIntact && state.slot?.base === proxyBase() && same(current, owner.after) ? 'routed' : 'unknown',
      desiredRoute: state.choices[key]?.selected ? 'routed' : 'direct', present: !!current, fingerprint: stableRoutingFingerprint(current),
      metadata: { proxyModelAlias: alias, identityIntact: false }, firstSeenAt: '', lastSeenAt: state.snapshot.scannedAt, updatedAt: state.snapshot.scannedAt, lastChangedAt: null });
  }
  return { connector: 'anythingllm', sourceId: row.id, items, status: 'ok', detail: 'AnythingLLM chat routing; agent overrides are outside scope.',
    drift: { new: 0, removed: 0, changed: 0, total: 0 }, selected: items.length, pendingChanges: 0, scannedAt: state.snapshot.scannedAt };
}
function view(row: Row, state: State) {
  return { id: row.id, name: row.name, managementUrl: row.management_url, proxyBaseUrl: proxyBase(),
    snapshot: state.snapshot, choices: state.choices, ownership: state.ownership, slotReserved: !!state.slot,
    slotIntact: !!state.slot && same(state.slot, state.snapshot.slot) };
}
export function listAnythingConnectors() {
  return queryAll<Row>('SELECT * FROM anythingllm_connectors ORDER BY name').map(row => view(row, JSON.parse(row.state_json)));
}
export async function listAnythingConnections() {
  return Promise.all(queryAll<Row>('SELECT * FROM anythingllm_connectors ORDER BY name').map(async row => {
    const instance = view(row, JSON.parse(row.state_json));
    try {
      await discover(row);
      return { ...instance, available: true, error: null };
    } catch (error) {
      return { ...instance, available: false, error: error instanceof Error ? error.message : 'AnythingLLM is unavailable.' };
    }
  }));
}
export async function removeAnythingConnector(id: string) {
  return locked(id, async () => {
    const { state } = load(id);
    if (Object.keys(state.ownership).length) throw new Error('Restore the managed routes in AnythingLLM Routing before removing this connector.');
    run('DELETE FROM anythingllm_connectors WHERE id = ?', [id]);
    return { removed: true };
  });
}
export async function addAnythingConnector(input: { name: string; managementUrl: string; apiKey: string }) {
  if (!input.name.trim() || input.name.length > 120 || !input.apiKey.trim() || input.apiKey.length > 4096) throw new Error('Enter a name and AnythingLLM developer API key.');
  const id = randomUUID();
  const managementUrl = origin(input.managementUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(managementUrl).hostname)) throw new Error('This connector configures host-installed AnythingLLM on the same host as ClawNex. Use its localhost address.');
  const row: Row = { id, name: input.name.trim(), management_url: managementUrl, relay_origin: '',
    credentials: seal(id, { management: input.apiKey.trim() }), state_json: '' };
  if (queryOne('SELECT id FROM anythingllm_connectors WHERE management_url = ?', [row.management_url])) throw new Error('This AnythingLLM address is already registered.');
  const snapshot = await discover(row);
  const state: State = { snapshot, choices: { default: { selected: true, model: '' } }, ownership: {}, slot: null, appliedAt: null };
  refreshChoices(state);
  run('INSERT INTO anythingllm_connectors (id, name, management_url, relay_origin, credentials, state_json) VALUES (?, ?, ?, ?, ?, ?)',
    [id, row.name, row.management_url, row.relay_origin, row.credentials, JSON.stringify(state)]);
  return view(row, state);
}
export async function refreshAnythingConnector(id: string) {
  return locked(id, async () => {
    const { row, state } = load(id); state.snapshot = await discover(row); refreshChoices(state); save(id, state);
    recordRoutingSnapshot('anythingllm', evidence(row, state), 'refresh');
    return view(row, state);
  });
}
export async function selectAnythingRoute(id: string, key: string, selected: boolean, model: string) {
  return locked(id, async () => {
    const { row, state } = load(id);
    const workspace = state.snapshot.workspaces.find(w => keyFor(w.id) === key);
    if (key !== 'default' && (!workspace || (!workspace.provider && !workspace.model && !state.ownership[key]) || workspace.routerId !== null || workspace.provider === 'anythingllm-router')) {
      throw new Error('This workspace inherits the default or uses an unsupported model router.');
    }
    if (model && !anythingModels().some(m => m.alias === model)) throw new Error('Choose a configured ClawNex model.');
    state.choices[key] = { selected, model }; save(id, state); return view(row, state);
  });
}

export function buildAnythingPlan(row: Pick<Row, 'id' | 'relay_origin'>, state: State, operation: 'apply' | 'restore'): AnythingPlan {
  const changes: AnythingPlan['changes'] = [];
  const retired: string[] = [];
  const prerequisites: string[] = [];
  const choices = operation === 'restore' ? Object.fromEntries(Object.keys(state.ownership).map(key => [key, { selected: false, model: '' }])) : state.choices;
  if (operation === 'apply' && state.choices.default?.selected && state.snapshot.provider !== 'litellm') {
    for (const workspace of state.snapshot.workspaces) {
      if (!workspace.provider && workspace.model && !state.choices[keyFor(workspace.id)]?.selected) {
        prerequisites.push(`${workspace.name} overrides its model while inheriting the default provider. Select that workspace and map its model before changing the default.`);
      }
    }
  }
  for (const [key, choice] of Object.entries(choices)) {
    const current = route(state.snapshot, key), owner = state.ownership[key];
    const workspace = state.snapshot.workspaces.find(w => keyFor(w.id) === key);
    if (!current) { if (owner) retired.push(key); continue; }
    if (owner && !same(current, owner.after) && !same(current, owner.before)) { prerequisites.push(`${workspace?.name || 'Default'} was edited outside ClawNex. Preserve those edits and resolve the conflict first.`); continue; }
    if (choice.selected) {
      if (!choice.model) { prerequisites.push(`Choose a replacement model for ${workspace?.name || 'Default chat'}.`); continue; }
      if (current.provider === 'anythingllm-router' || workspace?.routerId != null) { prerequisites.push('Router-managed workspaces are not supported.'); continue; }
      const after = { provider: 'litellm', model: key === 'default' ? null : choice.model };
      if (owner && !same(after, owner.after)) { prerequisites.push(`Restore ${workspace?.name || 'Default chat'} before changing its managed model.`); continue; }
      if (!same(current, after)) changes.push({ key, name: workspace?.name || 'Default chat', before: current, after });
    } else if (owner) changes.push({ key, name: workspace?.name || 'Default chat', before: current, after: owner.before });
  }
  const model = state.choices.default?.selected ? state.choices.default.model : Object.values(state.choices).find(c => c.selected)?.model || state.slot?.model || '';
  const slot: Slot = state.slot || { base: proxyBase(), model, limit: '32768', keyPresent: true };
  if (state.slot && state.slot.base !== proxyBase()) prerequisites.push('This connection uses the retired relay. Migrate it to the local LiteLLM proxy before applying changes.');
  const incompleteReservation = state.slot && !Object.keys(state.ownership).length && Object.entries(state.snapshot.slot).every(([key, value]) =>
    key === 'keyPresent' || !value || value === state.slot![key as keyof Slot]);
  if (state.slot && !same(state.slot, state.snapshot.slot) && !incompleteReservation) prerequisites.push('The shared ClawNex connection was edited in AnythingLLM. No connection settings will be overwritten.');
  if (operation === 'apply' && state.slot && state.choices.default?.selected && model !== slot.model) prerequisites.push('The reserved connection has a different default model. Use that model; workspace selections may use other configured models.');
  const reserveSlot = (!state.slot || (!!incompleteReservation && !same(state.slot, state.snapshot.slot))) && changes.some(c => c.after.provider === 'litellm');
  if (reserveSlot && !state.slot) {
    const used = state.snapshot.provider === 'litellm' || state.snapshot.workspaces.some(w => w.provider === 'litellm' || w.agentProvider === 'litellm');
    if (used || Object.values(state.snapshot.slot).some(Boolean)) prerequisites.push('AnythingLLM already has a LiteLLM connection. Preserve it: this first connector requires an unused LiteLLM provider slot.');
  }
  if (changes.length > 20) prerequisites.push('Apply at most 20 route changes per review.');
  return { id: randomUUID(), connector: 'anythingllm', sourceId: row.id, operation, fingerprint: fingerprint(state), changes, retired,
    affectedWorkspaces: state.snapshot.workspaces.filter(w => changes.some(c => c.key === keyFor(w.id) || (c.key === 'default' && !w.provider))).map(w => w.name),
    prerequisites, expiresAt: new Date(Date.now() + 300_000).toISOString(), reserveSlot, slot };
}
export async function prepareAnythingPlan(id: string, operation: 'apply' | 'restore') {
  return locked(id, async () => {
    const { row, state } = load(id); state.snapshot = await discover(row); refreshChoices(state); save(id, state);
    const plan = buildAnythingPlan(row, state, operation);
    if (operation === 'apply') {
      if (Buffer.byteLength(process.env.CLAWNEX_INGEST_SECRET || '') < 32) plan.prerequisites.push('Configure the ClawNex ingestion secret before routing.');
      for (const [key, choice] of Object.entries(state.choices).filter(([key, c]) => c.selected && !plan.retired.includes(key))) {
        void key;
        const matches = anythingModels().filter(m => m.alias === choice.model);
        if (matches.length !== 1 || !matches[0].ready) plan.prerequisites.push(`${choice.model || 'Selected model'}: configure and test this exact model in Model Providers first.`);
      }
    }
    run('INSERT INTO routing_change_plans (id, plan_json) VALUES (?, ?)', [plan.id, JSON.stringify(plan)]);
    return plan;
  });
}
async function writeRoute(row: Row, snapshot: AnythingSnapshot, key: string, value: Route) {
  if (key === 'default') { await api(row, 'system/update-env', { LLMProvider: value.provider }); return; }
  const workspace = snapshot.workspaces.find(w => keyFor(w.id) === key);
  if (!workspace) throw new Error('Workspace disappeared before apply.');
  await api(row, `workspace/${encodeURIComponent(workspace.slug)}/update`, { chatProvider: value.provider, chatModel: value.model });
}
export async function executeAnythingPlan(planId: string, approved: boolean, actor: string) {
  if (!approved) throw new Error('Approve the reviewed plan before applying changes.');
  const stored = queryOne<{ plan_json: string; status: string; result_json: string | null }>('SELECT * FROM routing_change_plans WHERE id = ?', [planId]);
  if (!stored) throw new Error('Review a routing plan first.');
  const plan: AnythingPlan = JSON.parse(stored.plan_json);
  if (plan.connector !== 'anythingllm') throw new Error('This is not an AnythingLLM plan.');
  if (stored.status === 'completed' && stored.result_json) return JSON.parse(stored.result_json);
  return locked(plan.sourceId, async () => {
    const currentPlan = queryOne<{ status: string }>('SELECT status FROM routing_change_plans WHERE id = ?', [planId]);
    if (currentPlan?.status !== 'prepared' || Date.parse(plan.expiresAt) <= Date.now()) throw new Error('Plan expired or already attempted. Refresh and review again.');
    const { row, state } = load(plan.sourceId);
    state.snapshot = await discover(row);
    if (fingerprint(state) !== plan.fingerprint) throw new Error('Configuration or selections changed since review. Review again.');
    if (plan.prerequisites.length) throw new Error('Resolve the plan prerequisites before applying.');
    if (plan.operation === 'apply') {
      const temp = structuredClone(state);
      for (const key of plan.retired) { delete temp.ownership[key]; delete temp.choices[key]; }
      temp.slot = plan.slot;
      for (const change of plan.changes.filter(c => c.after.provider === 'litellm')) temp.ownership[change.key] = { before: change.before, after: change.after };
      await assertSelectedLiveDeployments(evidence(row, temp));
    }
    run("UPDATE routing_change_plans SET status = 'applying' WHERE id = ?", [planId]);
    try {
      for (const key of plan.retired) { delete state.ownership[key]; delete state.choices[key]; }
      save(row.id, state);
      if (plan.reserveSlot) {
        // Persist intent before the remote mutation so interrupted operations remain recoverable.
        state.slot = plan.slot; save(row.id, state);
        await api(row, 'system/update-env', { LiteLLMBasePath: plan.slot.base, LiteLLMModelPref: plan.slot.model,
          LiteLLMTokenLimit: plan.slot.limit, ...(!state.snapshot.slot.keyPresent ? { LiteLLMApiKey: process.env.LITELLM_MASTER_KEY || 'clawnex-local' } : {}) });
        state.snapshot = await discover(row);
        if (!same(state.snapshot.slot, plan.slot)) throw new Error('AnythingLLM did not confirm the reserved connection. Recovery state was retained.');
        save(row.id, state);
      }
      for (const change of plan.changes) {
        const latest = await discover(row);
        if (!same({ ...latest, scannedAt: '' }, { ...state.snapshot, scannedAt: '' })) throw new Error('AnythingLLM changed during apply. Completed changes were retained for recovery review.');
        if (!state.ownership[change.key]) state.ownership[change.key] = { before: change.before, after: change.after };
        else if (plan.operation === 'apply' && state.choices[change.key]?.selected) state.ownership[change.key].after = change.after;
        save(row.id, state);
        await writeRoute(row, latest, change.key, change.after);
        state.snapshot = await discover(row);
        if (!same(route(state.snapshot, change.key), change.after)) throw new Error('AnythingLLM did not confirm the route change. Refresh and review recovery.');
        if (plan.operation === 'restore' || !state.choices[change.key]?.selected) {
          delete state.ownership[change.key]; state.choices[change.key].selected = false;
        }
        save(row.id, state);
      }
      state.appliedAt = new Date().toISOString(); save(row.id, state);
      recordRoutingSnapshot('anythingllm', evidence(row, state), plan.operation);
      recordRoutingOperation({ connector: 'anythingllm', sourceId: row.id, actor, operation: plan.operation === 'restore' ? 'revert' : 'apply', outcome: 'applied', detail: `${plan.changes.length} chat routes updated.` });
      const result = { ok: true, detail: `${plan.changes.length} chat route(s) updated. Send a new chat in AnythingLLM, then verify. The reserved LiteLLM connection remains available; original provider credentials were not changed.` };
      run("UPDATE routing_change_plans SET status = 'completed', result_json = ? WHERE id = ?", [JSON.stringify(result), planId]);
      return result;
    } catch (error) {
      save(row.id, state);
      run("UPDATE routing_change_plans SET status = 'failed' WHERE id = ?", [planId]);
      recordRoutingOperation({ connector: 'anythingllm', sourceId: row.id, actor, operation: plan.operation, outcome: 'failed', detail: 'Partial operation may require recovery. Refresh and review retained ownership.' });
      throw error;
    }
  });
}
export async function verifyAnythingConnector(id: string) {
  await refreshAnythingConnector(id);
  const { row, state } = load(id);
  const summary = evidence(row, state);
  const configured = summary.items.length > 0 && summary.items.every(item => item.currentRoute === 'routed');
  if (configured) await assertSelectedLiveDeployments(summary);
  return { status: configured ? 'configured' : 'configuration-mismatch',
    detail: configured
      ? `AnythingLLM is configured directly to ${proxyBase()} and its selected models are loaded. Send a chat and inspect Traffic Monitor for the result. This configuration check does not prove instance-specific traffic attribution.`
      : 'AnythingLLM does not match the managed local proxy configuration. Refresh and review its settings.' };
}

/** Explicit operator migration for connectors created by the retired relay implementation. */
export async function migrateAnythingConnectorToLocalProxy(id: string) {
  return locked(id, async () => {
    const { row, state } = load(id);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(row.management_url).hostname)) throw new Error('Move AnythingLLM to this host before migrating its connection.');
    if (!state.slot) throw new Error('No managed connection to migrate.');
    const snapshot = await discover(row);
    const retiredBase = `${row.relay_origin}/api/v1/connectors/anythingllm/${row.id}`;
    if (![retiredBase, proxyBase()].includes(snapshot.slot.base) ||
        !same({ ...snapshot.slot, base: state.slot.base }, state.slot)) throw new Error('The managed connection was edited. Preserve those edits and review before migration.');
    for (const [key, owner] of Object.entries(state.ownership)) {
      if (!same(route(snapshot, key), owner.after)) throw new Error('A managed chat route was edited. Review before migration.');
    }
    await api(row, 'system/update-env', { LiteLLMBasePath: proxyBase(), LiteLLMApiKey: process.env.LITELLM_MASTER_KEY || 'clawnex-local' });
    const after = await discover(row);
    const slot = { ...state.slot, base: proxyBase() };
    if (!same(after.slot, slot)) throw new Error('AnythingLLM did not confirm the local proxy connection.');
    state.slot = slot; state.snapshot = after; state.appliedAt = new Date().toISOString();
    save(id, state);
    run('UPDATE anythingllm_connectors SET relay_origin = ?, credentials = ? WHERE id = ?', ['', seal(id, { management: secrets(row).management }), id]);
    recordRoutingSnapshot('anythingllm', evidence(row, state), 'apply');
    recordRoutingOperation({ connector: 'anythingllm', sourceId: id, actor: 'operator-migration', operation: 'apply', outcome: 'applied', detail: 'Retired the connector relay and configured the local LiteLLM proxy directly.' });
    return { id, baseUrl: slot.base, migrated: true };
  });
}
