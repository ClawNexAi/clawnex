/**
 * ClawNex Configuration Service
 *
 * Central service for managing providers, models, gateways, and defaults.
 * This is the single source of truth for all configuration state stored in
 * the database. The Configuration panel in the dashboard calls these functions
 * through API routes.
 *
 * Key responsibilities:
 * - Provider CRUD (config_providers table): LM Studio, OpenRouter, Anthropic, OpenAI, NVIDIA NIM, etc.
 * - Model CRUD (config_models table): models per provider, with auto-seeding for known types
 * - Gateway CRUD (config_gateways table): OpenClaw gateway instances
 * - Settings (config_defaults table): key-value store for runtime configuration
 *
 * Auto-seeding: when addProvider() is called with a known type (openrouter, anthropic, openai, nvidia-nim),
 * popular models are automatically inserted into config_models. This populates the model
 * dropdown in the Configuration UI without requiring manual model entry.
 *
 * @module services/config-service
 */

import { queryAll, queryOne, run, transaction } from '../db/index';
import { isIP } from 'node:net';
import { promises as dnsPromises } from 'node:dns';

// ---------------------------------------------------------------------------
// Security: warn when sending credentials over plain HTTP to non-local hosts
// ---------------------------------------------------------------------------

function warnIfInsecure(url: string, context: string): void {
  try {
    const parsed = new URL(url);
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol === 'http:' && !isLocalhost) {
      console.warn(`[SECURITY] ${context}: sending credentials over insecure HTTP to ${url}. Consider using HTTPS.`);
    }
  } catch {
    // Invalid URL — warn anyway
    if (url.startsWith('http://')) {
      console.warn(`[SECURITY] ${context}: sending credentials over insecure HTTP to ${url}. Consider using HTTPS.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Security: SSRF guard for testProvider / testGateway (closes CX-R14-05)
// ---------------------------------------------------------------------------
//
// A config:write operator can set provider.base_url to anything. Without a
// guard, the test endpoints will happily issue an authenticated fetch (with
// the stored API key as a Bearer token) to:
//   - http://169.254.169.254/latest/meta-data/...   (AWS metadata → IAM creds)
//   - http://10.x.y.z/some-admin-panel               (internal RFC1918)
//   - http://fd00::xxxx/                              (IPv6 ULA)
//
// Block private/link-local/metadata/reserved ranges. Loopback is intentionally
// ALLOWED because legitimate flows (OpenClaw gateway on 127.0.0.1, LM Studio
// on localhost:1234) depend on it. The threat model accepts "operator who can
// already configure providers can probe local services" — they can probe via
// other means anyway. The headline risk is cross-host SSRF to cloud metadata.

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
}

function isBlockedRange(ip: string): boolean {
  // Strip IPv4-mapped IPv6 prefix and recurse on the IPv4 form.
  const ipv4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped) return isBlockedRange(ipv4Mapped[1]);

  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map((n) => parseInt(n, 10));
    if (a === 10) return true;                              // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;                // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true;                // 169.254.0.0/16 link-local + metadata
    if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64.0.0/10 CGNAT
    if (a === 0) return true;                               // 0.0.0.0/8 "this host"
    if (a >= 224) return true;                              // 224.0.0.0/4 multicast + 240/4 reserved
    return false;
  }
  if (isIP(ip) === 6) {
    const lc = ip.toLowerCase();
    if (lc.startsWith('fc') || lc.startsWith('fd')) return true;  // fc00::/7 ULA
    if (/^fe[89ab]/.test(lc)) return true;                        // fe80::/10 link-local
    return false;
  }
  return false;
}

async function assertSafeFetchTarget(url: string, context: string): Promise<{ blocked: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { blocked: true, reason: 'invalid URL' };
  }
  // Node's URL.hostname leaves IPv6 brackets in place on some versions; strip
  // them so isIP() recognizes the address as IPv6 and DNS lookups don't choke.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  let ips: string[];
  if (isIP(host)) {
    ips = [host];
  } else {
    try {
      const records = await dnsPromises.lookup(host, { all: true });
      ips = records.map((r) => r.address);
    } catch {
      return { blocked: true, reason: `hostname did not resolve (${host})` };
    }
  }
  for (const ip of ips) {
    if (isLoopbackIp(ip)) continue;  // legitimate for OpenClaw / LM Studio
    if (isBlockedRange(ip)) {
      const reason = `target ${host} resolves to ${ip} (private/link-local/metadata/reserved range — refused for ${context})`;
      console.warn(`[SECURITY] ${context}: ${reason}`);
      return { blocked: true, reason };
    }
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigProvider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ConfigModel {
  id: string;
  provider_id: string;
  model_id: string;
  name: string | null;
  is_default: number;
  context_window: number;
  max_output: number;
  supports_reasoning: number;
  supports_vision: number;
  created_at: string;
}

export interface ConfigGateway {
  id: string;
  name: string;
  url: string;
  token: string;
  client_name: string;
  is_active: number;
  is_primary: number;
  status: string;
  last_connected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigDefault {
  key: string;
  value: string;
  updated_at: string;
}

export interface ProviderWithModels extends ConfigProvider {
  models: ConfigModel[];
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Mask a secret string for safe display — shows first 4 and last 4 chars. */
function maskSecret(secret: string | null | undefined): string {
  if (!secret) return "";
  if (secret.length <= 10) return "****";
  return `${secret.slice(0, 4)}${"*".repeat(Math.min(secret.length - 8, 20))}${secret.slice(-4)}`;
}

/** Redact the api_key field from a provider record for safe GET responses. */
export function redactProvider<T extends { api_key?: string }>(p: T): T & { api_key_masked: string } {
  return { ...p, api_key_masked: maskSecret(p.api_key), api_key: "" };
}

/** Redact the token field from a gateway record for safe GET responses. */
export function redactGateway<T extends { token?: string }>(g: T): T & { token_masked: string } {
  return { ...g, token_masked: maskSecret(g.token), token: "" };
}

export function listProviders(): ProviderWithModels[] {
  const providers = queryAll<ConfigProvider>('SELECT * FROM config_providers ORDER BY is_default DESC, name ASC');
  if (providers.length === 0) return [];

  // 2026-04-22 (Task 9 — perf): replace N+1 (one SELECT per provider) with a
  // single SELECT plus in-memory group-by. idx_config_models_provider already
  // exists, so the single-query version is a sort-merge over the index.
  const allModels = queryAll<ConfigModel>(
    'SELECT * FROM config_models ORDER BY provider_id, is_default DESC, model_id ASC'
  );
  const modelsByProvider = new Map<string, ConfigModel[]>();
  for (const m of allModels) {
    const list = modelsByProvider.get(m.provider_id);
    if (list) list.push(m);
    else modelsByProvider.set(m.provider_id, [m]);
  }
  return providers.map(p => ({
    ...p,
    models: modelsByProvider.get(p.id) || [],
  }));
}

export function getProvider(id: string): ProviderWithModels | undefined {
  const p = queryOne<ConfigProvider>('SELECT * FROM config_providers WHERE id = ?', [id]);
  if (!p) return undefined;
  return {
    ...p,
    models: queryAll<ConfigModel>('SELECT * FROM config_models WHERE provider_id = ? ORDER BY is_default DESC, model_id ASC', [p.id]),
  };
}

// Default models to seed per provider type
const SEED_MODELS: Record<string, Array<{ model_id: string; name: string }>> = {
  openrouter: [
    // 2026-05-09: seed the operator's two core OpenRouter targets — auto-router
    // for "just work" use and gpt-oss-120b as the explicit default model.
    // Both are pickable / removable. Other popular models (Claude / GPT /
    // Gemini / Llama / Qwen) are operator-added when needed; we don't
    // poison the install with 8 active models on every fresh add.
    // Adding a richer catalog picker UI is queued as a v1.1 follow-up.
    { model_id: "openrouter/auto", name: "Auto (best available)" },
    { model_id: "openrouter/openai/gpt-oss-120b", name: "GPT-OSS 120B" },
  ],
  anthropic: [
    { model_id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { model_id: "claude-haiku-4-20250414", name: "Claude Haiku 4" },
  ],
  openai: [
    { model_id: "gpt-4o", name: "GPT-4o" },
    { model_id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { model_id: "o3-mini", name: "o3-mini" },
  ],
  "nvidia-nim": [
    { model_id: "nvidia/llama-3.3-nemotron-super-49b-v1", name: "Llama 3.3 Nemotron Super 49B" },
  ],
};

// Codex 2026-05-17 round 2 #3: even with a write-time DNS check, the
// stored base_url is a hostname that LiteLLM re-resolves at chat time.
// An attacker hostname can resolve public at save time and rebind to
// private/metadata at use time (TOCTOU DNS rebinding against LiteLLM).
// Defence: hostname allowlist. We only allow hostnames on
// PROVIDER_HOST_ALLOWLIST (known public LLM providers) plus operator-
// added entries in env TRUSTED_PROVIDER_HOSTS. Literal loopback IPs
// stay allowed (legitimate for OpenClaw / LM Studio). The existing
// DNS+range check then runs as defense-in-depth so a misconfigured
// allowlist entry can't shortcut to private space.
const PROVIDER_HOST_ALLOWLIST: ReadonlyArray<string> = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',  // Google Gemini
  'api.mistral.ai',
  'api.groq.com',
  'api.perplexity.ai',
  'api.deepseek.com',
  'api.together.xyz',
  'openrouter.ai',
  'api.x.ai',                            // xAI / Grok
  'api.cohere.ai',
  'api.fireworks.ai',
  'integrate.api.nvidia.com',
  'ai.api.nvidia.com',
];

function getProviderHostAllowlist(): Set<string> {
  const list = new Set<string>(PROVIDER_HOST_ALLOWLIST);
  const extra = process.env.TRUSTED_PROVIDER_HOSTS;
  if (extra) {
    for (const raw of extra.split(',').map(s => s.trim()).filter(Boolean)) {
      // Run each through a URL parser so port-bearing or scheme-prefixed
      // entries (https://my-llm.example) get normalized to the bare hostname.
      try { list.add(new URL(`http://${raw.replace(/^https?:\/\//, '')}`).hostname.toLowerCase()); }
      catch { /* malformed entry — skip */ }
    }
  }
  return list;
}

async function rejectIfWriteTargetUnsafe(url: string): Promise<{ blocked: boolean; reason?: string }> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { blocked: true, reason: 'invalid URL' }; }
  if (!/^(https?|wss?):$/.test(parsed.protocol)) {
    return { blocked: true, reason: `disallowed scheme: ${parsed.protocol}` };
  }

  // Loopback always allowed — both literal IPs (127.0.0.1 / ::1) and the
  // conventional 'localhost' hostname (which most self-hosted model
  // servers default to). No allowlist check needed — the OS guarantees
  // a loopback bind can't be hijacked across the network. For OTHER
  // hostnames an operator wants to point at loopback via /etc/hosts,
  // add them to TRUSTED_PROVIDER_HOSTS (the defense-in-depth DNS check
  // below will then confirm they resolve to loopback and let them through).
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
  if (LOOPBACK_HOSTNAMES.has(host.toLowerCase())) {
    return { blocked: false };
  }
  if (isIP(host) && isLoopbackIp(host)) {
    return { blocked: false };
  }

  // Hostname (non-IP) MUST be on the allowlist to defeat DNS-rebinding
  // TOCTOU between save time and LiteLLM chat-time re-resolution.
  // Literal non-loopback IPs fall through to the DNS+range guard below,
  // which catches private/metadata IPs directly.
  if (!isIP(host)) {
    const allowed = getProviderHostAllowlist();
    if (!allowed.has(host.toLowerCase())) {
      return {
        blocked: true,
        reason: `provider hostname '${host}' is not on the trusted-provider allowlist. ` +
                `Add it via env TRUSTED_PROVIDER_HOSTS (comma-separated) for self-hosted endpoints, ` +
                `or use a loopback IP (127.0.0.1 / ::1) for local model servers.`,
      };
    }
  }

  // Defense-in-depth: even allowlisted hostnames go through the DNS+range
  // walker so a poisoned allowlist entry can't shortcut to private space.
  // Literal non-loopback IPs also land here for the range check.
  return assertSafeFetchTarget(url, 'addProvider/updateProvider');
}

export async function addProvider(data: { id?: string; name: string; type: string; baseUrl: string; apiKey?: string }): Promise<ProviderWithModels> {
  const safety = await rejectIfWriteTargetUnsafe(data.baseUrl);
  if (safety.blocked) {
    throw new Error(`Refused to add provider: ${safety.reason}`);
  }
  const id = data.id || `provider-${Date.now()}`;
  run(
    `INSERT INTO config_providers (id, name, type, base_url, api_key, is_default, is_active)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [id, data.name, data.type, data.baseUrl, data.apiKey || '']
  );

  // Seed default models for known provider types
  const typeKey = (data.type || "").toLowerCase();
  const seeds = SEED_MODELS[typeKey];
  if (seeds) {
    for (const s of seeds) {
      try {
        run(
          `INSERT OR IGNORE INTO config_models (id, provider_id, model_id, name, is_default, context_window)
           VALUES (?, ?, ?, ?, 0, 128000)`,
          [`${id}::${s.model_id}`, id, s.model_id, s.name]
        );
      } catch {}
    }
  }

  return getProvider(id)!;
}

export async function updateProvider(id: string, data: Partial<{ name: string; type: string; baseUrl: string; apiKey: string; isActive: boolean }>): Promise<ProviderWithModels | undefined> {
  const existing = getProvider(id);
  if (!existing) return undefined;

  if (data.baseUrl !== undefined) {
    const safety = await rejectIfWriteTargetUnsafe(data.baseUrl);
    if (safety.blocked) {
      throw new Error(`Refused to update provider: ${safety.reason}`);
    }
  }

  if (data.name !== undefined) run('UPDATE config_providers SET name = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.name, id]);
  if (data.type !== undefined) run('UPDATE config_providers SET type = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.type, id]);
  if (data.baseUrl !== undefined) run('UPDATE config_providers SET base_url = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.baseUrl, id]);
  if (data.apiKey !== undefined) run('UPDATE config_providers SET api_key = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.apiKey, id]);
  if (data.isActive !== undefined) run('UPDATE config_providers SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.isActive ? 1 : 0, id]);

  return getProvider(id);
}

export function removeProvider(id: string): { success: boolean; error?: string } {
  const p = queryOne<ConfigProvider>('SELECT * FROM config_providers WHERE id = ?', [id]);
  if (!p) return { success: false, error: 'Provider not found' };
  if (p.is_default) return { success: false, error: 'Cannot delete the default provider' };

  transaction(() => {
    run('DELETE FROM config_models WHERE provider_id = ?', [id]);
    run('DELETE FROM config_providers WHERE id = ?', [id]);
  });
  return { success: true };
}

export async function testProvider(id: string): Promise<{ status: string; models?: string[]; totalCount?: number; error?: string }> {
  const p = queryOne<ConfigProvider>('SELECT * FROM config_providers WHERE id = ?', [id]);
  if (!p) return { status: 'error', error: 'Provider not found' };

  // For openclaw type, test via HTTP health endpoint (no auth — gateway uses WebSocket auth)
  const baseUrl = p.type === 'openclaw'
    ? p.base_url.replace('ws://', 'http://').replace('wss://', 'https://')
    : p.base_url;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // OpenClaw gateway authenticates via WebSocket challenge-response, not Bearer token
    if (p.api_key && p.type !== 'openclaw') headers['Authorization'] = `Bearer ${p.api_key}`;

    const modelsUrl = p.type === 'openclaw' ? `${baseUrl}/health` : `${baseUrl}/models`;
    if (headers['Authorization']) warnIfInsecure(modelsUrl, `testProvider(${p.name})`);
    // SSRF guard — block private/link-local/metadata before any auth header is sent.
    const safety = await assertSafeFetchTarget(modelsUrl, `testProvider(${p.name})`);
    if (safety.blocked) {
      clearTimeout(timeout);
      return { status: 'error', error: safety.reason };
    }
    // redirect:'error' closes internal reviewer P1-D 2026-05-14 — the SSRF guard above
    // resolves the ORIGINAL URL via DNS, but fetch() follows redirects by
    // default. A public-IP target that 302s to 169.254.169.254 would have
    // bypassed assertSafeFetchTarget entirely. Refusing redirects forces
    // the operator to point base_url at the final endpoint directly.
    const res = await fetch(modelsUrl, { signal: controller.signal, headers, redirect: 'error' });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      // OpenClaw health endpoint returns {ok, status} not a model list
      if (p.type === 'openclaw') {
        return { status: 'connected', models: [] };
      }
      let models = (data.data || data || [])
        .map((m: { id?: string }) => m.id)
        .filter(Boolean) as string[];
      const totalCount = models.length;

      // OpenRouter-specific normalization 2026-05-09:
      //
      // 1. /v1/models returns raw model IDs without the "openrouter/" prefix
      //    (e.g. "openai/gpt-4o"), but our DB + LiteLLM config use the
      //    prefixed form ("openrouter/openai/gpt-4o"). Without normalizing,
      //    the dashboard's discover-list never matches an active model on
      //    isConfigured, so removing an active model leaves it nowhere
      //    visible until manual re-type.
      // 2. The auto-router keyword "openrouter/auto" isn't in /v1/models
      //    at all (it's a routing pseudo-model). Inject it so it shows
      //    up as a pickable green tag.
      // 3. openai/gpt-oss-120b — the operator's core model — needs an explicit
      //    inject because it may or may not be in /v1/models depending on
      //    catalog state.
      // 4. inclusionai/ring* and inclusionai/ling* are noisy free-tier
      //    variants operator doesn't want surfaced in the picker.
      if ((p.type || '').toLowerCase() === 'openrouter') {
        // Filter out noisy free-tier variants
        models = models.filter((id: string) => {
          const lower = id.toLowerCase();
          return !lower.startsWith('inclusionai/ring') &&
                 !lower.startsWith('inclusionai/ling');
        });
        // Prefix-normalize so the discover-list matches our stored format
        models = models.map((id: string) =>
          id.startsWith('openrouter/') ? id : `openrouter/${id}`
        );
        // the operator's two pinned defaults (auto + gpt-oss-120b) MUST always
        // appear in the picker. Strategy: remove them from wherever they
        // currently sit, then re-insert at the head. This guarantees they
        // survive the 50-item slice below regardless of OpenRouter's
        // /v1/models response ordering. v1 of this fix put them after
        // the slice, which dropped gpt-oss-120b when it sat past index 50
        // in OpenRouter's ordering — operator-flagged 2026-05-09.
        const PINNED = ['openrouter/auto', 'openrouter/openai/gpt-oss-120b'];
        models = models.filter((id: string) => !PINNED.includes(id));
        models = [...PINNED, ...models];
      }

      // 2026-05-09: server returns ALL filtered models (no slice). Client
      // renders the top 25 by default and lets the operator search across
      // the full set when they need a specific model. Sending the full
      // ~365 strings is cheap (each ~30 bytes ≈ 11KB total).
      return { status: 'connected', models, totalCount };
    }
    return { status: 'error', error: `HTTP ${res.status}` };
  } catch (err) {
    return { status: 'offline', error: err instanceof Error ? err.message : 'unreachable' };
  }
}

export async function discoverModels(providerId: string): Promise<ConfigModel[]> {
  const result = await testProvider(providerId);
  if (result.status !== 'connected' || !result.models) return [];

  transaction(() => {
    for (const modelId of result.models!) {
      const compositeId = `${providerId}::${modelId}`;
      const existing = queryOne<ConfigModel>('SELECT * FROM config_models WHERE id = ?', [compositeId]);
      if (!existing) {
        run(
          `INSERT INTO config_models (id, provider_id, model_id, name, is_default)
           VALUES (?, ?, ?, ?, 0)`,
          [compositeId, providerId, modelId, modelId]
        );
      }
    }
  });

  return queryAll<ConfigModel>('SELECT * FROM config_models WHERE provider_id = ? ORDER BY model_id ASC', [providerId]);
}

export function setDefaultProvider(id: string): { success: boolean; error?: string } {
  const p = queryOne<ConfigProvider>('SELECT * FROM config_providers WHERE id = ?', [id]);
  if (!p) return { success: false, error: 'Provider not found' };

  transaction(() => {
    run('UPDATE config_providers SET is_default = 0, updated_at = datetime(\'now\')');
    run('UPDATE config_providers SET is_default = 1, updated_at = datetime(\'now\') WHERE id = ?', [id]);
    setSetting('default_provider', id);
  });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export function listModels(providerId?: string): (ConfigModel & { provider_name?: string; provider_type?: string })[] {
  if (providerId) {
    return queryAll<ConfigModel & { provider_name: string; provider_type: string }>(
      `SELECT m.*, p.name as provider_name, p.type as provider_type
       FROM config_models m JOIN config_providers p ON m.provider_id = p.id
       WHERE m.provider_id = ? ORDER BY m.is_default DESC, m.model_id ASC`,
      [providerId]
    );
  }
  return queryAll<ConfigModel & { provider_name: string; provider_type: string }>(
    `SELECT m.*, p.name as provider_name, p.type as provider_type
     FROM config_models m JOIN config_providers p ON m.provider_id = p.id
     WHERE p.is_active = 1
     ORDER BY m.is_default DESC, p.name ASC, m.model_id ASC`
  );
}

/** Add a discovered model to the configured list for a provider. */
export function addModel(providerId: string, modelId: string, name?: string): void {
  const id = `${providerId}::${modelId}`;
  const existing = queryOne<{ id: string }>('SELECT id FROM config_models WHERE id = ?', [id]);
  if (existing) return; // Already configured
  run(
    `INSERT INTO config_models (id, provider_id, model_id, name) VALUES (?, ?, ?, ?)`,
    [id, providerId, modelId, name || modelId],
  );
}

/** Remove a model from the configured list. */
export function removeModel(providerId: string, modelId: string): void {
  const id = `${providerId}::${modelId}`;
  run('DELETE FROM config_models WHERE id = ?', [id]);
}

/** Check if a model is in the configured list. */
export function isModelConfigured(providerId: string, modelId: string): boolean {
  const id = `${providerId}::${modelId}`;
  return !!queryOne<{ id: string }>('SELECT id FROM config_models WHERE id = ?', [id]);
}

export function getDefaultModel(): { provider: ConfigProvider; model: ConfigModel } | undefined {
  const defaultProviderId = getSetting('default_provider');
  const defaultModelId = getSetting('default_model');

  if (defaultProviderId && defaultModelId) {
    const provider = queryOne<ConfigProvider>('SELECT * FROM config_providers WHERE id = ?', [defaultProviderId]);
    const compositeId = `${defaultProviderId}::${defaultModelId}`;
    const model = queryOne<ConfigModel>('SELECT * FROM config_models WHERE id = ?', [compositeId]);
    if (provider && model) return { provider, model };
  }

  // Fallback: find the model with is_default=1
  const model = queryOne<ConfigModel>('SELECT * FROM config_models WHERE is_default = 1');
  if (model) {
    const provider = queryOne<ConfigProvider>('SELECT * FROM config_providers WHERE id = ?', [model.provider_id]);
    if (provider) return { provider, model };
  }

  return undefined;
}

export function setDefaultModel(providerId: string, modelId: string): { success: boolean; error?: string } {
  // Try composite ID first, then fall back to provider_id + model_id match
  const compositeId = `${providerId}::${modelId}`;
  let model = queryOne<ConfigModel>('SELECT * FROM config_models WHERE id = ?', [compositeId]);
  if (!model) {
    model = queryOne<ConfigModel>('SELECT * FROM config_models WHERE provider_id = ? AND model_id = ?', [providerId, modelId]);
  }
  if (!model) return { success: false, error: 'Model not found' };

  transaction(() => {
    run('UPDATE config_models SET is_default = 0');
    run('UPDATE config_models SET is_default = 1 WHERE id = ?', [model!.id]);
    setSetting('default_model', modelId);
    setSetting('default_provider', providerId);
  });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Gateways
// ---------------------------------------------------------------------------

export function listGateways(): ConfigGateway[] {
  return queryAll<ConfigGateway>('SELECT * FROM config_gateways ORDER BY is_primary DESC, name ASC');
}

export function getGateway(id: string): ConfigGateway | undefined {
  return queryOne<ConfigGateway>('SELECT * FROM config_gateways WHERE id = ?', [id]);
}

export function addGateway(data: { id?: string; name: string; url: string; token?: string; clientName?: string }): ConfigGateway {
  const id = data.id || `gw-${Date.now()}`;
  run(
    `INSERT INTO config_gateways (id, name, url, token, client_name, is_active, is_primary, status)
     VALUES (?, ?, ?, ?, ?, 1, 0, 'unknown')`,
    [id, data.name, data.url, data.token || '', data.clientName || '']
  );
  return getGateway(id)!;
}

export function updateGateway(id: string, data: Partial<{ name: string; url: string; token: string; clientName: string; isActive: boolean }>): ConfigGateway | undefined {
  const existing = getGateway(id);
  if (!existing) return undefined;

  if (data.name !== undefined) run('UPDATE config_gateways SET name = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.name, id]);
  if (data.url !== undefined) run('UPDATE config_gateways SET url = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.url, id]);
  if (data.token !== undefined) run('UPDATE config_gateways SET token = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.token, id]);
  if (data.clientName !== undefined) run('UPDATE config_gateways SET client_name = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.clientName, id]);
  if (data.isActive !== undefined) run('UPDATE config_gateways SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [data.isActive ? 1 : 0, id]);

  return getGateway(id);
}

export function removeGateway(id: string): { success: boolean; error?: string } {
  const g = queryOne<ConfigGateway>('SELECT * FROM config_gateways WHERE id = ?', [id]);
  if (!g) return { success: false, error: 'Gateway not found' };
  if (g.is_primary) return { success: false, error: 'Cannot delete the primary gateway' };

  run('DELETE FROM config_gateways WHERE id = ?', [id]);
  return { success: true };
}

export function setPrimaryGateway(id: string): { success: boolean; error?: string } {
  const g = queryOne<ConfigGateway>('SELECT * FROM config_gateways WHERE id = ?', [id]);
  if (!g) return { success: false, error: 'Gateway not found' };

  transaction(() => {
    run('UPDATE config_gateways SET is_primary = 0, updated_at = datetime(\'now\')');
    run('UPDATE config_gateways SET is_primary = 1, updated_at = datetime(\'now\') WHERE id = ?', [id]);
  });
  return { success: true };
}

export async function testGateway(id: string): Promise<{ status: string; error?: string }> {
  const g = queryOne<ConfigGateway>('SELECT * FROM config_gateways WHERE id = ?', [id]);
  if (!g) return { status: 'error', error: 'Gateway not found' };

  // Test via HTTP health endpoint (convert ws:// to http://)
  const httpUrl = g.url.replace('ws://', 'http://').replace('wss://', 'https://');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = {};
    if (g.token) headers['Authorization'] = `Bearer ${g.token}`;

    const healthUrl = `${httpUrl}/health`;
    if (headers['Authorization']) warnIfInsecure(healthUrl, `testGateway(${g.name})`);
    // SSRF guard — block private/link-local/metadata before sending the Bearer token.
    const safety = await assertSafeFetchTarget(healthUrl, `testGateway(${g.name})`);
    if (safety.blocked) {
      clearTimeout(timeout);
      updateGatewayStatus(id, 'error', safety.reason || 'blocked target');
      return { status: 'error', error: safety.reason };
    }
    // redirect:'error' — see testProvider for rationale (internal reviewer P1-D fix).
    const res = await fetch(healthUrl, { signal: controller.signal, headers, redirect: 'error' });
    clearTimeout(timeout);

    if (res.ok) {
      updateGatewayStatus(id, 'connected');
      return { status: 'connected' };
    }
    updateGatewayStatus(id, 'error', `HTTP ${res.status}`);
    return { status: 'error', error: `HTTP ${res.status}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'unreachable';
    updateGatewayStatus(id, 'disconnected', error);
    return { status: 'disconnected', error };
  }
}

export function updateGatewayStatus(id: string, status: string, error?: string): void {
  if (status === 'connected') {
    run(
      'UPDATE config_gateways SET status = ?, last_connected_at = datetime(\'now\'), last_error = NULL, updated_at = datetime(\'now\') WHERE id = ?',
      [status, id]
    );
  } else {
    run(
      'UPDATE config_gateways SET status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [status, error || null, id]
    );
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// CX-R14-06 — config_defaults stores third-party API keys (ElevenLabs,
// HeyGen, D-ID, future provider creds) as plaintext. The voice route's
// per-route GET path masks them, but any other caller that uses
// getAllSettings() (e.g., enumeration via config:read) would see the raw
// values. List the known-sensitive key names here; getAllSettings now
// masks them, while single-key getSetting() returns plaintext for the
// narrow code paths that genuinely need to outbound-call the provider.
const SENSITIVE_SETTING_KEYS = new Set<string>([
  'elevenlabs_api_key',
  'heygen_api_key',
  'did_api_key',
  // Cover near-future provider keys too — string match on `*_api_key` is
  // the cheapest catch-all that future authors don't have to remember
  // to add to.
]);

function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.has(key) || key.endsWith('_api_key');
}

function maskSettingValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 6) + '...' + value.slice(-4);
}

export function getSetting(key: string): string | undefined {
  const row = queryOne<ConfigDefault>('SELECT * FROM config_defaults WHERE key = ?', [key]);
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  run(
    `INSERT INTO config_defaults (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  );
}

/**
 * Bulk read for the Configuration panel + similar consumers. Sensitive
 * keys (anything matching `*_api_key`) are masked in the returned rows
 * — full-encryption-at-rest is a separate v0.15.x track. Callers that
 * intentionally need the plaintext (the route that calls ElevenLabs to
 * validate the key, etc.) must use the single-key getSetting() API.
 */
export function getAllSettings(): ConfigDefault[] {
  const rows = queryAll<ConfigDefault>('SELECT * FROM config_defaults ORDER BY key ASC');
  return rows.map((row) => {
    if (isSensitiveSettingKey(row.key)) {
      return { ...row, value: maskSettingValue(row.value) };
    }
    return row;
  });
}
